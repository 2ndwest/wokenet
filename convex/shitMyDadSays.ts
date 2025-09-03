import { internalMutation, query } from "./_generated/server";
import schema from "./schema";
import { requirePutz } from "./utils/auth";

export const insertSaying = internalMutation({
  args: schema.tables.shitMyDadSays.validator,
  handler: async (ctx, args) => {
    await ctx.db.insert("shitMyDadSays", args);
  },
});

export const getSayings = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    const items = await ctx.db.query("shitMyDadSays").withIndex("by_timestamp").collect();

    return items.sort((a, b) => b.timestamp - a.timestamp);
  },
});
