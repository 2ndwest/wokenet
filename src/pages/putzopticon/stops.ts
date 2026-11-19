import { COLOR_HEX, COLOR_ORDER } from "../../utils/colors";

// Where the map tour goes: one stop per pill color. Colors already group places that sit together
// (the East Campus dorms, Main Group + Stata, west campus, Boston, other states, abroad), and
// COLOR_ORDER walks outward from Putz, so a full cycle reads as zooming out across the map.

export type Person = {
  providerId: string;
  name: string;
  label: string;
  color: string;
  latitude: number;
  longitude: number;
};

export type Point = { x: number; y: number }; // km east (x) and south (y) of MIT

// Flat kilometres around MIT: the projection the bundled basemap is drawn in.
export const project = (lat: number, lng: number): Point => ({
  x: (lng + 71.0921) * 111.32 * Math.cos((42.3592 * Math.PI) / 180),
  y: (42.3592 - lat) * 111.32,
});

// Putz, in East Campus, where the TV hangs.
const PUTZ = { lat: 42.3604, lng: -71.0883 };
export const HOME = project(PUTZ.lat, PUTZ.lng);

// Past this from Putz, a stop is framed with Putz in view and a line back to it.
export const FAR_KM = 2.5;

export const isUnknown = (person: { label: string }) => person.label === "UNKNOWN";
export const hexOf = (color: string) => COLOR_HEX[color] ?? color;

const kmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = Math.PI / 180;
  const s =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(s));
};

export type Located = Person & { point: Point; km: number }; // km: from Putz

// Everyone the map can show. UNKNOWN fixes are stale, so they're never plotted.
export const locate = (people: Person[]): Located[] =>
  people
    .filter(
      (p) =>
        !isUnknown(p) &&
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        Math.abs(p.latitude) <= 90 &&
        Math.abs(p.longitude) <= 180
    )
    .map((p) => ({
      ...p,
      point: project(p.latitude, p.longitude),
      km: kmBetween(PUTZ, { lat: p.latitude, lng: p.longitude }),
    }));

export type Stop = {
  key: string; // its color, which stays put while people come and go
  color: string;
  labels: string[]; // most people first
  people: Located[];
  far: boolean;
  km: number; // to its farthest person
};

const colorRank = (color: string) => {
  const i = COLOR_ORDER.indexOf(color);
  return i === -1 ? COLOR_ORDER.length : i;
};

const byTourOrder = (a: string, b: string) => colorRank(a) - colorRank(b) || a.localeCompare(b);

export const buildStops = (located: Located[]): Stop[] => {
  const byColor = new Map<string, Located[]>();
  for (const person of located) byColor.set(person.color, [...(byColor.get(person.color) ?? []), person]);

  return [...byColor.keys()].sort(byTourOrder).map((color) => {
    const people = byColor.get(color)!.sort((a, b) => a.name.localeCompare(b.name));
    const counts = new Map<string, number>();
    for (const { label } of people) counts.set(label, (counts.get(label) ?? 0) + 1);
    const km = Math.max(...people.map((p) => p.km));
    return {
      key: color,
      color,
      labels: [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b)),
      people,
      far: km > FAR_KM,
      km,
    };
  });
};

// The stop after `key` in tour order (the next color along if that one has emptied out), wrapping.
export const nextStop = (stops: Stop[], key: string | null): Stop | undefined =>
  (key === null ? undefined : stops.find((stop) => byTourOrder(stop.key, key) > 0)) ?? stops[0];

// What the camera has to fit for a stop: its people, plus Putz when it's far.
export const stopPoints = (stop: Stop): Point[] => [
  ...stop.people.map((p) => p.point),
  ...(stop.far ? [HOME] : []),
];
