import BUILDING_COORDS from "./building_coords.json";

// [lat, lng] per building, pulled once from MIT's campus map (whereis.mit.edu).
const COORDS: Record<string, number[] | undefined> = BUILDING_COORDS;

// A building's [lat, lng]. Annexes missing from the map ("6C", "E37P") use their main building's.
export const coordsOf = (building: string) =>
  COORDS[building] ?? COORDS[building.replace(/[A-Z]+$/, "")];

// Rough distance from a [lat, lng] to a building. Buildings missing from the map (e.g. NE46), or no
// starting point at all, count as farthest.
export const distance = (from: number[] | undefined, building: string) => {
  const to = coordsOf(building);
  if (!from || !to) return Infinity;
  return Math.hypot(from[0] - to[0], (from[1] - to[1]) * Math.cos((from[0] * Math.PI) / 180));
};

// The building a search is for: "W41" or "W41-2" -> "W41". Wings fold in: "14N-1" -> "14".
export const searchedBuilding = (query: string, buildings: Set<string>) => {
  const head = query.split("-")[0];
  const unwinged = head.replace(/^(\d+)[NSEW]$/, "$1");
  return [head, unwinged].find((b) => buildings.has(b) || COORDS[b]);
};

// Orders names with their numbers compared as numbers: "W41-202" before "W41-1119".
export const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
