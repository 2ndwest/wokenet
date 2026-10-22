import { describe, expect, it } from "vitest";
import { duplicateKey, groupDuplicates, normalizeTitle } from "../convex/utils/duplicates";

const track = (
  _id: string,
  title: string,
  durationSec: number | undefined,
  quality: string,
  uploadedAt = 1,
) => ({ _id, title, durationSec, quality, uploadedAt });

describe("normalizeTitle", () => {
  it("strips our playlist-position prefix", () => {
    expect(normalizeTitle("004. AJ Tracey - West Ten")).toBe(normalizeTitle("AJ Tracey - West Ten"));
  });

  it("strips trailing download-site ids", () => {
    // Real example: the same track arrived from two sources.
    expect(normalizeTitle("2 Live Crew - We Want Some [BERGE Remix]-639308762")).toBe(
      normalizeTitle("2 Live Crew - We Want Some [BERGE Remix]"),
    );
  });

  it("ignores punctuation, case and spacing", () => {
    expect(normalizeTitle("Azótame!")).toBe(normalizeTitle("azotame"));
    expect(normalizeTitle("365  PARTYDOG")).toBe(normalizeTitle("365partydog"));
  });
});

describe("duplicateKey", () => {
  it("matches the same recording at different bitrates", () => {
    expect(duplicateKey("365 PARTYDOG", 184.2)).toBe(duplicateKey("365 partydog", 184.4));
  });

  it("separates tracks of different length", () => {
    // An edit or remix is a different recording, even with the same name.
    expect(duplicateKey("Von dutch", 180)).not.toBe(duplicateKey("Von dutch", 212));
  });

  it("refuses to guess without a duration", () => {
    expect(duplicateKey("Some Track", undefined)).toBeNull();
    expect(duplicateKey("Some Track", 0)).toBeNull();
  });

  it("refuses titles too generic to match on", () => {
    expect(duplicateKey("3", 180)).toBeNull();
  });
});

describe("groupDuplicates", () => {
  it("keeps the highest quality copy", () => {
    const groups = groupDuplicates([
      track("a", "365 PARTYDOG", 184, "aac-96"),
      track("b", "365 PARTYDOG", 184, "lossless"),
      track("c", "365 PARTYDOG", 184, "aac-160"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep._id).toBe("b");
    expect(groups[0].drop.map((d) => d._id).sort()).toEqual(["a", "c"]);
  });

  it("breaks quality ties by keeping the oldest", () => {
    const groups = groupDuplicates([
      track("newer", "Von dutch", 200, "mp3-320", 2000),
      track("older", "Von dutch", 200, "mp3-320", 1000),
    ]);
    expect(groups[0].keep._id).toBe("older");
  });

  it("leaves genuinely distinct tracks alone", () => {
    expect(
      groupDuplicates([
        track("a", "Von dutch", 180, "mp3-320"),
        track("b", "Von dutch", 212, "mp3-320"), // an edit: different length
        track("c", "Something Else", 180, "mp3-320"),
      ]),
    ).toEqual([]);
  });

  it("ignores tracks with no duration rather than merging blind", () => {
    expect(
      groupDuplicates([
        track("a", "Mystery", undefined, "mp3-320"),
        track("b", "Mystery", undefined, "aac-96"),
      ]),
    ).toEqual([]);
  });
});
