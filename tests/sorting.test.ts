import { describe, expect, it } from "vitest";
import { alphaKey } from "../src/pages/DJs";

const sorted = (titles: string[]) =>
  [...titles].sort((a, b) => alphaKey(a).localeCompare(alphaKey(b)));

describe("alphaKey", () => {
  it("ignores leading punctuation and numbers", () => {
    // "&NUFF" files under N, "365 PARTYDOG" under P.
    expect(sorted(["Zebra", "&NUFF", "365 PARTYDOG"])).toEqual([
      "&NUFF",
      "365 PARTYDOG",
      "Zebra",
    ]);
  });

  it("folds accents so they sit with their plain letters", () => {
    expect(sorted(["Bravo", "Azótame", "Apple"])).toEqual(["Apple", "Azótame", "Bravo"]);
    expect(alphaKey("Ñero")).toBe(alphaKey("Nero"));
  });

  it("puts titles with no letters after Z", () => {
    expect(sorted(["2012", "Zebra", "365", "Apple"])).toEqual([
      "Apple",
      "Zebra",
      "2012",
      "365",
    ]);
  });

  it("is case-insensitive", () => {
    expect(sorted(["banana", "Apple", "CHERRY"])).toEqual(["Apple", "banana", "CHERRY"]);
  });

  it("keeps the rest of the title significant after the first letter", () => {
    expect(sorted(["[12] Beta", "[12] Alpha"])).toEqual(["[12] Alpha", "[12] Beta"]);
  });
});
