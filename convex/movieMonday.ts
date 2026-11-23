import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { parseImdbId, parseOmdbResponse } from "./utils/movies";
import { tallyRankedChoice } from "./utils/rankedChoice";

// Movie Monday is open to everyone, signed in or not, so none of this checks
// who is calling. The limits below are what stands in for that.
const MAX_NOMINATIONS = 40;
const MAX_VOTER_ID_LENGTH = 64;

type Result = { ok: true } | { ok: false; error: string };

const isClosed = async (ctx: QueryCtx) => (await ctx.db.query("movieVotingClosed").first()) !== null;

/** Counts this week's ballots. Nominations are in the order they came in. */
const tally = async (ctx: QueryCtx) => {
  const nominations = await ctx.db.query("movieNominations").collect();
  const ballots = await ctx.db.query("movieBallots").collect();
  const result = tallyRankedChoice(
    nominations.map((n) => n._id as string),
    ballots.map((b) => b.ranking as string[]),
  );
  return { nominations, ballots, result };
};

/** Everything the page needs. `voterId` is the caller's browser id, if any. */
export const getRound = query({
  args: { voterId: v.optional(v.string()) },
  handler: async (ctx, { voterId }) => {
    const { nominations, ballots, result } = await tally(ctx);
    const closed = await ctx.db.query("movieVotingClosed").first();

    const withHistory = await Promise.all(
      nominations.map(async (n) => {
        // Most recent time this one won, if it ever has.
        const watched = await ctx.db
          .query("movieHistory")
          .withIndex("by_imdbId", (q) => q.eq("imdbId", n.imdbId))
          .order("desc")
          .first();
        return { ...n, watchedAt: watched?.watchedAt ?? null };
      }),
    );

    const mine = voterId
      ? await ctx.db
          .query("movieBallots")
          .withIndex("by_voterId", (q) => q.eq("voterId", voterId))
          .first()
      : null;

    return {
      nominations: withHistory,
      ballotCount: ballots.filter((b) => b.ranking.length > 0).length,
      myRanking: mine?.ranking ?? [],
      // The count stays hidden until voting closes, so it can't sway anyone.
      closed: closed ? { closedAt: closed.closedAt, ...result } : null,
    };
  },
});

export const getHistory = query({
  args: {},
  handler: async (ctx) => {
    const history = await ctx.db.query("movieHistory").collect();
    return history.sort((a, b) => b.watchedAt - a.watchedAt);
  },
});

/** For the nominate action: is this title already up this week? */
export const findNomination = internalQuery({
  args: { imdbId: v.string() },
  handler: async (ctx, { imdbId }) => {
    if (await isClosed(ctx)) return "CLOSED" as const;
    const existing = await ctx.db
      .query("movieNominations")
      .withIndex("by_imdbId", (q) => q.eq("imdbId", imdbId))
      .first();
    return existing ? ("NOMINATED" as const) : ("FREE" as const);
  },
});

export const addNomination = internalMutation({
  args: {
    imdbId: v.string(),
    title: v.string(),
    year: v.optional(v.string()),
    poster: v.optional(v.string()),
    runtimeMinutes: v.optional(v.number()),
    genres: v.array(v.string()),
  },
  handler: async (ctx, movie): Promise<Result> => {
    if (await isClosed(ctx)) return { ok: false, error: "Voting is closed for this week." };
    const nominations = await ctx.db.query("movieNominations").collect();
    if (nominations.some((n) => n.imdbId === movie.imdbId)) {
      return { ok: false, error: `${movie.title} is already nominated.` };
    }
    if (nominations.length >= MAX_NOMINATIONS) {
      return { ok: false, error: `That's ${MAX_NOMINATIONS} nominations, the most a week can hold.` };
    }
    await ctx.db.insert("movieNominations", movie);
    return { ok: true };
  },
});

/** Nominates a film from its IMDb link, filling in poster, length and genres. */
export const nominate = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<Result> => {
    const imdbId = parseImdbId(url);
    if (!imdbId) {
      return { ok: false, error: "That doesn't look like an IMDb link (imdb.com/title/tt…)." };
    }

    const status = await ctx.runQuery(internal.movieMonday.findNomination, { imdbId });
    if (status === "CLOSED") return { ok: false, error: "Voting is closed for this week." };
    if (status === "NOMINATED") return { ok: false, error: "That one is already nominated." };

    // IMDb itself has no public API and turns away automated requests, so the
    // details come from OMDb, which is keyed by IMDb id.
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "Movie lookup isn't set up yet (OMDB_API_KEY is missing)." };
    }
    let body: unknown;
    try {
      const response = await fetch(
        `https://www.omdbapi.com/?i=${imdbId}&apikey=${encodeURIComponent(apiKey)}`,
      );
      body = await response.json();
    } catch {
      return { ok: false, error: "Couldn't reach the movie database. Try again in a bit." };
    }
    const parsed = parseOmdbResponse(imdbId, body);
    if (!parsed.ok) return parsed;

    return await ctx.runMutation(internal.movieMonday.addNomination, parsed.movie);
  },
});

/** Saves the caller's ranking, replacing any earlier one. Empty withdraws it. */
export const castBallot = mutation({
  args: { voterId: v.string(), ranking: v.array(v.id("movieNominations")) },
  handler: async (ctx, { voterId, ranking }): Promise<Result> => {
    if (voterId.length === 0 || voterId.length > MAX_VOTER_ID_LENGTH) {
      return { ok: false, error: "Bad voter id." };
    }
    if (await isClosed(ctx)) return { ok: false, error: "Voting is closed for this week." };

    // Keep only real nominations, each once.
    const clean = [];
    for (const id of new Set(ranking)) {
      if (await ctx.db.get(id)) clean.push(id);
    }

    const existing = await ctx.db
      .query("movieBallots")
      .withIndex("by_voterId", (q) => q.eq("voterId", voterId))
      .first();
    if (clean.length === 0) {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) {
      await ctx.db.patch(existing._id, { ranking: clean });
    } else {
      await ctx.db.insert("movieBallots", { voterId, ranking: clean });
    }
    return { ok: true };
  },
});

/** Stops voting and reveals the winner. `reopenVoting` undoes it. */
export const closeVoting = mutation({
  args: {},
  handler: async (ctx) => {
    if (!(await isClosed(ctx))) await ctx.db.insert("movieVotingClosed", { closedAt: Date.now() });
  },
});

export const reopenVoting = mutation({
  args: {},
  handler: async (ctx) => {
    for (const row of await ctx.db.query("movieVotingClosed").collect()) await ctx.db.delete(row._id);
  },
});

const wipeRound = async (ctx: MutationCtx) => {
  for (const table of ["movieNominations", "movieBallots", "movieVotingClosed"] as const) {
    for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id);
  }
};

/**
 * Throws away this week's nominations and votes. Cannot be undone, and
 * nothing is added to the watched list: only the weekly reset does that.
 */
export const clearRound = mutation({
  args: {},
  handler: async (ctx) => {
    await wipeRound(ctx);
  },
});

/**
 * Run by the cron once Monday night is over. Whatever was winning goes on the
 * watched list (whether or not anyone pressed Close), then the week starts
 * clean.
 */
export const weeklyReset = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { nominations, result } = await tally(ctx);
    const winner: Doc<"movieNominations"> | undefined = nominations.find(
      (n) => n._id === result.winner,
    );
    if (winner) {
      const { imdbId, title, year, poster, runtimeMinutes, genres } = winner;
      await ctx.db.insert("movieHistory", {
        imdbId,
        title,
        year,
        poster,
        runtimeMinutes,
        genres,
        // This runs in the small hours of Tuesday; date it to Monday evening.
        watchedAt: Date.now() - 12 * 60 * 60 * 1000,
      });
    }
    await wipeRound(ctx);
    return { recorded: winner?.title ?? null };
  },
});
