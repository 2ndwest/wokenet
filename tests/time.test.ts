import { describe, expect, it } from "vitest";
import { formatET, fromET, toET } from "../src/utils/time";

describe("Eastern Time", () => {
  it("reads ET wall-clock times as the right instant, in and out of DST", () => {
    expect(fromET("2026-11-22", "20:00")).toBe(Date.UTC(2026, 10, 23, 1, 0)); // EST, UTC-5
    expect(fromET("2026-07-04", "12:00")).toBe(Date.UTC(2026, 6, 4, 16, 0)); // EDT, UTC-4
    expect(fromET("2026-03-08", "03:30")).toBe(Date.UTC(2026, 2, 8, 7, 30)); // just after spring forward
    expect(fromET("2026-11-01", "00:15")).toBe(Date.UTC(2026, 10, 1, 4, 15)); // just before fall back
  });

  it("round-trips", () => {
    const ms = Date.UTC(2026, 0, 15, 3, 45);
    const { date, time } = toET(ms);
    expect([date, time]).toEqual(["2026-01-14", "22:45"]);
    expect(fromET(date, time)).toBe(ms);
  });

  it("labels times in ET", () => {
    expect(formatET(Date.UTC(2026, 10, 23, 1, 0))).toBe("Sun, Nov 22, 8:00 PM ET");
  });
});
