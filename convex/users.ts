import { mutation, query } from "./_generated/server";
import { Affiliation, AFFILIATION_VALIDATOR } from "./schema";
import { v } from "convex/values";
import { requireAdmin, getUser, requirePutz } from "./utils/auth";

export const createUser = mutation({
  args: {
    kerb: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const kerb = args.kerb.trim().toLowerCase();
    if (kerb.length === 0 || kerb.includes("@")) throw new Error("INVALID_KERB");

    const email = `${kerb}@mit.edu`;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (existing) throw new Error("USER_ALREADY_EXISTS");

    const id = await ctx.db.insert("users", {
      name: args.name.trim() || "UNKNOWN",
      email,
      affiliation: "NONE",
      isAdmin: false,
    });

    return id;
  },
});

export const setupUser = mutation({
  args: {},
  handler: async (ctx) => {
    const { user, identity } = await getUser(ctx, { allowFresh: true });

    if (user !== null) {
      // If we've seen this identity before but the name has changed, patch the value.
      if (identity.name && user.name !== identity.name) {
        await ctx.db.patch(user._id, { name: identity.name });
        return { ...user, name: identity.name };
      }
      return user;
    }

    // If it's a new identity, create a new user.
    const userid = await ctx.db.insert("users", {
      name: identity.name ?? identity.email!.split("@")[0], // Use the kerb if the name is not set.
      email: identity.email!,
      affiliation: "NONE",
      isAdmin: false,
    });

    return await ctx.db.get(userid);
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
