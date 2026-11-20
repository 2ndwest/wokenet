import zonesUrl from "../../../convex/location_labels_generated.json?url";
import type { Camera, Size } from "./camera";
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
  zones: Zones | undefined,
  labels: readonly string[],
  color: string,
  intensity: number
) => {
  if (!zones || intensity <= 0 || !labels.length) return;
  const active: Path2D[] = [];
  for (const label of labels) {
    const path = zones.get(label);
    if (path) active.push(path);
  }
  if (!active.length) return;

  const { width, height } = size;
  const { x, y, scale } = camera;
  context.save();
  context.translate(width / 2 - x * scale, height / 2 - y * scale);
  context.scale(scale, scale);
  context.globalCompositeOperation = "screen";
  context.fillStyle = color;

  // Wide diffuse ambient wash, then a slightly tighter soft core — no hard polygon edges.
  context.filter = `blur(${Math.round(28 * density)}px)`;
  context.globalAlpha = 0.22 * intensity;
  for (const path of active) context.fill(path, "evenodd");

  context.filter = `blur(${Math.round(12 * density)}px)`;
  context.globalAlpha = 0.16 * intensity;
  for (const path of active) context.fill(path, "evenodd");

  context.restore();
};
