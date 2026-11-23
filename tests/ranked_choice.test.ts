import { describe, expect, it } from "vitest";
import { tallyRankedChoice } from "../convex/utils/rankedChoice";

describe("tallyRankedChoice", () => {
  it("has no winner without ballots", () => {
    expect(tallyRankedChoice(["a", "b"], [])).toEqual({ winner: null, rounds: [] });
    expect(tallyRankedChoice(["a", "b"], [[]]).winner).toBeNull();
  });

  it("ends in one round on an outright majority", () => {
    const result = tallyRankedChoice(["a", "b", "c"], [["a"], ["a", "b"], ["b"]]);
    expect(result.winner).toBe("a");
    expect(result.rounds).toEqual([{ counts: { a: 2, b: 1, c: 0 }, exhausted: 0, eliminated: null }]);
  });

  it("moves votes to the next choice when a candidate is knocked out", () => {
    // a leads on first choices, but c's voters prefer b.
    const ballots = [["a"], ["a"], ["a"], ["a"], ["b"], ["b"], ["b"], ["c", "b"], ["c", "b"]];
    const result = tallyRankedChoice(["a", "b", "c"], ballots);
    expect(result.rounds[0]).toEqual({ counts: { a: 4, b: 3, c: 2 }, exhausted: 0, eliminated: "c" });
    expect(result.rounds[1]).toEqual({ counts: { a: 4, b: 5 }, exhausted: 0, eliminated: null });
    expect(result.winner).toBe("b");
  });

  it("sets aside ballots with nobody left on them", () => {
    const ballots = [["a"], ["a"], ["b"], ["b"], ["b"], ["c"], ["c", "a"]];
    const result = tallyRankedChoice(["a", "b", "c"], ballots);
    // a and c tie for last on 2; c is on fewer ballots overall, so c goes and
    // the ballot that only named c drops out.
    expect(result.rounds[0].eliminated).toBe("c");
    // Level on 3 each: a had fewer first choices, so a goes.
    expect(result.rounds[1]).toEqual({ counts: { a: 3, b: 3 }, exhausted: 1, eliminated: "a" });
    expect(result.rounds[2]).toEqual({ counts: { b: 3 }, exhausted: 4, eliminated: null });
    expect(result.winner).toBe("b");
  });

  it("breaks a last-place tie against the one mentioned less", () => {
    // b and c both have one first choice; c also appears lower on another ballot.
    const ballots = [["a"], ["a"], ["b"], ["c"], ["a", "c"], ["d"], ["d"], ["d"]];
    const result = tallyRankedChoice(["a", "b", "c", "d"], ballots);
    expect(result.rounds[0].eliminated).toBe("b");
  });

  it("ignores unknown ids and repeats on a ballot", () => {
    const result = tallyRankedChoice(["a", "b"], [["zzz", "b", "b"], ["a"], ["b"]]);
    expect(result.rounds[0].counts).toEqual({ a: 1, b: 2 });
    expect(result.winner).toBe("b");
  });

  it("names the only nomination with a vote as the winner", () => {
    expect(tallyRankedChoice(["a"], [["a"]]).winner).toBe("a");
  });
});
