import { mutation, query } from "./_generated/server";
import { Affiliation, AFFILIATION_VALIDATOR } from "./schema";
import { v } from "convex/values";
import { requireAdmin, getUser, requirePutz } from "./utils/auth";

export const setupUser = mutation({
  args: {},
  handler: async (ctx) => {
    const { user, identity } = await getUser(ctx, { allowFresh: true });

    if (user !== null) {
      // If we've seen this identity before but the name has changed, patch the value.
      if (identity.name && user.name !== identity.name)
        await ctx.db.patch(user._id, { name: identity.name });
      return { affiliation: user.affiliation, isAdmin: user.isAdmin };
    }

    // If it's a new identity, create a new user.
    await ctx.db.insert("users", {
      name: identity.name ?? "UNKNOWN",
      email: identity.email!,
      affiliation: "NONE",
      isAdmin: false,
    });

    return { affiliation: "NONE" as Affiliation, isAdmin: false };
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    const users = await ctx.db.query("users").collect();
    // Sort by name for stable display
    users.sort((a, b) => a.name.localeCompare(b.name));
    return users;
  },
});

export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    affiliation: v.optional(AFFILIATION_VALIDATOR),
    isAdmin: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireAdmin(ctx);

    if (user._id === args.userId) throw new Error("CANNOT_UPDATE_SELF");

    const patch: Partial<{ affiliation: Affiliation; isAdmin: boolean }> = {};

    if (typeof args.affiliation !== "undefined") patch.affiliation = args.affiliation;
    if (typeof args.isAdmin !== "undefined") patch.isAdmin = args.isAdmin;

    if (Object.keys(patch).length === 0) return;

    await ctx.db.patch(args.userId, patch);
  },
});
