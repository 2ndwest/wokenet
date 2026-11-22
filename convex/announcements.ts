import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireAdmin, requirePutz } from "./utils/auth";

// Announcements: full-screen messages on the Putzopticon. Admins write them ahead of time and
// show one whenever (now, or scheduled for later); the TV picks it up live and holds it until it's
// hidden again.

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

// Drops a pending schedule, so it won't go up on its own.
const unscheduled = async (ctx: MutationCtx, announcement: Doc<"announcements">) => {
  if (announcement.scheduledJob) await ctx.scheduler.cancel(announcement.scheduledJob);
  await ctx.db.patch(announcement._id, { scheduledFor: undefined, scheduledJob: undefined });
};

const putUp = async (ctx: MutationCtx, announcement: Doc<"announcements">) => {
  await unscheduled(ctx, announcement);
  await takeDownLive(ctx);
  await ctx.db.patch(announcement._id, { live: true });
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
    const announcement = await ctx.db.get(id);
    if (!announcement) return;
    await unscheduled(ctx, announcement);
    await ctx.db.delete(id);
  },
});

/** Puts this one up now, replacing whatever was showing (and dropping its schedule, if any). */
export const show = mutation({
  args: { id: v.id("announcements") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const announcement = await ctx.db.get(id);
    if (!announcement) throw new Error("NOT_FOUND");
    await putUp(ctx, announcement);
  },
});

/** Has this one go up on its own at `at` (ms since epoch), replacing whatever is showing then. */
export const schedule = mutation({
  args: { id: v.id("announcements"), at: v.number() },
  handler: async (ctx, { id, at }) => {
    await requireAdmin(ctx);
    const announcement = await ctx.db.get(id);
    if (!announcement) throw new Error("NOT_FOUND");
    if (announcement.live) throw new Error("ALREADY_LIVE");
    if (!Number.isFinite(at) || at <= Date.now()) throw new Error("SCHEDULED_IN_PAST");
    await unscheduled(ctx, announcement);
    const scheduledJob = await ctx.scheduler.runAt(at, internal.announcements.goLive, { id, at });
    await ctx.db.patch(id, { scheduledFor: at, scheduledJob });
  },
});

export const unschedule = mutation({
  args: { id: v.id("announcements") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const announcement = await ctx.db.get(id);
    if (announcement) await unscheduled(ctx, announcement);
  },
});

/** The scheduled job. Does nothing if the announcement was deleted, unscheduled or rescheduled since. */
export const goLive = internalMutation({
  args: { id: v.id("announcements"), at: v.number() },
  handler: async (ctx, { id, at }) => {
    const announcement = await ctx.db.get(id);
    if (!announcement || announcement.scheduledFor !== at) return;
    // This job is running, so there's nothing left to cancel.
    await putUp(ctx, { ...announcement, scheduledJob: undefined });
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
