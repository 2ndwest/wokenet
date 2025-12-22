import { describe, expect, it } from "vitest";
import { findLocationLabel } from "../convex/utils/location_labels";

describe("location labels", () => {
  it("assigns Hayden for the test point", async () => {
    const match = findLocationLabel({
      lat: 42.36020855657603,
      lng: -71.08868525308307,
      timestamp: Date.now(),
    });
    expect(match?.label).toBe("HAYDEN");
  });

  it("assigns UNKNOWN for stale locations", async () => {
    const now = Date.now();
    const match = findLocationLabel({
      lat: 42.36020855657603,
      lng: -71.08868525308307,
      timestamp: now - 1000 * 60 * 60 * 4,
      now,
    });
    expect(match?.label).toBe("UNKNOWN");
  });

  it("assigns INTERNATIONAL when no polygon matches", async () => {
    const match = findLocationLabel({
      lat: 0,
      lng: 0,
      timestamp: Date.now(),
    });
    expect(match?.label).toBe("INTERNATIONAL");
  });
});
