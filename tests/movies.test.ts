import { describe, expect, it } from "vitest";
import { formatRuntime, parseImdbId, parseOmdbResponse } from "../convex/utils/movies";

describe("parseImdbId", () => {
  it("reads the id out of IMDb links", () => {
    expect(parseImdbId("https://www.imdb.com/title/tt0111161/")).toBe("tt0111161");
    expect(parseImdbId("https://m.imdb.com/title/tt0111161")).toBe("tt0111161");
    expect(parseImdbId(" imdb.com/title/tt15398776/?ref_=nv_sr_srsg_0 ")).toBe("tt15398776");
    expect(parseImdbId("TT0111161")).toBe("tt0111161");
  });

  it("rejects anything else", () => {
    expect(parseImdbId("https://www.imdb.com/name/nm0000151/")).toBeNull();
    expect(parseImdbId("https://letterboxd.com/film/heat-1995/")).toBeNull();
    expect(parseImdbId("tt123")).toBeNull();
    expect(parseImdbId("")).toBeNull();
  });
});

describe("parseOmdbResponse", () => {
  it("reads title, year, poster, runtime and genres", () => {
    const parsed = parseOmdbResponse("tt0111161", {
      Title: "The Shawshank Redemption",
      Year: "1994",
      Runtime: "142 min",
      Genre: "Drama, Crime",
      Poster: "https://example.com/poster.jpg",
      Response: "True",
    });
    expect(parsed).toEqual({
      ok: true,
      movie: {
        imdbId: "tt0111161",
        title: "The Shawshank Redemption",
        year: "1994",
        poster: "https://example.com/poster.jpg",
        runtimeMinutes: 142,
        genres: ["Drama", "Crime"],
      },
    });
  });

  it("treats N/A as missing", () => {
    const parsed = parseOmdbResponse("tt1", {
      Title: "Obscure",
      Year: "N/A",
      Runtime: "N/A",
      Genre: "N/A",
      Poster: "N/A",
      Response: "True",
    });
    expect(parsed).toEqual({
      ok: true,
      movie: {
        imdbId: "tt1",
        title: "Obscure",
        year: undefined,
        poster: undefined,
        runtimeMinutes: undefined,
        genres: [],
      },
    });
  });

  it("passes on OMDb's error", () => {
    expect(parseOmdbResponse("tt1", { Response: "False", Error: "Incorrect IMDb ID." })).toEqual({
      ok: false,
      error: "Incorrect IMDb ID.",
    });
    expect(parseOmdbResponse("tt1", null).ok).toBe(false);
  });
});

describe("formatRuntime", () => {
  it("formats minutes", () => {
    expect(formatRuntime(142)).toBe("2h 22m");
    expect(formatRuntime(120)).toBe("2h");
    expect(formatRuntime(45)).toBe("45m");
  });
});
