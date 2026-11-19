"""Build src/pages/putzopticon/basemap.json, the Putzopticon map's bundled vector geometry.

Sources (all public-domain or public government data):
- Boston-area streets and water: U.S. Census Bureau 2024 TIGER/Line
  https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.2024.html
- Building footprints around campus: MassGIS Building Structures
  https://www.mass.gov/info-details/massgis-data-building-structures-2-d
- The far-away map (land, lakes, state and province borders): Natural Earth 1:50m, all from the one
  source so coastlines and borders line up. https://www.naturalearthdata.com/downloads/50m-physical-vectors/

Input files (put them in design-proposal/data/):
- {county}-roads.zip, {county}-areawater.zip: 2024 TIGER/Line Roads and Area Hydrography
  for counties 25009, 25017, 25021 and 25025.
- ne_50m_land.zip, ne_50m_lakes.zip (naciscdn.org/naturalearth/50m/physical/) and
  ne_50m_admin_1_states_provinces_lines.zip (naciscdn.org/naturalearth/50m/cultural/).
- buildings.json: the MassGIS Building Structures feature layer as GeoJSON
  (https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Building_Structures/FeatureServer/0),
  clipped to the Cambridge and Boston neighborhoods by campus. Combine paginated bounding-box
  queries in WGS84 (-71.120 to -71.060, 42.344 to 42.374) and deduplicate by OBJECTID.

Run: uv run --no-project --with pyshp --with shapely python scripts/gen-putzopticon-basemap.py
Add --far-only to rebuild just the far-away layers into the existing basemap.json (needs only the
Natural Earth files), and --input DIR to read the files from somewhere other than design-proposal/data.
"""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

import shapefile
from shapely import make_valid
from shapely.geometry import box, shape
from shapely.ops import unary_union

INPUT = Path(sys.argv[sys.argv.index("--input") + 1]) if "--input" in sys.argv else Path("design-proposal/data")
OUTPUT = Path("src/pages/putzopticon/basemap.json")
BOUNDS = box(-71.265, 42.24, -70.90, 42.48)
COUNTIES = ("25017", "25021", "25025", "25009")


def records(archive):
    with ZipFile(INPUT / f"{archive}.zip") as source:
        files = {Path(name).suffix[1:]: source.open(name) for name in source.namelist()}
        with shapefile.Reader(**{ext: files[ext] for ext in ("shp", "shx", "dbf")}) as reader:
            yield from reader.iterShapeRecords()


def project(lng, lat):
    x = (lng + 71.0921) * 111.32 * math.cos(math.radians(42.3592))
    y = (42.3592 - lat) * 111.32
    return x, y


def point(lng, lat, precision):
    x, y = project(lng, lat)
    return f"{x:.{precision}f},{y:.{precision}f}"


def path(geometry, precision=3):
    if geometry.is_empty:
        return ""
    if geometry.geom_type in ("LineString", "LinearRing"):
        return "M" + " ".join(point(*coordinate, precision) for coordinate in geometry.coords)
    if geometry.geom_type == "Polygon":
        return "".join(path(ring, precision) + "Z" for ring in (geometry.exterior, *geometry.interiors))
    return "".join(path(part, precision) for part in getattr(geometry, "geoms", ()))


def tiles(layers):
    buckets = defaultdict(lambda: defaultdict(list))
    for layer, geometries in layers.items():
        for geometry in geometries:
            if geometry.is_empty:
                continue
            x, y = project(*geometry.centroid.coords[0])
            buckets[math.floor(x / 2), math.floor(y / 2)][layer].append(geometry)

    for layers in buckets.values():
        bounds = [geometry.bounds for geometries in layers.values() for geometry in geometries]
        west, south, east, north = (
            min(b[0] for b in bounds), min(b[1] for b in bounds),
            max(b[2] for b in bounds), max(b[3] for b in bounds),
        )
        yield {
            "bounds": [round(coordinate, 3) for coordinate in (*project(west, north), *project(east, south))],
            **{layer: "".join(path(geometry) for geometry in parts) for layer, parts in layers.items()},
        }


def far_layers():
    """Land, lakes and state/province borders for the far-away map, from Natural Earth 1:50m,
    simplified to ~700 m and kept to 100 m (under a pixel or two at that zoom)."""
    world = box(-180, -56, 180, 72)  # skip Antarctica and the high Arctic, where nobody's stop will be

    def paths(archive):
        return "".join(
            path(make_valid(shape(feature.shape.__geo_interface__)).intersection(world).simplify(0.007), 1)
            for feature in records(archive)
        )
    return {
        "land": paths("ne_50m_land"),
        "lakes": paths("ne_50m_lakes"),
        "states": paths("ne_50m_admin_1_states_provinces_lines"),
    }


if "--far-only" in sys.argv:
    layers = json.loads(OUTPUT.read_text())
    layers.update(far_layers())
    OUTPUT.write_text(json.dumps(layers, separators=(",", ":")) + "\n")
    sys.exit()

roads = {"streets": [], "arterials": [], "highways": []}
waters = []
for county in COUNTIES:
    for feature in records(f"{county}-roads"):
        if not BOUNDS.intersects(box(*feature.shape.bbox)):
            continue
        code = feature.record.MTFCC
        layer = {"S1100": "highways", "S1200": "arterials", "S1400": "streets"}.get(code)
        if layer:
            roads[layer].append(shape(feature.shape.__geo_interface__).intersection(BOUNDS).simplify(0.000034))
    for feature in records(f"{county}-areawater"):
        if BOUNDS.intersects(box(*feature.shape.bbox)):
            area = make_valid(shape(feature.shape.__geo_interface__)).intersection(BOUNDS)
            if area.area > 0.000001:
                waters.append(area)

building_features = json.loads((INPUT / "buildings.json").read_text())["features"]
roads["buildings"] = [
    geometry.simplify(0.000018)
    for feature in building_features if feature["geometry"]
    if (geometry := shape(feature["geometry"])).area >= 0.000000010
]
layers = {
    "detail": list(tiles(roads)),
    "water": path(unary_union(waters).simplify(0.000035)),
    **far_layers(),
}
OUTPUT.write_text(json.dumps(layers, separators=(",", ":")) + "\n")
