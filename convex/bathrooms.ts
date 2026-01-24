import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requirePutz } from "./utils/auth";

export const updateLockState = internalMutation({
  args: {
    bathroomId: v.string(),
    isLocked: v.boolean(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("bathrooms")
      .withIndex("by_bathroomId", (q) => q.eq("bathroomId", args.bathroomId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isLocked: args.isLocked,
        timestamp: args.timestamp,
      });
    } else {
      await ctx.db.insert("bathrooms", {
        bathroomId: args.bathroomId,
        isLocked: args.isLocked,
        timestamp: args.timestamp,
      });
    }
  },
});

export const getBathrooms = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    return await ctx.db.query("bathrooms").collect();
  },
});
