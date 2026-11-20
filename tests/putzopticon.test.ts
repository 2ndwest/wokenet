import { describe, expect, it } from "vitest";
import { toPersonRows } from "../src/pages/putzopticon/rows";
import { flightPath, frameBounds, toScreen, type Camera } from "../src/pages/putzopticon/camera";
import { leftCount, planVisit, stack, type Tag } from "../src/pages/putzopticon/layout";
import { buildStops, HOME, locate, nextStop, type Person } from "../src/pages/putzopticon/stops";

const person = (name: string, label: string, color: string, latitude: number, longitude: number): Person => ({
  providerId: name.toLowerCase(),
  name,
  label,
  color,
  latitude,
  longitude,
});

const PEOPLE = [
  person("Juniper", "HAYDEN", "green", 42.36022, -71.0888),
  person("Otis", "HAYDEN", "green", 42.36018, -71.08871),
  person("Bram", "WOOD", "green", 42.36049, -71.08897),
  person("Bartholomew", "BEMIS", "darkgreen", 42.36077, -71.08838),
  person("Pilar", "MAIN GROUP", "yellow", 42.35995, -71.0921),
  person("Saoirse", "STATA", "yellow", 42.36165, -71.09065),
  person("Hugo", "DOWNTOWN", "red", 42.35368, -71.05831),
  person("Yara", "BOSTON LOGAN", "red", 42.36562, -71.00961),
  person("Sunny", "CALIFORNIA", "brown", 37.7793, -122.4193),
  person("Bao", "NEW YORK", "brown", 40.71277, -74.00597),
  person("Gus", "UNKNOWN", "dimgray", 42.3601, -71.0941),
];

// Roughly bold Mondwest: 0.55em a glyph.
const nameWidth = (name: string) => name.length * 0.55;

describe("toPersonRows", () => {
  it("keeps the board's order: color, alternating label length, label, name", () => {
    const rows = toPersonRows([
      { providerId: "a", name: "Zed", label: "WOOD", color: "green" },
      { providerId: "b", name: "Amy", label: "HAYDEN", color: "green" },
      { providerId: "c", name: "Cy", label: "GOODALE", color: "darkgreen" },
      { providerId: "d", name: "Bo", label: "BEMIS", color: "darkgreen" },
      { providerId: "e", name: "Al", label: "UNKNOWN", color: "dimgray" },
      { providerId: "f", name: "Ann", label: "HAYDEN", color: "green" },
    ]);
    // Green (even) sorts longer labels first; darkgreen (odd) shorter first; UNKNOWN last and dimmed.
    expect(rows.map((row) => row.name)).toEqual(["Amy", "Ann", "Zed", "Bo", "Cy", "Al"]);
    expect(rows.map((row) => !!row.dimmed)).toEqual([false, false, false, false, false, true]);
  });
});

describe("stops", () => {
  const stops = buildStops(locate(PEOPLE));

  const keys = stops.map((stop) => stop.key);

  it("makes a stop per cluster of each color, in COLOR_ORDER then nearest first, leaving UNKNOWN off", () => {
    // Downtown and Logan are both red but kilometres apart; out of state stays together.
    expect(keys).toEqual(["green:bram", "darkgreen:bartholomew", "yellow:pilar", "red:hugo", "red:yara", "brown:bao"]);
    expect(stops.flatMap((stop) => stop.people).some((p) => p.label === "UNKNOWN")).toBe(false);
  });

  it("lists a stop's places most-populous first", () => {
    expect(stops[0].labels).toEqual(["HAYDEN", "WOOD"]);
  });

  it("frames stops past walking distance with Putz", () => {
    expect(stops.map((stop) => stop.far)).toEqual([false, false, false, true, true, true]);
    expect(stops[5].km).toBeGreaterThan(4000);
  });

  it("moves on to the next stop along, wrapping, even when the current one has emptied", () => {
    const at = (key: string) => stops.find((stop) => stop.key === key)!;
    expect(nextStop(stops, null)?.key).toBe("green:bram");
    expect(nextStop(stops, at("yellow:pilar"))?.key).toBe("red:hugo");
    expect(nextStop(stops, at("red:hugo"))?.key).toBe("red:yara");
    // A purple stop that's since emptied sits between yellow and red.
    expect(nextStop(stops, { ...at("yellow:pilar"), key: "purple:x", color: "purple" })?.key).toBe("red:hugo");
    expect(nextStop(stops, at("brown:bao"))?.key).toBe("green:bram");
    expect(nextStop([], null)).toBeUndefined();
  });
});

describe("stack", () => {
  it("keeps tags level with their dots when there's room", () => {
    expect(stack([100, 200, 300], 40, 0, 1000)).toEqual([100, 200, 300]);
  });

  it("spreads a pile-up evenly around its middle, a pitch apart", () => {
    expect(stack([500, 500, 500], 40, 0, 1000)).toEqual([460, 500, 540]);
  });

  it("stays inside its bounds", () => {
    expect(stack([0, 5, 10], 40, 50, 1000)).toEqual([50, 90, 130]);
    expect(stack([990, 995, 1000], 40, 0, 1000)).toEqual([920, 960, 1000]);
  });
});

describe("leftCount", () => {
  it("sends the west side left", () => {
    expect(leftCount([0, 10, 90, 100], 50)).toBe(2);
    expect(leftCount([10], 50)).toBe(1);
    expect(leftCount([60], 50)).toBe(0);
  });

  it("doesn't let one column take much more than its share", () => {
    expect(leftCount([0, 1, 2, 3, 4, 100], 50)).toBe(4);
    expect(leftCount([0, 98, 99, 100, 101, 102], 50)).toBe(2);
  });
});

describe("planVisit", () => {
  const located = locate(PEOPLE);
  const stops = buildStops(located);
  const reserved = { top: 110, bottom: 40 };
  const sizes = [
    { width: 1080, height: 935 }, // portrait hall TV
    { width: 1920, height: 515 }, // landscape
    { width: 390, height: 397 }, // phone
  ];

  const box = (tag: Tag, unit: number) => {
    const left = tag.side < 0 ? tag.x - tag.width : tag.x;
    return { left, right: left + tag.width, top: tag.y - 0.7 * unit, bottom: tag.y + 0.7 * unit };
  };

  for (const size of sizes) {
    for (const stop of stops) {
      it(`names everyone at ${stop.key} at ${size.width}x${size.height} without overlap or clipping`, () => {
        const { camera, unit, tags } = planVisit({ size, stop, located, nameWidth, reserved });
        expect(tags.map((tag) => tag.id).sort()).toEqual(stop.people.map((p) => p.providerId).sort());

        const boxes = tags.map((tag) => box(tag, unit));
        for (const b of boxes) {
          expect(b.left).toBeGreaterThanOrEqual(0);
          expect(b.right).toBeLessThanOrEqual(size.width);
          expect(b.top).toBeGreaterThanOrEqual(reserved.top - 0.01);
          expect(b.bottom).toBeLessThanOrEqual(size.height - reserved.bottom + 0.01);
        }
        boxes.forEach((a, i) =>
          boxes.slice(i + 1).forEach((b) => {
            const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
            expect(apart).toBe(true);
          })
        );

        // No tag sits on any of the stop's dots (or on Putz, when it's in frame).
        const points = [...stop.people.map((p) => p.point), ...(stop.far ? [HOME] : [])];
        for (const { x, y } of points.map((p) => toScreen(camera, size, p))) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(size.width);
          for (const b of boxes) expect(x > b.left && x < b.right && y > b.top && y < b.bottom).toBe(false);
        }
      });
    }
  }

  it("stands in a +N tag when a stop has more people than fit", () => {
    const crowd = Array.from({ length: 60 }, (_, i) =>
      person(`Person${i}`, "HAYDEN", "green", 42.3602 + (i % 7) * 0.00002, -71.0888 + i * 0.00001)
    );
    const crowded = buildStops(locate(crowd));
    const size = { width: 390, height: 397 };
    const { tags } = planVisit({ size, stop: crowded[0], located: locate(crowd), nameWidth, reserved });
    const more = tags.filter((tag) => tag.more !== undefined);
    expect(more.length).toBeGreaterThan(0);
    expect(tags.length - more.length + more.reduce((sum, tag) => sum + tag.more!, 0)).toBe(60);
    for (const tag of tags) expect(tag.y + 0.7 * 11).toBeLessThanOrEqual(size.height - reserved.bottom + 0.01);
  });
});

describe("camera", () => {
  const size = { width: 1080, height: 935 };

  it("fits bounds inside the insets, centered in what's left", () => {
    const camera = frameBounds({ minX: 0, minY: 0, maxX: 2, maxY: 1 }, size, { top: 100, right: 40, bottom: 40, left: 40 }, 1e9);
    const a = toScreen(camera, size, { x: 0, y: 0 });
    const b = toScreen(camera, size, { x: 2, y: 1 });
    expect(a.x).toBeCloseTo(40);
    expect(b.x).toBeCloseTo(1040);
    expect((a.y + b.y) / 2).toBeCloseTo((100 + 935 - 40) / 2);
  });

  it("flies from one camera to the other, pulling back on the way for a long hop", () => {
    const from: Camera = { x: 0, y: 0, scale: 900 };
    const to: Camera = { x: -4200, y: 500, scale: 0.15 };
    const path = flightPath(from, to, size);
    expect(path(0).x).toBeCloseTo(0);
    expect(path(0).scale).toBeCloseTo(900);
    expect(path(1)).toEqual(to);
    const xs = Array.from({ length: 11 }, (_, i) => path(i / 10).x);
    xs.slice(1).forEach((x, i) => expect(x).toBeLessThanOrEqual(xs[i] + 1e-9)); // always heading west
    for (let i = 0; i <= 10; i++) expect(Number.isFinite(path(i / 10).scale)).toBe(true);
  });

  it("zooms straight in or out when there's no distance to cover", () => {
    const path = flightPath({ x: 1, y: 1, scale: 10 }, { x: 1, y: 1, scale: 1000 }, size);
    expect(path(0.5).scale).toBeCloseTo(100);
    expect(path(0.5).x).toBe(1);
  });
});
