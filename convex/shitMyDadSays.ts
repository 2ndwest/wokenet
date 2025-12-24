import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
import { requirePutz } from "./utils/auth";

export const insertSaying = internalMutation({
  args: schema.tables.shitMyDadSays.validator,
  handler: async (ctx, args) => {
    await ctx.db.insert("shitMyDadSays", { ...args, voteCount: 0 });
  },
});

export const getSayings = query({
  args: {
    sortBy: v.optional(v.union(v.literal("recent"), v.literal("top"))),
  },
  handler: async (ctx, { sortBy = "recent" }) => {
    const { user } = await requirePutz(ctx);

    const items = await ctx.db.query("shitMyDadSays").collect();

    // Get all of the current user's votes in one query
    const userVotes = await ctx.db
      .query("smdsVotes")
      .withIndex("by_user_saying", (q) => q.eq("userId", user._id))
      .collect();

    const userVoteSet = new Set(userVotes.map((v) => v.sayingId));

    const sayingsWithVoteStatus = items.map((item) => ({
      ...item,
      hasVoted: userVoteSet.has(item._id),
    }));

    // Sort based on sortBy parameter
    if (sortBy === "top") {
      return sayingsWithVoteStatus.sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0));
    }

    return sayingsWithVoteStatus.sort((a, b) => b.timestamp - a.timestamp);
  },
});

export const toggleVote = mutation({
  args: {
    sayingId: v.id("shitMyDadSays"),
  },
  handler: async (ctx, { sayingId }) => {
    const { user } = await requirePutz(ctx);

    // Check if user already voted
    const existingVote = await ctx.db
      .query("smdsVotes")
      .withIndex("by_user_saying", (q) => q.eq("userId", user._id).eq("sayingId", sayingId))
      .unique();

    const saying = await ctx.db.get(sayingId);
    if (!saying) throw new Error("Saying not found");

    if (existingVote) {
      // Remove vote
      await ctx.db.delete(existingVote._id);
      await ctx.db.patch(sayingId, { voteCount: (saying.voteCount ?? 0) - 1 });
    } else {
      // Add vote
      await ctx.db.insert("smdsVotes", { sayingId, userId: user._id });
      await ctx.db.patch(sayingId, { voteCount: (saying.voteCount ?? 0) + 1 });
    }
  },
});
