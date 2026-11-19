import { boundsOf, frameBounds, toScreen, type Camera, type Size } from "./camera";
import { HOME, stopPoints, type Located, type Stop } from "./stops";

// Name tags for the people at a stop: a column of tags either side of it, each tied to its dot by a
// thin leader, so a building full of people still gets one legible name apiece. Each column sits its
// tags a little above their dots (so leaders leave at an angle) as near as they'll go without touching. The camera frames the stop with room
// left for both columns, so tags never cover the stop or run off the map.

export type TagInput = { id: string; x: number; y: number; width: number; more?: number }; // dot on screen, tag width
export type Tag = {
  id: string;
  side: -1 | 1; // left or right of the stop
  dotX: number;
  dotY: number;
  x: number; // the tag's inner edge (nearest its dot)
  y: number; // its vertical middle
  width: number;
  more?: number; // a "+N" tag standing in for people there wasn't room to name
};
export type TagMetrics = { height: number; pitch: number; gap: number; lift?: number }; // lift: how far above its dot a tag aims
export type Area = { left: number; top: number; right: number; bottom: number };

// How many of the dots (sorted west to east) go in the left column: those west of the stop's middle,
// kept within a third of an even split so a lopsided stop doesn't pile one column up.
export const leftCount = (xs: number[], middle: number) => {
  const west = xs.filter((x) => x < middle).length;
  const n = xs.length;
  return n < 3 ? west : Math.min(Math.max(west, Math.floor(n / 3)), Math.ceil((2 * n) / 3));
};

// Middles for one column's tags, given their dots' heights in order: each as close to its dot as it
// can be (least squares) with tags `pitch` apart, all within [top, bottom].
export const stack = (ys: number[], pitch: number, top: number, bottom: number): number[] => {
  // Shifting each by its slot (y - i * pitch) turns "pitch apart" into "in order": pool violators.
  const pools: { sum: number; count: number }[] = [];
  ys.forEach((y, i) => {
    pools.push({ sum: y - i * pitch, count: 1 });
    while (pools.length > 1) {
      const [prev, last] = pools.slice(-2);
      if (prev.sum / prev.count <= last.sum / last.count) break;
      pools.splice(-2, 2, { sum: prev.sum + last.sum, count: prev.count + last.count });
    }
  });
  const lowest = bottom - (ys.length - 1) * pitch;
  const middles: number[] = [];
  for (const { sum, count } of pools) {
    const start = Math.min(Math.max(sum / count, top), lowest);
    for (let i = 0; i < count; i++) middles.push(start + middles.length * pitch);
  }
  return middles;
};

export const fitsColumn = (count: number, area: Area, { height, pitch }: TagMetrics) =>
  count === 0 || (count - 1) * pitch + height <= area.bottom - area.top;

export const layoutTags = (
  left: TagInput[],
  right: TagInput[],
  stop: { minX: number; maxX: number }, // the stop's extent on screen
  area: Area,
  metrics: TagMetrics
): Tag[] => {
  const column = (side: -1 | 1, members: TagInput[]): Tag[] => {
    if (!members.length) return [];
    const widest = Math.max(...members.map((m) => m.width));
    const x =
      side < 0
        ? Math.max(stop.minX - metrics.gap, area.left + widest)
        : Math.min(stop.maxX + metrics.gap, area.right - widest);
    // A "+N" tag has no dot (y is Infinity), so it sorts last and takes the column's last slot.
    const byY = [...members].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
    const half = metrics.height / 2;
    const lift = metrics.lift ?? 0;
    const ys = stack(byY.map((m) => m.y - lift), metrics.pitch, area.top + half, area.bottom - half);
    return byY.map((m, i) => ({ id: m.id, side, dotX: m.x, dotY: m.y, x, y: ys[i], width: m.width, more: m.more }));
  };
  return [...column(-1, left), ...column(1, right)];
};

// ---------------------------------------------------------------------------------------------
// A visit: where the camera stops and where the tags go.

export const MIN_UNIT = 11;
// Everything on the map is sized off this, so the hall TV, a laptop and a phone look alike.
export const baseUnit = ({ width, height }: Size) => Math.max(14, Math.min(width / 30, height / 20));
export const tagMetrics = (unit: number): TagMetrics => ({
  height: 1.4 * unit,
  pitch: 1.62 * unit,
  gap: 2.4 * unit,
  lift: 0.9 * unit, // under the gap, so the 45° leg always fits
});
const tagWidth = (nameWidth: number, unit: number) => nameWidth * unit + 0.4 * unit; // the name and a little air

export type Reserved = { top: number; bottom: number }; // px kept clear for the caption and credits

export type VisitPlan = { camera: Camera; unit: number; tags: Tag[] };

export const planVisit = ({
  size,
  stop,
  located,
  nameWidth,
  reserved,
}: {
  size: Size;
  stop: Stop | null; // null: the opening shot of everyone nearby
  located: Located[];
  nameWidth: (name: string) => number; // a name's width at 1px
  reserved: Reserved;
}): VisitPlan => {
  const unit0 = baseUnit(size);
  const area: Area = {
    left: unit0 * 0.5,
    right: size.width - unit0 * 0.5,
    top: reserved.top,
    bottom: size.height - reserved.bottom,
  };

  if (!stop) {
    const near = located.filter((p) => p.km < 12).map((p) => p.point);
    const bounds = boundsOf([HOME, ...near]);
    const pad = unit0 * 1.5;
    const insets = { top: area.top + pad, bottom: reserved.bottom + pad, left: pad, right: pad };
    return { camera: frameBounds(bounds, size, insets, Math.sqrt(size.width * size.height) / 2), unit: unit0, tags: [] };
  }

  // West to east; the split doesn't depend on the zoom, so it can be settled before the camera is.
  const people = [...stop.people].sort((a, b) => a.point.x - b.point.x || a.point.y - b.point.y);
  const points = stopPoints(stop);
  const bounds = boundsOf(points);
  const k = leftCount(people.map((p) => p.point.x), (bounds.minX + bounds.maxX) / 2);
  const sides = [people.slice(0, k), people.slice(k)];

  // Shrink the tags until both columns fit beside the stop and top to bottom (or bottom out).
  let unit = unit0;
  let metrics = tagMetrics(unit);
  let sidePad = 0;
  for (;;) {
    metrics = tagMetrics(unit);
    const widest = Math.max(...people.map((p) => tagWidth(nameWidth(p.name), unit)));
    sidePad = area.left + widest + metrics.gap;
    const roomy = size.width - 2 * sidePad >= size.width * 0.2;
    if ((roomy && sides.every((side) => fitsColumn(side.length, area, metrics))) || unit === MIN_UNIT) break;
    unit = Math.max(MIN_UNIT, unit * 0.9);
  }

  const half = metrics.height / 2;
  const insets = { top: area.top + half, bottom: reserved.bottom + half, left: sidePad, right: sidePad };
  // A stop in one building still shows the buildings around it: no closer than about 600 m across.
  const maxScale = Math.sqrt(size.width * size.height) / (stop.far ? 4 : 0.6);
  const camera = frameBounds(bounds, size, insets, maxScale);

  const onScreen = points.map((point) => toScreen(camera, size, point).x);
  const extent = { minX: Math.min(...onScreen), maxX: Math.max(...onScreen) };
  // Past what fits even at the smallest size, a column's last tag stands in for the rest.
  const rows = Math.max(2, Math.floor((area.bottom - area.top - metrics.height) / metrics.pitch) + 1);
  const [left, right] = sides.map((side, s): TagInput[] => {
    const inputs = side.map((p) => ({
      id: p.providerId,
      ...toScreen(camera, size, p.point),
      width: tagWidth(nameWidth(p.name), unit),
    }));
    if (inputs.length <= rows) return inputs;
    const shown = inputs.sort((a, b) => a.y - b.y).slice(0, rows - 1);
    const more = inputs.length - shown.length;
    return [...shown, { id: `more-${s}`, x: NaN, y: Infinity, width: tagWidth(nameWidth(`+${more}`), unit), more }];
  });

  return { camera, unit, tags: layoutTags(left, right, extent, area, metrics) };
};
