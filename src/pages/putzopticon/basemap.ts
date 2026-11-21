import basemapUrl from "./basemap.json?url";
import { viewBounds, type Bounds, type Camera, type Size } from "./camera";

// The bundled grayscale basemap (sources in scripts/gen-putzopticon-basemap.py), drawn to a canvas in
// the flat km projection from stops.ts. It's two maps, one over the other:
// - The regional map, out to `reach.region` km from MIT in each direction: the sea, lakes and
//   rivers, state borders, highways and arterials, with local streets out to `reach.streets` km and
//   campus roofs. Its detail thins with distance (the camera always keeps Putz in frame, so nothing
//   far away is ever seen close up), and all but the sea's outline is in tiles, drawn only in view.
// - The far-away map, everywhere: land, lakes and state/province borders.

type Layer = "buildings" | "streets" | "water" | "islands" | "arterials" | "highways";
// A tile's lakes or islands are all about one size (`size` km across, up to twice that), so the
// small ones can wait for the zoom they'd show at.
type Tile<T> = { bounds: [number, number, number, number]; size?: number } & Partial<Record<Layer, T>>;
type Reach = { region: number; streets: number };
type Basemap<T> = { land: T; lakes: T; states: T; sea: T; borders: T; detail: Tile<T>[]; reach: Reach };
export type Paths = Basemap<Path2D> & { seaFill: Path2D }; // the sea, with every island cut out of it

// Path data is in whole metres, which is short to write down; the map is drawn in km.
const METRES = { a: 0.001, d: 0.001 };
const toPath = (data: string) => {
  const path = new Path2D();
  path.addPath(new Path2D(data), METRES);
  return path;
};

let request: Promise<Paths> | undefined;

export const loadBasemap = () =>
  (request ??= fetch(basemapUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Basemap returned ${response.status}`);
      return response.json() as Promise<Basemap<string>>;
    })
    .then(({ land, lakes, states, sea, borders, detail, reach }) => {
      const tiles: Tile<Path2D>[] = detail.map(({ bounds, size, ...layers }) => ({
        bounds,
        size,
        ...Object.fromEntries(Object.entries(layers).map(([layer, path]) => [layer, toPath(path)])),
      }));
      // Islands are outlined by size (below), but close in every one of them is a hole in the sea.
      const seaFill = toPath(sea);
      for (const { islands } of tiles) {
        if (islands) seaFill.addPath(islands);
      }
      return {
        land: toPath(land),
        lakes: toPath(lakes),
        states: toPath(states),
        sea: toPath(sea),
        seaFill,
        borders: toPath(borders),
        detail: tiles,
        reach,
      };
    })
    .catch((error: unknown) => {
      request = undefined;
      throw error;
    }));

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
// All there up to `full`, gone from `gone`.
const fade = (value: number, full: number, gone: number) => clamp01((gone - value) / (gone - full));

// How much of each part of the regional map shows, 0 to 1. The map as a whole goes by how much of
// the view it covers: all there while that's most of it, gone once it's under half (where its edge
// is in view, it's drawn soft). Arterials and local streets also go by zoom, before they'd turn to
// mush, and streets by where they stop.
export const basemapDetail = (camera: Camera, size: Size, reach?: Reach) => {
  const span = Math.max(size.width, size.height) / camera.scale; // km across
  const local = fade(span, 25, 45);
  if (!reach) return { region: local, arterials: local, streets: local }; // not loaded yet: land, close in
  const view = viewBounds(camera, size);
  const covered = (low: number, high: number) =>
    clamp01((Math.min(high, reach.region) - Math.max(low, -reach.region)) / (high - low));
  // The furthest the view gets from MIT, east/west or north/south.
  const out = Math.max(-view.minX, view.maxX, -view.minY, view.maxY);
  return {
    region: fade(1 - covered(view.minX, view.maxX) * covered(view.minY, view.maxY), 0.25, 0.55),
    arterials: fade(span, 120, 200),
    streets: Math.min(local, fade(out, reach.streets - 5, reach.streets)),
  };
};

let probe: CanvasRenderingContext2D | null | undefined;
// Whether a path (in km, filled even-odd like everything here) holds a point.
export const pathHolds = (path: Path2D, x: number, y: number) => {
  probe ??= document.createElement("canvas").getContext("2d");
  return probe?.isPointInPath(path, x, y, "evenodd") ?? false;
};

// Whether the map draws land at a point: the regional map's where it reaches, the far-away map's past it.
export const onLand = (paths: Paths, x: number, y: number) =>
  Math.max(Math.abs(x), Math.abs(y)) < paths.reach.region ? !pathHolds(paths.seaFill, x, y) : pathHolds(paths.land, x, y);

type Rgb = [number, number, number];
// A gray, or one part of the way to another.
const shade = (from: Rgb, to = from, t = 0) =>
  `rgb(${from.map((value, i) => Math.round(value + (to[i] - value) * t)).join(", ")})`;

// Near-black land, true-black water, and buildings picked out by crisp edges: the contrast lives in
// the outlines, not in the fills. Line widths are in px, whatever the zoom.
const brush = (context: CanvasRenderingContext2D, scale: number) => {
  context.lineJoin = "round";
  context.lineCap = "round";
  return {
    stroke: (path: Path2D, color: string, px: number) => {
      context.strokeStyle = color;
      context.lineWidth = px / scale;
      context.stroke(path);
    },
    fill: (path: Path2D, color: string) => {
      context.fillStyle = color;
      context.fill(path, "evenodd");
    },
  };
};

const drawRegion = (
  context: CanvasRenderingContext2D,
  size: Size,
  camera: Camera,
  paths: Paths,
  detail: ReturnType<typeof basemapDetail>
) => {
  const { x, y, scale } = camera;
  const { stroke, fill } = brush(context, scale);
  const view = viewBounds(camera, size);
  context.fillStyle = "#141517";
  context.fillRect(view.minX, view.minY, view.maxX - view.minX, view.maxY - view.minY);
  const tiles = paths.detail.filter(
    ({ bounds: [x1, y1, x2, y2] }) => x1 < view.maxX && x2 > view.minX && y1 < view.maxY && y2 > view.minY
  );
  // Roofs only exist around campus, so they fade with distance from MIT as well as zoom.
  const roofs = Math.max(0, Math.min(1, (scale - 105) / 95, (1.55 - Math.hypot(x, y)) / 0.55));
  if (roofs > 0) {
    context.globalAlpha = detail.streets * roofs;
    for (const { buildings } of tiles) {
      if (!buildings) continue;
      fill(buildings, "#24262a");
      stroke(buildings, "#575b61", 0.85);
    }
  }
  // Close in, every road is one faint gray, just above the land (#141517), so they read as
  // texture. Further out, as the local streets go, the roads that are left get picked out a
  // little, highways most, or there'd be nothing to see between the coasts. (Highways thin again
  // from the widest views, where there get to be a lot of them.)
  const road: Rgb = scale > 90 ? [43, 45, 49] : [35, 37, 40];
  const roadWidth = scale > 145 ? 0.85 : 0.6;
  const lone = 1 - detail.streets;
  if (detail.streets > 0) {
    context.globalAlpha = detail.streets;
    for (const { streets } of tiles) {
      if (streets) stroke(streets, shade(road), roadWidth);
    }
  }
  context.globalAlpha = 1;
  stroke(paths.borders, "#35383c", 0.8); // under the water, where they run out to sea
  // The sea goes over the streets, so only bridges cross it: while there are streets, it's filled
  // around its islands. Without, it's filled whole and the islands are painted back on.
  const around = detail.streets > 0;
  fill(around ? paths.seaFill : paths.sea, "#000000");
  stroke(paths.sea, "#43464b", 0.85); // a quiet shoreline against the black
  // Islands and lakes: every one while the streets show. Further out they come in as they get to
  // a few px across. Any smaller and all there is to see is the outline, a speck, and from far
  // enough out there are thousands of them.
  const sized = (km = Infinity) => 1 - lone * (1 - clamp01((km * scale) / 2 - 1));
  for (const { islands, size: across } of tiles) {
    const alpha = islands ? sized(across) : 0;
    if (!islands || !alpha) continue;
    context.globalAlpha = alpha;
    if (!around) fill(islands, "#141517");
    stroke(islands, "#43464b", 0.85);
  }
  for (const { water, size: across } of tiles) {
    const alpha = water ? sized(across) : 0;
    if (!water || !alpha) continue;
    context.globalAlpha = alpha;
    fill(water, "#000000");
    stroke(water, "#43464b", 0.85);
  }
  // Arterials and highways go after the water so bridges cross it.
  if (detail.arterials > 0) {
    context.globalAlpha = detail.arterials;
    const color = shade(road, [44, 46, 51], lone);
    for (const { arterials } of tiles) {
      if (arterials) stroke(arterials, color, roadWidth);
    }
  }
  context.globalAlpha = 1;
  const color = shade(road, [58, 61, 66], lone);
  const span = Math.max(size.width, size.height) / scale;
  for (const { highways } of tiles) {
    if (highways) stroke(highways, color, roadWidth + 0.35 * lone * fade(span, 200, 500));
  }
};

// Where the regional map's edge is in view, the map is drawn here first, so its last stretch can be
// faded out before it goes over the far-away map.
let layer: HTMLCanvasElement | undefined;
const EDGE_KM = 40;

// Rubs out what's drawn on a context past `edge` km from MIT, and by less and less over the
// EDGE_KM inside that, on whichever sides of the view the edge is in.
const softenEdge = (context: CanvasRenderingContext2D, view: Bounds, edge: number) => {
  // (Not "destination-in" with the gradient the other way up: that also clears everything it
  // doesn't draw on, and a gradient over the whole canvas is slow.)
  context.globalCompositeOperation = "destination-out";
  // One side of the map: its edge at x (or y) = `at`, whole again by `solid`.
  const side = (vertical: boolean, at: number) => {
    const solid = at - Math.sign(at) * EDGE_KM;
    const [low, high] = vertical ? [view.minX, view.maxX] : [view.minY, view.maxY];
    if (at < 0 ? low >= solid : high <= solid) return; // out of view
    // The strip of the view from a to b along this axis.
    const strip = (a: number, b: number): [number, number, number, number] =>
      vertical ? [a, view.minY, b - a, view.maxY - view.minY] : [view.minX, a, view.maxX - view.minX, b - a];
    if (at < 0 ? low < at : high > at) context.clearRect(...(at < 0 ? strip(low, at) : strip(at, high)));
    const gradient = vertical ? context.createLinearGradient(at, 0, solid, 0) : context.createLinearGradient(0, at, 0, solid);
    gradient.addColorStop(0, "#000000");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(...strip(Math.min(at, solid), Math.max(at, solid)));
  };
  for (const at of [-edge, edge]) {
    side(true, at);
    side(false, at);
  }
  context.globalCompositeOperation = "source-over";
};

export const drawBasemap = (
  context: CanvasRenderingContext2D,
  size: Size,
  camera: Camera,
  paths: Paths | undefined
) => {
  const { width, height } = size;
  const { x, y, scale } = camera;
  context.fillStyle = "#000000"; // sea, under the far-away map
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width / 2 - x * scale, height / 2 - y * scale);
  context.scale(scale, scale);

  const detail = basemapDetail(camera, size, paths?.reach);
  const view = viewBounds(camera, size);
  if (!paths) {
    context.globalAlpha = detail.region;
    context.fillStyle = "#141517";
    context.fillRect(view.minX, view.minY, view.maxX - view.minX, view.maxY - view.minY);
  } else if (Math.max(-view.minX, view.maxX, -view.minY, view.maxY) <= paths.reach.region - EDGE_KM) {
    drawRegion(context, size, camera, paths, detail); // nothing but the regional map in view, short of its edge
  } else {
    const { stroke, fill } = brush(context, scale);
    fill(paths.land, "#1a1b1e");
    fill(paths.lakes, "#000000");
    stroke(paths.land, "#4b4e53", 0.9);
    stroke(paths.lakes, "#4b4e53", 0.9);
    stroke(paths.states, "#3c3f43", 0.8);

    // The regional map goes over that, by way of the layer (a canvas like the map's own).
    layer ??= document.createElement("canvas");
    const over = detail.region > 0 ? layer.getContext("2d", context.getContextAttributes?.()) : null;
    if (over) {
      if (layer.width !== context.canvas.width || layer.height !== context.canvas.height) {
        layer.width = context.canvas.width;
        layer.height = context.canvas.height;
      }
      over.resetTransform();
      over.clearRect(0, 0, layer.width, layer.height);
      over.setTransform(context.getTransform());
      drawRegion(over, size, camera, paths, detail);
      softenEdge(over, view, paths.reach.region);
      context.resetTransform();
      context.globalAlpha = detail.region;
      context.drawImage(layer, 0, 0);
    }
  }
  context.restore();
};
