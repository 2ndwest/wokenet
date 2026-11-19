import { describe, expect, it } from "vitest";
import {
  EVERYTHING,
  isListed,
  KINDS,
  parseFilter,
  serializeFilter,
  type Filter,
  type Kind,
  type Level,
} from "../src/utils/restroomFilter";

// Every sort of restroom there is: each kind, single stall or not.
const RESTROOMS = KINDS.flatMap((kind) => [
  { kind, single: true },
  { kind, single: false },
]);

const LEVELS: Level[] = ["none", "single", "all"];
const EVERY_FILTER: Filter[] = LEVELS.flatMap((allGender) =>
  LEVELS.flatMap((women) => LEVELS.map((men) => ({ "all-gender": allGender, women, men })))
);

describe("isListed", () => {
  it("lists a kind's single stalls only, all of it, or none of it", () => {
    const filter: Filter = { "all-gender": "all", women: "single", men: "none" };
    expect(RESTROOMS.filter((r) => isListed(filter, r))).toEqual([
      { kind: "all-gender", single: true },
      { kind: "all-gender", single: false },
      { kind: "women", single: true },
    ]);
  });
});

describe("parseFilter", () => {
  it("lists everything until a choice is saved", () => {
    expect(parseFilter(undefined)).toEqual(EVERYTHING);
  });

  it("reads back every filter it saves", () => {
    for (const filter of EVERY_FILTER) expect(parseFilter(serializeFilter(filter))).toEqual(filter);
  });

  // The old filter was a set of kinds plus "single stall only", saved as the kinds then "single". Whatever it listed,
  // its cookie should still list exactly that.
  it("lists the same restrooms as every cookie saved by the old filter", () => {
    const subsets = (kinds: Kind[]): Kind[][] =>
      kinds.length === 0 ? [[]] : subsets(kinds.slice(1)).flatMap((rest) => [rest, [kinds[0], ...rest]]);

    for (const kinds of subsets(KINDS)) {
      for (const singleOnly of [false, true]) {
        // Kinds were saved in the order they were ticked, so try them both ways around.
        for (const order of [kinds, [...kinds].reverse()]) {
          const cookie = [...order, ...(singleOnly ? ["single"] : [])].join(",");
          const filter = parseFilter(cookie);
          const before = RESTROOMS.filter((r) => kinds.includes(r.kind) && (!singleOnly || r.single));
          expect(RESTROOMS.filter((r) => isListed(filter, r))).toEqual(before);
        }
      }
    }
  });

  it("reads the old cookies as the levels you'd expect", () => {
    expect(parseFilter("all-gender,women,men")).toEqual(EVERYTHING);
    expect(parseFilter("all-gender,men")).toEqual({ "all-gender": "all", women: "none", men: "all" });
    expect(parseFilter("all-gender,women,men,single")).toEqual({ "all-gender": "single", women: "single", men: "single" });
    expect(parseFilter("women,single")).toEqual({ "all-gender": "none", women: "single", men: "none" });
    expect(parseFilter("")).toEqual({ "all-gender": "none", women: "none", men: "none" });
  });
});
