import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requirePutz } from "./utils/auth";

export const update = mutation({
  args: { fahrenheit: v.number() },
  handler: async (ctx, { fahrenheit }) => {
    await requirePutz(ctx);
    if (!Number.isFinite(fahrenheit)) throw new Error("Expected a finite Fahrenheit temperature");

    const previous = await ctx.db.query("livePigTemp").unique();
    const reading = { fahrenheit, updatedAt: Date.now() };
    if (previous) await ctx.db.patch(previous._id, reading);
    else await ctx.db.insert("livePigTemp", reading);
    return reading;
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);
    return await ctx.db.query("livePigTemp").unique();
  },
});
