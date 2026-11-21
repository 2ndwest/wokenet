import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin, requirePutz } from "./utils/auth";

// Announcements: full-screen messages on the Putzopticon. Admins write them ahead of time and
// show one whenever; the TV picks it up live and holds it until it's hidden again.

const MAX_LENGTH = 280;
const MAX_DETAILS_LENGTH = 500;

const cleaned = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("EMPTY_ANNOUNCEMENT");
  if (trimmed.length > MAX_LENGTH) throw new Error("ANNOUNCEMENT_TOO_LONG");
  return trimmed;
};

// The smaller text is optional: blank means none.
const cleanedDetails = (details: string | undefined) => {
  const trimmed = details?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_DETAILS_LENGTH) throw new Error("DETAILS_TOO_LONG");
  return trimmed;
};

const takeDownLive = async (ctx: MutationCtx) => {
  const live = await ctx.db
    .query("announcements")
    .withIndex("by_live", (q) => q.eq("live", true))
    .collect();
  await Promise.all(live.map((a) => ctx.db.patch(a._id, { live: false })));
};

/** What the TV shows: the live announcement's text, or null. Only the live one leaves the server. */
export const getLive = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);
    const live = await ctx.db
      .query("announcements")
      .withIndex("by_live", (q) => q.eq("live", true))
      .first();
    return live ? { _id: live._id, text: live.text, details: live.details } : null;
  },
});

/** Every announcement, newest first, for the admin panel. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const all = await ctx.db.query("announcements").collect();
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const create = mutation({
  args: { text: v.string(), details: v.optional(v.string()) },
  handler: async (ctx, { text, details }) => {
    const { user } = await requireAdmin(ctx);
    return await ctx.db.insert("announcements", {
      text: cleaned(text),
      details: cleanedDetails(details),
      live: false,
      createdBy: user.email.split("@")[0],
      createdAt: Date.now(),
    });
  },
});

export const edit = mutation({
  args: { id: v.id("announcements"), text: v.string(), details: v.optional(v.string()) },
  handler: async (ctx, { id, text, details }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(id, { text: cleaned(text), details: cleanedDetails(details) });
  },
});

export const remove = mutation({
  args: { id: v.id("announcements") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(id);
  },
});

/** Puts this one up, replacing whatever was showing. */
export const show = mutation({
  args: { id: v.id("announcements") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(id))) throw new Error("NOT_FOUND");
    await takeDownLive(ctx);
    await ctx.db.patch(id, { live: true });
  },
});

/** Takes down whatever is showing. */
export const hide = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    await takeDownLive(ctx);
  },
});
