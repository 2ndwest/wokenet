import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requirePutz } from "./utils/auth";

export const updateDoorState = internalMutation({
  args: {
    doorId: v.string(),
    isOpen: v.boolean(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("doorStates")
      .withIndex("by_doorId", (q) => q.eq("doorId", args.doorId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isOpen: args.isOpen,
        timestamp: args.timestamp,
      });
    } else {
      await ctx.db.insert("doorStates", {
        doorId: args.doorId,
        isOpen: args.isOpen,
        timestamp: args.timestamp,
      });
    }
  },
});

export const getAllDoorStates = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    return await ctx.db.query("doorStates").collect();
  },
});
