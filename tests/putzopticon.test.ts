import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { basemapDetail } from "../src/pages/putzopticon/basemap";
import { toPersonRows } from "../src/pages/putzopticon/rows";
import { flightPath, frameBounds, toScreen, viewBounds, type Camera } from "../src/pages/putzopticon/camera";
import { leftCount, planVisit, stack, type Tag } from "../src/pages/putzopticon/layout";
import { buildStops, HOME, locate, nextStop, tourStops, type Person } from "../src/pages/putzopticon/stops";
import { zoneGlow, zonePathData } from "../src/pages/putzopticon/zones";

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

  it("tours only around town for now, coming home from an out-of-state stop someone tapped", () => {
    const at = (key: string) => stops.find((stop) => stop.key === key)!;
    const international = buildStops(locate([...PEOPLE, person("Ines", "INTERNATIONAL", "lightblue", 48.8566, 2.3522)]));
    const tour = tourStops(international);
    expect(tour.map((stop) => stop.key)).toEqual(["green:bram", "darkgreen:bartholomew", "yellow:pilar", "red:hugo", "red:yara"]);
    expect(nextStop(tour, at("red:yara"))?.key).toBe("green:bram");
    expect(nextStop(tour, at("brown:bao"))?.key).toBe("green:bram");
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

describe("basemapDetail", () => {
  // As far as the bundled map really reaches.
  const { reach } = JSON.parse(
    readFileSync(new URL("../src/pages/putzopticon/basemap.json", import.meta.url), "utf8")
  ) as { reach: { region: number; streets: number } };
  const tv = { width: 1080, height: 935 };
  const phone = { width: 390, height: 397 };
  // What shows at the stop of someone on their own there, framed with Putz.
  const at = (latitude: number, longitude: number, size = tv, name = "Meadow") => {
    const located = locate([person(name, "MASSACHUSETTS", "brown", latitude, longitude)]);
    const { camera } = planVisit({ size, stop: buildStops(located)[0], located, nameWidth });
    return basemapDetail(camera, size, reach);
  };

  it("shows everything by campus", () => {
    expect(basemapDetail({ x: HOME.x, y: HOME.y, scale: 1600 }, tv, reach)).toEqual({ region: 1, arterials: 1, streets: 1 });
  });

  it("has streets right across the view for someone a few towns out", () => {
    for (const size of [tv, phone]) {
      const detail = at(42.304, -71.3109, size); // 18 km west, past where the streets used to stop
      expect(detail.region).toBe(1);
      expect(detail.streets).toBeGreaterThan(0.4);
    }
  });

  it("trades the streets for the regional map further out, then drops arterials", () => {
    for (const size of [tv, phone]) {
      expect(at(42.0181, -70.9984, size)).toEqual({ region: 1, arterials: 1, streets: 0 }); // 38 km south
      expect(at(42.4501, -73.2454, size)).toEqual({ region: 1, arterials: 0, streets: 0 }); // Pittsfield
    }
  });

  it("reaches anyone in Massachusetts, whatever their name's length does to the framing", () => {
    const corners = [
      [42.712, -73.2037], // Williamstown
      [42.1959, -73.3621], // Great Barrington
      [42.0584, -70.1787], // Provincetown
      [41.2835, -70.0995], // Nantucket
      [42.8126, -70.8773], // Newburyport
    ];
    for (const size of [tv, phone]) {
      for (const [latitude, longitude] of corners) {
        expect(at(latitude, longitude, size, "Bartholomew").region).toBe(1);
      }
    }
  });

  it("leaves the far-away map alone once most of the view is past the region", () => {
    expect(at(39.9526, -75.1652).region).toBeLessThan(0.5); // Philadelphia: just past it, mostly far-away
    expect(at(38.9072, -77.0369).region).toBe(0); // Washington
    expect(at(37.7793, -122.4193)).toEqual({ region: 0, arterials: 0, streets: 0 }); // San Francisco
  });

  it("fades with how much of the view the region covers", () => {
    const size = { width: 1000, height: 1000 };
    const scale = 1000 / (2 * reach.region); // exactly as wide as the region
    const detail = (x: number) => basemapDetail({ x, y: 0, scale }, size, reach).region;
    expect(detail(0)).toBe(1);
    expect(detail(reach.region * 0.5)).toBe(1); // a quarter of the view past the edge
    expect(detail(reach.region * 0.8)).toBeCloseTo(0.5); // 40% past it
    expect(detail(reach.region * 1.1)).toBe(0);
  });

  it("drops the streets before where they stop can come into view", () => {
    const size = { width: 1000, height: 1000 };
    const beyond = basemapDetail({ x: reach.streets, y: 0, scale: 100 }, size, reach); // 10 km across
    expect(beyond).toEqual({ region: 1, arterials: 1, streets: 0 });
  });

  it("draws land close in while the map is still loading", () => {
    expect(basemapDetail({ x: 0, y: 0, scale: 500 }, tv).region).toBe(1);
    expect(basemapDetail({ x: 0, y: 0, scale: 1 }, tv).region).toBe(0);
  });
});

describe("zones", () => {
  it("glows a zone less the more of the view's land it takes up", () => {
    const view = viewBounds({ x: 0, y: 0, scale: 10 }, { width: 100, height: 100 }); // 10 km square
    expect(view).toEqual({ minX: -5, minY: -5, maxX: 5, maxY: 5 });
    const everywhere = () => true;
    const west = (km: number) => (x: number) => x < km; // 7 columns of samples, 10/7 km apart
    expect(zoneGlow(view, west(-2), everywhere)).toBe(1); // 2 columns of 7: a shape with plenty around it
    expect(zoneGlow(view, west(1), everywhere)).toBeCloseTo((0.7 - 4 / 7) / 0.3); // 4 of 7
    expect(zoneGlow(view, west(2), everywhere)).toBe(0); // 5 of 7: most of what there is to see
    expect(zoneGlow(view, everywhere, everywhere)).toBe(0);
    expect(zoneGlow(view, () => false, everywhere)).toBe(1);
  });

  it("doesn't count the sea: a state that's all the land in view doesn't glow", () => {
    const view = viewBounds({ x: 0, y: 0, scale: 10 }, { width: 100, height: 100 });
    const west = (x: number) => x < -2;
    expect(zoneGlow(view, west, west)).toBe(0); // land to the west, all of it the zone's
    expect(zoneGlow(view, west, () => true)).toBe(1);
  });

  it("asks what's land only until it knows", () => {
    const view = viewBounds({ x: 0, y: 0, scale: 10 }, { width: 100, height: 100 });
    let asked = 0;
    const land = () => (asked++, true);
    expect(zoneGlow(view, (x) => x < -4, land)).toBe(1); // one column of seven
    expect(asked).toBe(11); // enough for the zone's seven to be under 40%, not all 42
  });

  it("projects Polygon and MultiPolygon rings into closed SVG paths", () => {
    const poly = zonePathData({
      type: "Polygon",
      coordinates: [
        [
          [-71.0921, 42.3592],
          [-71.0883, 42.3604],
          [-71.0921, 42.3592],
        ],
      ],
    });
    expect(poly.startsWith("M0,0L")).toBe(true);
    expect(poly.endsWith("Z")).toBe(true);

    const multi = zonePathData({
      type: "MultiPolygon",
      coordinates: [
        [[[-71.0921, 42.3592], [-71.09, 42.36], [-71.0921, 42.3592]]],
        [[[-71.08, 42.35], [-71.07, 42.36], [-71.08, 42.35]]],
      ],
    });
    expect(multi.match(/Z/g)?.length).toBe(2);
  });
});
