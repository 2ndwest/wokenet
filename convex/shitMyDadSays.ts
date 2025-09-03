import { internalMutation } from "./_generated/server";
import schema from "./schema";

export const insertSaying = internalMutation({
  args: schema.tables.shitMyDadSays.validator,
  handler: async (ctx, args) => {
    await ctx.db.insert("shitMyDadSays", args);
  },
});
