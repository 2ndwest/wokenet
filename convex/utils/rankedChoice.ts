/** Instant-runoff (ranked choice) counting. Pure, so it can be unit tested. */

export type RankedChoiceRound = {
  /** Votes each remaining candidate holds this round. */
  counts: Record<string, number>;
  /** Ballots with no remaining candidate left on them. */
  exhausted: number;
  /** Who was knocked out at the end of the round (null on the final round). */
  eliminated: string | null;
};

export type RankedChoiceResult = {
  winner: string | null;
  rounds: RankedChoiceRound[];
};

/**
 * `candidates` in nomination order, `ballots` as lists of candidate ids, best
 * first. Each round every ballot counts for its highest choice still in the
 * race; whoever has the fewest is knocked out, until someone holds more than
 * half of the ballots still in play.
 *
 * Ties for last place go against whoever had fewer first choices, then fewer
 * mentions anywhere on a ballot, then whoever was nominated later.
 */
export const tallyRankedChoice = (
  candidates: string[],
  ballots: string[][],
): RankedChoiceResult => {
  const known = new Set(candidates);
  // Drop unknown ids and repeats, so a malformed ballot can't count twice.
  const clean = ballots
    .map((b) => [...new Set(b.filter((c) => known.has(c)))])
    .filter((b) => b.length > 0);
  if (clean.length === 0) return { winner: null, rounds: [] };

  const order = new Map(candidates.map((c, i) => [c, i]));
  const firstChoices = new Map<string, number>();
  const mentions = new Map<string, number>();
  for (const b of clean) {
    firstChoices.set(b[0], (firstChoices.get(b[0]) ?? 0) + 1);
    for (const c of b) mentions.set(c, (mentions.get(c) ?? 0) + 1);
  }

  const active = new Set(candidates);
  const rounds: RankedChoiceRound[] = [];

  for (;;) {
    const counts: Record<string, number> = {};
    for (const c of candidates) if (active.has(c)) counts[c] = 0;
    let inPlay = 0;
    for (const b of clean) {
      const top = b.find((c) => active.has(c));
      if (top === undefined) continue;
      counts[top]++;
      inPlay++;
    }
    const exhausted = clean.length - inPlay;
    const standing = Object.keys(counts);

    const leader = standing.reduce((a, b) => (counts[b] > counts[a] ? b : a));
    if (standing.length === 1 || counts[leader] * 2 > inPlay) {
      rounds.push({ counts, exhausted, eliminated: null });
      return { winner: leader, rounds };
    }

    // Weakest goes: fewest votes now, then the tie-breaks described above.
    const loser = standing.reduce((a, b) => {
      const keys = (c: string) => [
        counts[c],
        firstChoices.get(c) ?? 0,
        mentions.get(c) ?? 0,
        -order.get(c)!,
      ];
      const ka = keys(a);
      const kb = keys(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return kb[i] < ka[i] ? b : a;
      }
      return a;
    });
    active.delete(loser);
    rounds.push({ counts, exhausted, eliminated: loser });
  }
};
