import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { parseNetscapeCookieString } from "google-maps-location-sharing-lib-js";
import schema from "./schema";
import { internal } from "./_generated/api";

export const GOOGLE_AUTH_USER = 0; // Which google account to use for the location sharing API.

export const getGoogleAuthCookies = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("googleAuthCookies").collect();
  },
});

export const setGoogleAuthCookies = internalMutation({
  args: {
    cookies: v.array(schema.tables.googleAuthCookies.validator),
  },
  handler: async (ctx, args) => {
    for (const cookie of args.cookies) {
      const existing = await ctx.db
        .query("googleAuthCookies")
        .withIndex("by_name", (q) => q.eq("name", cookie.name))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, { value: cookie.value });
      } else {
        await ctx.db.insert("googleAuthCookies", cookie);
      }
    }
  },
});

export const loadGoogleAuthCookiesFromNetscapeFile = internalMutation({
  args: {
    contents: v.string(),
  },
  handler: async (ctx, args) => {
    const cookies = Array.from(parseNetscapeCookieString(args.contents)).map(([name, value]) => ({
      name,
      value,
    }));

    await ctx.runMutation(internal.googleAuth.setGoogleAuthCookies, {
      cookies,
    });
  },
});
