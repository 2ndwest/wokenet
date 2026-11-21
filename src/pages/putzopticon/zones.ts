import zonesUrl from "../../../convex/location_labels_generated.json?url";
import { pathHolds } from "./basemap";
import type { Bounds, Camera, Size } from "./camera";
import { project } from "./stops";

// The GeoJSON location polygons from convex/location_labels_generated.json, projected into the
// map's flat km coordinates so the current stop's locations can glow on the basemap.

type Position = [number, number];
export type ZoneGeometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };
type ZoneFeature = {
  properties?: { name?: string };
  geometry?: ZoneGeometry;
};
type ZoneCollection = { features: ZoneFeature[] };

export type Zones = Map<string, Path2D>;
export type Glow = { path: Path2D; strength: number };

// Convert a GeoJSON Polygon or MultiPolygon into an SVG path string in flat km coordinates.
export const zonePathData = (geometry: ZoneGeometry): string => {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let d = "";
  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length; i++) {
        const [lng, lat] = ring[i];
        const { x, y } = project(lat, lng);
        d += `${i === 0 ? "M" : "L"}${x},${y}`;
      }
      d += "Z";
    }
  }
  return d;
};

// How strongly a zone glows in a view, 0 to 1: in full while it's up to two fifths of the land on
// screen, a shape with plenty around it to stand out from, and less the more of the view it takes
// up, down to nothing well before it's all there is. Seen from inside (a whole state, framing someone a few
// towns over) a glow would only tint the entire map. Sampled on a grid; the sea doesn't count.
const [FULL, NONE] = [0.4, 0.7]; // the zone's share of the land in view
export const zoneGlow = (
  view: Bounds,
  inZone: (x: number, y: number) => boolean,
  isLand: (x: number, y: number) => boolean,
  across = 7
) => {
  let inside = 0;
  const rest: [number, number][] = [];
  for (let i = 0; i < across * across; i++) {
    const x = view.minX + (((i % across) + 0.5) / across) * (view.maxX - view.minX);
    const y = view.minY + ((Math.floor(i / across) + 0.5) / across) * (view.maxY - view.minY);
    if (inZone(x, y)) inside++;
    else rest.push([x, y]);
  }
  // Other land, counted only until there's enough of it for a full glow: asking the map what's
  // land is the slow part.
  let other = 0;
  for (let i = 0; i < rest.length && inside > FULL * (inside + other); i++) {
    if (isLand(...rest[i])) other++;
  }
  const share = inside ? inside / (inside + other) : 0;
  return Math.min(1, Math.max(0, (NONE - share) / (NONE - FULL)));
};

// The glows of a stop's locations, as it's framed.
export const zoneGlows = (
  zones: Zones,
  labels: readonly string[],
  view: Bounds,
  isLand: (x: number, y: number) => boolean
): Glow[] =>
  labels.flatMap((label) => {
    const path = zones.get(label);
    if (!path) return [];
    const strength = zoneGlow(view, (x, y) => pathHolds(path, x, y), isLand);
    return strength > 0 ? [{ path, strength }] : [];
  });

let request: Promise<Zones> | undefined;

export const loadZones = (): Promise<Zones> =>
  (request ??= fetch(zonesUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Zones returned ${response.status}`);
      return response.json() as Promise<ZoneCollection>;
    })
    .then(({ features }) => {
      const zones: Zones = new Map();
      for (const feature of features) {
        const name = String(feature.properties?.name ?? "").toUpperCase();
        if (!name || !feature.geometry) continue;
        const d = zonePathData(feature.geometry);
        if (d) zones.set(name, new Path2D(d));
      }
      return zones;
    })
    .catch((error: unknown) => {
      request = undefined;
      throw error;
    }));

// A subtle, diffuse colored glow over the current stop's location polygon(s), drawn above the
// basemap and beneath the dots. Uses blurred screen-blended fills (no outline) so dark pill colors
// still lift softly off the near-black map without hard edges or dimming streets underneath.
export const drawZoneGlow = (
  context: CanvasRenderingContext2D,
  size: Size,
  camera: Camera,
  density: number,
  glows: readonly Glow[],
  color: string,
  intensity: number
) => {
  if (intensity <= 0 || !glows.length) return;

  const { width, height } = size;
  const { x, y, scale } = camera;
  context.save();
  context.translate(width / 2 - x * scale, height / 2 - y * scale);
  context.scale(scale, scale);
  context.globalCompositeOperation = "screen";
  context.fillStyle = color;

  // Wide diffuse ambient wash, then a slightly tighter soft core — no hard polygon edges.
  context.filter = `blur(${Math.round(28 * density)}px)`;
  for (const { path, strength } of glows) {
    context.globalAlpha = 0.22 * intensity * strength;
    context.fill(path, "evenodd");
  }

  context.filter = `blur(${Math.round(12 * density)}px)`;
  for (const { path, strength } of glows) {
    context.globalAlpha = 0.16 * intensity * strength;
    context.fill(path, "evenodd");
  }

  context.restore();
};
