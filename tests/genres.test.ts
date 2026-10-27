import { describe, expect, it } from "vitest";
import {
  normalizeGenre,
  normalizeGenres,
  normalizeUserGenre,
  normalizeUserGenres,
} from "../convex/utils/genres";

describe("normalizeUserGenre", () => {
  it("keeps whatever a person deliberately typed", () => {
    // None of these survive the metadata normalizer, and that's the point.
    expect(normalizeUserGenre("certified banger music")).toEqual(["Certified Banger Music"]);
    expect(normalizeUserGenre("music")).toEqual(["Music"]);
    expect(normalizeUserGenre("gym sesh bangers")).toEqual(["Gym Sesh Bangers"]);
  });

  it("still folds aliases so hand-typed tags match existing ones", () => {
    expect(normalizeUserGenre("ukgarage")).toEqual(["UK Garage"]);
    expect(normalizeUserGenre("dnb")).toEqual(["Drum & Bass"]);
    expect(normalizeUserGenre("  TECHNO  ")).toEqual(["Techno"]);
  });

  it("keeps SHOUTING on custom tags, since that's deliberate", () => {
    expect(normalizeUserGenre("PUTZ CLASSICS")).toEqual(["PUTZ CLASSICS"]);
    expect(normalizeUserGenre("BANGERS")).toEqual(["BANGERS"]);
    // ...but a known genre still folds, so chips don't fragment.
    expect(normalizeUserGenre("TECHNO")).toEqual(["Techno"]);
  });

  it("drops only genuinely empty input, and dedupes", () => {
    expect(normalizeUserGenre("   ")).toEqual([]);
    expect(normalizeUserGenres(["Techno", "techno", "  "])).toEqual(["Techno"]);
  });
});

describe("normalizeGenre", () => {
  it("collapses case and spacing variants onto one tag", () => {
    for (const raw of ["Jersey Club", "JERSEY CLUB", "JERSEYCLUB", "jersey", "JERSEY CLUB "]) {
      expect(normalizeGenre(raw)).toEqual(["Jersey Club"]);
    }
    for (const raw of ["Techno", "TECHNO", " techno "]) {
      expect(normalizeGenre(raw)).toEqual(["Techno"]);
    }
    for (const raw of ["Baile Funk", "BAILE FUNK", "Bailefunk", "baile"]) {
      expect(normalizeGenre(raw)).toEqual(["Baile Funk"]);
    }
  });

  it("folds aliases, typos and accents together", () => {
    for (const raw of ["Reggaeton", "regeton", "Reguetón", "Reggaeton "]) {
      expect(normalizeGenre(raw)).toEqual(["Reggaeton"]);
    }
    // Note the typo'd third spelling, which appears in the library.
    for (const raw of ["GUARACHATON", "Guarachaton", "GURACHATON"]) {
      expect(normalizeGenre(raw)).toEqual(["Guarachatón"]);
    }
    expect(normalizeGenre("ukgarage")).toEqual(["UK Garage"]);
    expect(normalizeGenre("nukg")).toEqual(["UK Garage"]);
    expect(normalizeGenre("Electronica")).toEqual(["Electronic"]);
  });

  it("keeps genres whose names contain a separator", () => {
    expect(normalizeGenre("Drum & Bass")).toEqual(["Drum & Bass"]);
    expect(normalizeGenre("drum and bass")).toEqual(["Drum & Bass"]);
    expect(normalizeGenre("dnb")).toEqual(["Drum & Bass"]);
    expect(normalizeGenre("Dance & EDM")).toEqual(["Dance & EDM"]);
    expect(normalizeGenre("R&B")).toEqual(["R&B"]);
  });

  it("splits genuine multi-genre strings", () => {
    expect(normalizeGenre("hard techno")).toEqual(["Hard Techno"]);
    expect(normalizeGenre("baile funk / jersey club")).toEqual(["Baile Funk", "Jersey Club"]);
    // Three known genres still all survive, even past the spam threshold.
    expect(normalizeGenre("house, techno, garage")).toEqual(["House", "Techno", "Garage"]);
  });

  it("drops artist names riding along in the genre field", () => {
    // Real example from the library: one genre plus two artist names.
    expect(normalizeGenre("House, Dombresky, SHELLS")).toEqual(["House"]);
  });

  it("throws away junk genres", () => {
    for (const raw of ["music", "Other", "misc", "unknown", "", "   ", "free dl", "#FREEDL", "DL"]) {
      expect(normalizeGenre(raw)).toEqual([]);
    }
  });

  it("drops technical metadata that leaks into the genre field", () => {
    expect(normalizeGenre("soundcloud:source=android-3rdparty-upload")).toEqual([]);
  });

  it("keeps only recognized genres when the field is keyword spam", () => {
    // Real examples from the library: artist names and filler words comma-spammed.
    const spam = normalizeGenre(
      "Sexyy Red, DJ Sliink, Remix, Rap, Looking, For, The, Hoes, Boilerroom",
    );
    expect(spam).toContain("Remix");
    expect(spam).toContain("Hip Hop");
    expect(spam).not.toContain("Sexyy Red");
    expect(spam).not.toContain("Looking");
    expect(spam).not.toContain("Boilerroom");

    const latin = normalizeGenre(
      "regeton, Reggaeton, latinclub, latincore, uwuaracha, moneymusic, jersey club, guaracha",
    );
    expect(latin).toContain("Reggaeton");
    expect(latin).toContain("Jersey Club");
    expect(latin).not.toContain("Moneymusic");

    const alu = normalizeGenre(
      "Dj,, Alu,, Mix,, Alu, AluMix,, Perreo,, Neo, Mix, 2024,, nuevo,, Nuevo, El, Bogueto,, Ñero",
    );
    expect(alu).toContain("Perreo");
    expect(alu).not.toContain("Alumix");
    expect(alu).not.toContain("2024");
  });

  it("never returns duplicates", () => {
    expect(normalizeGenre("techno, Techno, TECHNO")).toEqual(["Techno"]);
    expect(normalizeGenres(["House", "house", "HOUSE"])).toEqual(["House"]);
  });

  it("preserves unknown but plausible two-word genres", () => {
    expect(normalizeGenre("Latina Bounce")).toEqual(["Latina Bounce"]);
    expect(normalizeGenre("Speed House")).toEqual(["Speed House"]);
  });

  it("drops long unknown strings that are pack or track names", () => {
    expect(normalizeGenre("Pack do kLap")).toEqual([]);
  });

  it("treats hip hop and rap as one tag, however it's spelled", () => {
    for (const raw of ["Hip-hop & Rap", "hip hop", "Hip-Hop", "HIPHOP", "rap", "Hip-hop/Rap", "UK Rap"]) {
      expect(normalizeGenre(raw)).toEqual(["Hip Hop"]);
    }
  });

  it("folds hyphen, spacing and trailing 'music' variants", () => {
    expect(normalizeGenre("Lo-Fi")).toEqual(["Lo-Fi"]);
    expect(normalizeGenre("uk-garage")).toEqual(["UK Garage"]);
    expect(normalizeGenre("Club Music")).toEqual(["Club"]);
    expect(normalizeGenre("house music")).toEqual(["House"]);
    expect(normalizeGenre("R&B & Soul")).toEqual(["R&B"]);
  });
});
