import { describe, expect, it } from "vitest";
import { camelotToMusical, normalizeKey } from "../convex/utils/keys";

describe("normalizeKey", () => {
  it("passes Camelot through, tidied", () => {
    expect(normalizeKey("8A")).toBe("8A");
    expect(normalizeKey("8a")).toBe("8A");
    expect(normalizeKey(" 11b ")).toBe("11B");
    expect(normalizeKey("12A")).toBe("12A");
  });

  it("converts musical names to Camelot", () => {
    // A is minor and B is major, so relative keys share a number.
    expect(normalizeKey("Am")).toBe("8A");
    expect(normalizeKey("C")).toBe("8B");
    expect(normalizeKey("Em")).toBe("9A");
    expect(normalizeKey("G")).toBe("9B");
    expect(normalizeKey("Dm")).toBe("7A");
    expect(normalizeKey("F")).toBe("7B");
  });

  it("accepts the spellings rekordbox and Mixed In Key emit", () => {
    for (const raw of ["Am", "A min", "Amin", "A minor", "AMinor", "am"]) {
      expect(normalizeKey(raw)).toBe("8A");
    }
    for (const raw of ["C", "C maj", "Cmaj", "C major"]) {
      expect(normalizeKey(raw)).toBe("8B");
    }
  });

  it("handles enharmonic spellings", () => {
    expect(normalizeKey("C#m")).toBe("12A");
    expect(normalizeKey("Dbm")).toBe("12A");
    expect(normalizeKey("F#")).toBe("2B");
    expect(normalizeKey("Gb")).toBe("2B");
  });

  it("converts Open Key notation", () => {
    // Open Key 1d is C major, which is Camelot 8B.
    expect(normalizeKey("1d")).toBe("8B");
    expect(normalizeKey("2d")).toBe("9B");
    expect(normalizeKey("6d")).toBe("1B");
    expect(normalizeKey("1m")).toBe("8A");
  });

  it("returns undefined rather than guessing", () => {
    for (const raw of ["", "   ", "banana", "13A", "0A", "H", "Xm", undefined, null]) {
      expect(normalizeKey(raw)).toBeUndefined();
    }
  });

  it("round-trips back to a musical name", () => {
    expect(camelotToMusical("8A")).toBe("Am");
    expect(camelotToMusical("8B")).toBe("C");
    expect(camelotToMusical("10A")).toBe("Bm");
  });
});
