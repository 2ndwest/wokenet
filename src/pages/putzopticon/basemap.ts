import basemapUrl from "./basemap.json?url";
import type { Camera, Size } from "./camera";

// The bundled grayscale basemap (sources in scripts/gen-putzopticon-basemap.py): Boston-area streets, shorelines and campus
// roofs in detail tiles, plus land, lakes and state/province borders for the far-away views. All in the flat km
// projection from stops.ts, drawn to a canvas.

type Layer = "buildings" | "streets" | "arterials" | "highways";
type Tile<T> = { bounds: [number, number, number, number] } & Partial<Record<Layer, T>>;
type Basemap<T> = { land: T; lakes: T; states: T; water: T; detail: Tile<T>[] };
export type Paths = Basemap<Path2D>;

let request: Promise<Paths> | undefined;

export const loadBasemap = () =>
  (request ??= fetch(basemapUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Basemap returned ${response.status}`);
      return response.json() as Promise<Basemap<string>>;
    })
    .then(({ land, lakes, states, water, detail }) => ({
      land: new Path2D(land),
      lakes: new Path2D(lakes),
      states: new Path2D(states),
      water: new Path2D(water),
      detail: detail.map(({ bounds, ...layers }) => ({
        bounds,
        ...Object.fromEntries(Object.entries(layers).map(([layer, path]) => [layer, new Path2D(path)])),
      })),
    }))
    .catch((error: unknown) => {
      request = undefined;
      throw error;
    }));


// How much of the street map shows: all of it close in, fading out to the land-and-states map once
// the view is wider than the street detail reaches.
export const streetDetail = (camera: Camera, size: Size) =>
  Math.max(0, Math.min(1, (45 - Math.max(size.width, size.height) / camera.scale) / 20));

export const drawBasemap = (
  context: CanvasRenderingContext2D,
  size: Size,
  camera: Camera,
  paths: Paths | undefined,
  detail: number
) => {
  const { width, height } = size;
  const { x, y, scale } = camera;
  // Near-black land, true-black water, and buildings picked out by crisp edges: the contrast lives
  // in the outlines, not in the fills.
  context.fillStyle = "#000000"; // sea, under the far-away map
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width / 2 - x * scale, height / 2 - y * scale);
  context.scale(scale, scale);
  context.lineJoin = "round";
  context.lineCap = "round";
  const stroke = (path: Path2D, color: string, px: number) => {
    context.strokeStyle = color;
    context.lineWidth = px / scale;
    context.stroke(path);
  };
  const fill = (path: Path2D, color: string) => {
    context.fillStyle = color;
    context.fill(path, "evenodd");
  };

  if (paths && detail < 1) {
    fill(paths.land, "#1a1b1e");
    fill(paths.lakes, "#000000");
    stroke(paths.land, "#4b4e53", 0.9);
    stroke(paths.lakes, "#4b4e53", 0.9);
    stroke(paths.states, "#3c3f43", 0.8);
  }
  if (detail > 0) {
    const left = x - width / 2 / scale;
    const top = y - height / 2 / scale;
    const right = left + width / scale;
    const bottom = top + height / scale;
    context.globalAlpha = detail;
    context.fillStyle = "#141517";
    context.fillRect(left, top, right - left, bottom - top);
    if (paths) {
      const tiles = paths.detail.filter(
        ({ bounds: [x1, y1, x2, y2] }) => x1 < right && x2 > left && y1 < bottom && y2 > top
      );
      // Roofs only exist around campus, so they fade with distance from MIT as well as zoom.
      const roofs = Math.max(0, Math.min(1, (scale - 105) / 95, (1.55 - Math.hypot(x, y)) / 0.55));
      if (roofs > 0) {
        context.globalAlpha = detail * roofs;
        for (const { buildings } of tiles) {
          if (!buildings) continue;
          fill(buildings, "#24262a");
          stroke(buildings, "#575b61", 0.85);
        }
        context.globalAlpha = detail;
      }
      // Every road in one faint gray, just above the land (#141517), so they read as texture.
      const road = scale > 90 ? "#2b2d31" : "#232528";
      const roadWidth = scale > 145 ? 0.85 : 0.6;
      for (const { streets } of tiles) {
        if (streets) stroke(streets, road, roadWidth);
      }
      fill(paths.water, "#000000");
      stroke(paths.water, "#43464b", 0.85); // a quiet shoreline against the black
      // Arterials and highways go after the water so bridges cross it.
      for (const { arterials, highways } of tiles) {
        if (arterials) stroke(arterials, road, roadWidth);
        if (highways) stroke(highways, road, roadWidth);
      }
    }
    context.globalAlpha = 1;
  }
  context.restore();
};
