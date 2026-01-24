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
      // Sensors sometimes reboot and repost the same state multiple times,
      // we don't want to update the "last updated" timestamp in this case.
      if (existing.isLocked === args.isLocked) {
        console.log(`Bathroom ${args.bathroomId}: state unchanged (${args.isLocked ? "LOCKED" : "UNLOCKED"}), skipping update`);
        return;
      }
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
