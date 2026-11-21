"""Build src/pages/putzopticon/basemap.json, the Putzopticon map's bundled vector geometry.

Two maps, one drawn over the other (see basemap.ts):
- The regional map, as far as REGION_KM from MIT in each direction: the sea, lakes and rivers, state
  borders, highways and arterials, with local streets out to STREETS_KM and campus roofs.
- The far-away map, everywhere: land, lakes and state/province borders.

The camera always keeps Putz in frame, so the further something is from MIT, the smaller it is the
closest it's ever seen. The regional map's detail falls off to match (see "Detail" below), which is
how it reaches across New England without the file growing much past what the streets around Boston
took. If the camera ever frames far-off places without Putz, they'll look coarse close up.

Sources (all public-domain or public government data), downloaded into the input directory the
first time they're needed (about 220 MB):
- Roads, water and county outlines: U.S. Census Bureau 2024 TIGER/Line
  https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.2024.html
- Building footprints around campus: MassGIS Building Structures
  https://www.mass.gov/info-details/massgis-data-building-structures-2-d
- The far-away map: Natural Earth 1:50m, all from the one source so coastlines and borders line up.
  https://www.naturalearthdata.com/downloads/50m-physical-vectors/

Run: uv run --no-project --with pyshp --with shapely python scripts/gen-putzopticon-basemap.py
Add --far-only to rebuild just the far-away layers into the existing basemap.json (needs only the
Natural Earth files), and --input DIR to keep the downloads somewhere other than design-proposal/data.
"""
import json
import math
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
from zipfile import ZipFile

import shapefile
from shapely import make_valid
from shapely.geometry import LineString, Polygon, box, shape
from shapely.ops import linemerge, unary_union

INPUT = Path(sys.argv[sys.argv.index("--input") + 1]) if "--input" in sys.argv else Path("design-proposal/data")
OUTPUT = Path("src/pages/putzopticon/basemap.json")

# How far the regional map reaches from MIT, in km east/west and north/south: all of Massachusetts
# and most of New England, stopping short of Canada (294 km north), which TIGER doesn't cover and
# would come out as open sea. Arterials and local streets stop where the zoom they fade out at
# (basemap.ts) can no longer show them.
REGION_KM = 280
ARTERIALS_KM = 190
STREETS_KM = 40
CAMPUS = (-71.120, 42.344, -71.060, 42.374)  # building footprints: the neighborhoods by campus

TIGER = "https://www2.census.gov/geo/tiger/TIGER2024"
NATURAL_EARTH = "https://naciscdn.org/naturalearth/50m"
BUILDINGS = "https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Building_Structures/FeatureServer/0"

KM_PER_LNG = 111.32 * math.cos(math.radians(42.3592))
KM_PER_LAT = 111.32


def project(lng, lat):
    """Flat km east and south of MIT (stops.ts)."""
    return (lng + 71.0921) * KM_PER_LNG, (42.3592 - lat) * KM_PER_LAT


def km_box(km):
    """The lng/lat box reaching `km` from MIT in each direction."""
    return box(-km / KM_PER_LNG - 71.0921, 42.3592 - km / KM_PER_LAT, km / KM_PER_LNG - 71.0921, 42.3592 + km / KM_PER_LAT)


# ---------------------------------------------------------------------------------------------
# Inputs


def url(name):
    kind = name.split("-")[-1].removesuffix(".zip")
    if name == "us-county.zip":
        return f"{TIGER}/COUNTY/tl_2024_us_county.zip"
    if kind in ("roads", "areawater", "prisecroads"):
        return f"{TIGER}/{kind.upper()}/tl_2024_{name.split('-')[0]}_{kind}.zip"
    return f"{NATURAL_EARTH}/{'cultural' if 'admin' in name else 'physical'}/{name}"


def download(name):
    target = INPUT / name
    if target.exists():
        return
    print(f"downloading {name}", flush=True)
    partial = target.with_name(name + ".part")
    with urlopen(url(name), timeout=600) as response:
        partial.write_bytes(response.read())
    partial.rename(target)


def fetch(*archives):
    """Make sure these input archives are there, downloading the ones that aren't."""
    INPUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(4) as pool:
        list(pool.map(download, [f"{archive}.zip" for archive in archives]))


def fetch_buildings():
    """The MassGIS footprints touching the campus box, as buildings.json: every page of the query."""
    target = INPUT / "buildings.json"
    if target.exists():
        return
    print("downloading buildings.json", flush=True)
    features = []
    while True:
        query = urlencode({
            "where": "1=1", "geometry": ",".join(map(str, CAMPUS)), "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "outSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "OBJECTID",
            "orderByFields": "OBJECTID", "resultOffset": len(features), "resultRecordCount": 2000, "f": "geojson",
        })
        with urlopen(f"{BUILDINGS}/query?{query}", timeout=600) as response:
            page = json.load(response)
        features += page["features"]
        if not page["features"] or not page.get("properties", {}).get("exceededTransferLimit"):
            break
    target.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


def records(archive):
    with ZipFile(INPUT / f"{archive}.zip") as source:
        files = {Path(name).suffix[1:]: source.open(name) for name in source.namelist()}
        with shapefile.Reader(**{ext: files[ext] for ext in ("shp", "shx", "dbf")}) as reader:
            yield from reader.iterShapeRecords()


# ---------------------------------------------------------------------------------------------
# Detail
#
# Something d km from MIT (east/west or north/south, whichever is more: views are rectangles) is on
# screen only when the view reaches from Putz out to it, so it's never drawn at more than about
# 1650 / d px per km on a 4K-wide screen. Geometry is simplified to d / 1000, a pixel or two at
# its closest, in rings around MIT that each reach √2 further than the last. Rounding and tile size
# go by ring too.


def distance(point):
    return max(abs(point[0]), abs(point[1]))


def ring(point):
    d = distance(point)
    return 0 if d < 3 else 1 + math.floor(2 * math.log2(d / 3))


def inner(k):
    """A ring's inner edge, in km from MIT: 0, 3, 4.2, 6, 8.5, 12, 17, 24..."""
    return 0 if k == 0 else 3 * 2 ** ((k - 1) / 2)


def tolerance(k):
    return max(0.003, inner(k) / 1000)  # km: 3 m by campus, about what it always was


def step(k):
    """What coordinates round to, in metres."""
    return 1 if inner(k) < 15 else 10 if inner(k) < 150 else 100


def tile_size(k):
    return 2 if inner(k) < 16 else 8 if inner(k) < 64 else 32  # km


def visible(area, d, px):
    """Whether something of this area (km²), d km out, ever gets to `px` across (on that 4K screen)."""
    return area >= (px * d / 1650) ** 2


def metres(points, k):
    """Projected points as whole metres rounded to their ring's step, without repeats."""
    s = step(k)
    rounded = []
    for x, y in points:
        point = (round(x * 1000 / s) * s, round(y * 1000 / s) * s)
        if not rounded or rounded[-1] != point:
            rounded.append(point)
    return rounded


def runs(points, closed=False, chop=True):
    """A projected line cut into runs that each stay in one ring (and, with `chop`, no bigger than
    its tiles), sharing the point where they meet: each can then be simplified to its own ring's
    tolerance, and tiled, without the line coming apart."""
    rings = [ring(point) for point in points]
    if closed:
        # Start a closed ring where it crosses between rings, if it does, so no run spans the seam.
        seam = next((i for i in range(1, len(points)) if rings[i] != rings[i - 1]), 0)
        points = points[seam:] + points[1 : seam + 1]
        rings = rings[seam:] + rings[1 : seam + 1]
    run, k = [points[0]], rings[0]
    low, high = list(points[0]), list(points[0])
    for point, next_k in zip(points[1:], rings[1:]):
        run.append(point)
        low, high = [min(low[i], point[i]) for i in (0, 1)], [max(high[i], point[i]) for i in (0, 1)]
        if next_k != k or (chop and max(high[0] - low[0], high[1] - low[1]) > tile_size(k)):
            yield k, run
            run, k = [point], next_k
            low, high = list(point), list(point)
    if len(run) > 1:
        yield k, run


def simplified(k, run):
    line = LineString(run).simplify(tolerance(k), preserve_topology=False) if len(run) > 2 else LineString(run)
    return metres(line.coords, k)


def lod_ring(points):
    """A projected closed ring, each stretch simplified for its distance: one coastline can be exact
    by campus and coarse a state away."""
    ring_points = []
    for k, run in runs(list(points), closed=True, chop=False):
        ring_points += simplified(k, run)[:-1]  # the next run starts where this one ends
    return ring_points


# ---------------------------------------------------------------------------------------------
# Path data: SVG paths in whole metres with relative moves ("l12-3 20 1"), a third the size of
# absolute km ("-13.212,5.884 -13.200,5.881"). basemap.ts scales them to km.


class PathData:
    def __init__(self):
        self.parts = []
        self.at = None  # the current point
        self.command = ""  # the command another pair of numbers would continue

    def pair(self, command, dx, dy):
        numbers = f"{dx}{dy}" if dy < 0 else f"{dx} {dy}"
        if command == self.command:
            self.parts.append(numbers if dx < 0 else " " + numbers)
        else:
            self.parts.append(command + numbers)
        self.command = "l" if command == "m" else command  # pairs after a relative move are relative lines

    def add(self, points, close=False):
        x, y = points[0]
        if self.at is None:
            self.pair("M", x, y)
        elif close or self.command == "z" or (x, y) != self.at:
            self.pair("m", x - self.at[0], y - self.at[1])
        self.at = start = (x, y)
        for point in points[1:]:
            self.pair("l", point[0] - self.at[0], point[1] - self.at[1])
            self.at = point
        if close:
            # Back to the start, then closed: a bare "z" isn't the same. Strokes thinner than a
            # pixel are drawn as hairlines, which stretch a contour's last point to cap it, so the
            # closing edge would start a little off.
            self.pair("l", start[0] - self.at[0], start[1] - self.at[1])
            self.parts.append("z")
            self.command = "z"
            self.at = start


def nearby(point):
    """A sort key that keeps neighbors together (Morton order of 64 m cells), so moves stay short."""
    x, y = (int(value + (1 << 26)) >> 6 for value in point)
    return sum(((x >> bit) & 1) << (2 * bit) | ((y >> bit) & 1) << (2 * bit + 1) for bit in range(21))


def lines_path(lines):
    """Open lines as one path: neighbors together, and end to start where they meet."""
    lines = [line for line in lines if len(line) > 1]
    ends = defaultdict(list)
    for i, line in enumerate(lines):
        ends[line[0]].append(i)
        ends[line[-1]].append(i)
    used = [False] * len(lines)
    path = PathData()
    for i in sorted(range(len(lines)), key=lambda i: nearby(lines[i][0])):
        line = lines[i]
        while not used[i]:
            used[i] = True
            path.add(line)
            following = next((j for j in ends[line[-1]] if not used[j]), None)
            if following is not None:
                i, line = following, lines[following] if lines[following][0] == line[-1] else lines[following][::-1]
    return "".join(path.parts)


def rings_path(rings):
    path = PathData()
    for points in rings:
        if len(points) >= 3:
            path.add(points, close=True)
    return "".join(path.parts)


# ---------------------------------------------------------------------------------------------
# Tiles: what's drawn only where it's in view. Roads and roofs go by place; lakes and islands by
# place and size, so the small ones can wait until they'd be big enough to see.


class Tiles:
    def __init__(self):
        self.layers = defaultdict(lambda: defaultdict(list))  # tile -> layer -> lines or rings, in metres

    @staticmethod
    def at(points, k, times=1):
        """The tile a shape belongs to, by the middle of its bounds (`times` the usual size across)."""
        size = tile_size(k) * times
        middle = [(min(p[i] for p in points) + max(p[i] for p in points)) / 2000 for i in (0, 1)]
        return size, math.floor(middle[0] / size), math.floor(middle[1] / size)

    def add_line(self, layer, points):
        for k, run in runs(points):
            line = simplified(k, run)
            if len(line) > 1:
                self.layers[self.at(line, k)][layer].append(line)

    def add_rings(self, layer, rings, d, area=None):
        """Closed rings (one shape's outline and holes), d km out. With `area`, in a tile of its
        own size class (0.1 km across and up, 0.2, 0.4...), and four times as big: there are far
        fewer lakes than streets, and every tile is a path to draw."""
        if area is None:
            tile = self.at(rings[0], ring((d, 0)))
        else:
            tile = (*self.at(rings[0], ring((d, 0)), 4), max(0, min(7, math.floor(math.log2(max(math.sqrt(area), 0.1) / 0.1)))))
        self.layers[tile][layer] += rings

    def output(self):
        for tile in sorted(self.layers):
            layers = self.layers[tile]
            points = [point for shapes in layers.values() for points in shapes for point in points]
            bounds = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
            yield {
                "bounds": [value / 1000 for value in bounds],
                **({"size": round(0.1 * 2 ** tile[3], 1)} if len(tile) > 3 else {}),
                **{layer: (lines_path if layer in ROADS else rings_path)(shapes) for layer, shapes in layers.items()},
            }


ROADS = {"highways": REGION_KM, "arterials": ARTERIALS_KM, "streets": STREETS_KM}  # how far each reaches


def roads(archives, classes, seen):
    """Road centre lines of the given classes as (layer, projected line), within each layer's reach
    and each stretch only once: TIGER repeats a road for every name and route number it carries."""
    for archive in archives:
        for feature in records(archive):
            layer = classes.get(feature.record.MTFCC)
            west, south, east, north = feature.shape.bbox
            if not layer or distance(project(max(west, min(east, -71.0921)), max(south, min(north, 42.3592)))) > ROADS[layer]:
                continue  # even its nearest corner is out of reach
            lnglat = [tuple(point[:2]) for point in feature.shape.points]
            points = [project(*point) for point in lnglat]
            within = [distance(point) <= ROADS[layer] for point in points]
            for start, end in zip(feature.shape.parts, [*feature.shape.parts[1:], len(points)]):
                line = []
                for i in range(start, end - 1):
                    segment = tuple(sorted(lnglat[i : i + 2]))
                    if within[i] and within[i + 1] and segment not in seen:
                        seen.add(segment)
                        line = line or [points[i]]
                        line.append(points[i + 1])
                    elif line:
                        yield layer, line
                        line = []
                if line:
                    yield layer, line


def far_layers():
    """Land, lakes and state/province borders for the far-away map, from Natural Earth 1:50m,
    simplified to ~700 m and kept to 100 m (under a pixel or two at that zoom)."""
    world = box(-180, -56, 180, 72)  # skip Antarctica and the high Arctic, where nobody's stop will be
    fetch("ne_50m_land", "ne_50m_lakes", "ne_50m_admin_1_states_provinces_lines")

    def parts(archive, kind):
        """Every polygon ring or line in the archive, as metres rounded to 100."""
        for feature in records(archive):
            pending = [make_valid(shape(feature.shape.__geo_interface__)).intersection(world).simplify(0.007)]
            while pending:
                geometry = pending.pop()
                pending += getattr(geometry, "geoms", ())
                found = (geometry.exterior, *geometry.interiors) if geometry.geom_type == "Polygon" else (geometry,)
                for part in found if geometry.geom_type == kind else ():
                    points = [(round(x * 10) * 100, round(y * 10) * 100) for x, y in (project(*c) for c in part.coords)]
                    yield [point for i, point in enumerate(points) if i == 0 or point != points[i - 1]]

    return {
        "land": rings_path(ring[:-1] for ring in parts("ne_50m_land", "Polygon")),
        "lakes": rings_path(ring[:-1] for ring in parts("ne_50m_lakes", "Polygon")),
        "states": lines_path(list(parts("ne_50m_admin_1_states_provinces_lines", "LineString"))),
    }


def write(layers):
    OUTPUT.write_text(json.dumps(layers, separators=(",", ":")) + "\n")
    print(f"{OUTPUT}: {OUTPUT.stat().st_size / 1e6:.2f} MB")


if "--far-only" in sys.argv:
    write({**json.loads(OUTPUT.read_text()), **far_layers()})
    sys.exit()

# The counties the regional map touches: their outlines (which take in their coastal water), then
# the roads and water each one has.
fetch("us-county")
region = km_box(REGION_KM)
counties = {
    feature.record.GEOID: geometry
    for feature in records("us-county")
    if region.intersects(box(*feature.shape.bbox)) and (geometry := shape(feature.shape.__geo_interface__)).intersects(region)
}
states = sorted({county[:2] for county in counties})
street_counties = sorted(county for county, outline in counties.items() if outline.intersects(km_box(STREETS_KM)))
fetch(
    *(f"{county}-areawater" for county in counties),
    *(f"{state}-prisecroads" for state in states),
    *(f"{county}-roads" for county in street_counties),
)
fetch_buildings()

tiles = Tiles()

# Roads: highways and arterials from each state's file, local streets from the counties around
# Boston. Highways first, so a stretch that's also in a lesser class is drawn as the greater.
seen = set()
for layer, line in (
    *roads((f"{state}-prisecroads" for state in states), {"S1100": "highways"}, seen),
    *roads((f"{state}-prisecroads" for state in states), {"S1200": "arterials"}, seen),
    *roads((f"{county}-roads" for county in street_counties), {"S1400": "streets"}, seen),
):
    tiles.add_line(layer, line)

# Roofs, whole and to the metre: they're only ever seen up close.
for feature in json.loads((INPUT / "buildings.json").read_text())["features"]:
    if not feature["geometry"] or (geometry := shape(feature["geometry"])).area < 0.000000010:
        continue
    geometry = geometry.simplify(0.000018)
    for polygon in getattr(geometry, "geoms", (geometry,)):
        if polygon.geom_type == "Polygon" and not polygon.is_empty:
            rings = [metres((project(*c) for c in part.coords), 0)[:-1] for part in (polygon.exterior, *polygon.interiors)]
            if len(rings[0]) >= 3:
                tiles.add_rings("buildings", rings, 0)

# Water: each county's lakes, rivers and coastal water, and the open sea past the counties' limits
# three miles out. Lakes and ponds too small to make out at their distance are left out.
waters = [region.difference(unary_union(list(counties.values())))]
for county in sorted(counties):
    for feature in records(f"{county}-areawater"):
        if not region.intersects(box(*feature.shape.bbox)):
            continue
        area = make_valid(shape(feature.shape.__geo_interface__)).intersection(region)
        tidal = feature.record.MTFCC in ("H2051", "H2053")  # bays and sea: part of the coastline, however small
        size = area.area * KM_PER_LNG * KM_PER_LAT
        if area.area > 0.000001 and (tidal or visible(size, distance(project(*area.centroid.coords[0])), 4)):
            waters.append(area)
water = unary_union(waters)
water = [polygon for polygon in getattr(water, "geoms", (water,)) if polygon.geom_type == "Polygon"]

# The biggest piece is the sea (with every river that reaches it): one outline for the whole map.
# Its islands, and every other lake and river, go in tiles by size.
sea = max(water, key=lambda polygon: polygon.area)
for polygon in water:
    rings = []
    for index, part in enumerate((polygon.exterior, *polygon.interiors)):
        points = [project(*c) for c in part.coords]
        d = min(distance(point) for point in points)
        area = Polygon(points).area
        if index == 0:
            shore, size = d, area
        elif not visible(area, d, 2):
            continue  # an island too small to make out
        outline = lod_ring(points)
        if len(outline) < 3:
            if index == 0:
                break
        elif index > 0 and polygon is sea:
            tiles.add_rings("islands", [outline], d, area)
        else:
            rings.append(outline)
    if polygon is sea:
        sea_path = rings_path(rings)
    elif rings:
        tiles.add_rings("water", rings, shore, size)

# State borders: where two states' outlines run together (out to sea too, where water covers them).
outlines = defaultdict(list)
for county, outline in counties.items():
    outlines[county[:2]].append(outline)
outlines = [unary_union(parts).boundary for parts in outlines.values()]
shared = [
    part
    for i, a in enumerate(outlines)
    for b in outlines[i + 1 :]
    for both in [a.intersection(b).intersection(region)]
    for part in getattr(both, "geoms", (both,))
    if part.geom_type == "LineString" and not part.is_empty
]
borders = linemerge(shared)
borders = [
    simplified(k, run)
    for line in getattr(borders, "geoms", (borders,))
    for k, run in runs([project(*c) for c in line.coords], chop=False)
]

write({
    "reach": {"region": REGION_KM, "streets": STREETS_KM},
    "sea": sea_path,
    "borders": lines_path(borders),
    "detail": list(tiles.output()),
    **far_layers(),
})
