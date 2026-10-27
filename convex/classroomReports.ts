import { mutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireAdmin, requirePutz } from "./utils/auth";

const getMyReport = (ctx: MutationCtx, userId: Id<"users">, room: string) =>
  ctx.db
    .query("classroomReports")
    .withIndex("by_user_room", (q) => q.eq("userId", userId).eq("room", room))
    .unique();

// The rooms you've reported and what you said, so the page can mark them and let you take a report back.
export const getMyReports = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requirePutz(ctx);

    const reports = await ctx.db
      .query("classroomReports")
      .withIndex("by_user_room", (q) => q.eq("userId", user._id))
      .collect();
    return reports.map(({ room, note }) => ({ room, note }));
  },
});

// How many people have reported each reported room, so the page can flag them. Just counts: who
// reported and what they said is for admins.
export const getReportCounts = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    const counts = new Map<string, number>();
    for (const { room } of await ctx.db.query("classroomReports").collect())
      counts.set(room, (counts.get(room) ?? 0) + 1);
    return [...counts].map(([room, count]) => ({ room, count }));
  },
});

// Reports a room as unusable, with a short note on why. Reporting it again just replaces the note.
export const reportClassroom = mutation({
  args: { room: v.string(), note: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requirePutz(ctx);
    const { room } = args;
    const note = args.note.trim().slice(0, 500);
    if (!note) throw new Error("EMPTY_NOTE");

    const tracked = await ctx.db
      .query("classroomAvailability")
      .withIndex("by_room", (q) => q.eq("room", room))
      .unique();
    if (!tracked) throw new Error("UNKNOWN_ROOM");

    const existing = await getMyReport(ctx, user._id, room);
    if (existing) await ctx.db.patch(existing._id, { note, timestamp: Date.now() });
    else await ctx.db.insert("classroomReports", { room, userId: user._id, note, timestamp: Date.now() });
  },
});

// Takes back your report of a room.
export const unreportClassroom = mutation({
  args: { room: v.string() },
  handler: async (ctx, { room }) => {
    const { user } = await requirePutz(ctx);

    const existing = await getMyReport(ctx, user._id, room);
    if (existing) await ctx.db.delete(existing._id);
  },
});

// Every reported room with who reported it and what they said, most-reported (then most recent) first.
export const getReports = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const [reports, users] = await Promise.all([
      ctx.db.query("classroomReports").collect(),
      ctx.db.query("users").collect(),
    ]);
    const nameOf = new Map(users.map((u) => [u._id, u.name]));

    const byRoom = new Map<string, typeof reports>();
    for (const report of reports) byRoom.set(report.room, [...(byRoom.get(report.room) ?? []), report]);

    return [...byRoom]
      .map(([room, reports]) => ({
        room,
        latest: Math.max(...reports.map((r) => r.timestamp)),
        reports: reports.map((r) => ({
          note: r.note,
          name: nameOf.get(r.userId) ?? "UNKNOWN",
          timestamp: r.timestamp,
        })),
      }))
      .sort((a, b) => b.reports.length - a.reports.length || b.latest - a.latest);
  },
});

// Permanently deletes a room's reports once it's dealt with (e.g. dropped from the availability scraper's room list,
// or it was fine).
export const deleteReports = mutation({
  args: { room: v.string() },
  handler: async (ctx, { room }) => {
    await requireAdmin(ctx);

    const reports = await ctx.db
      .query("classroomReports")
      .withIndex("by_room", (q) => q.eq("room", room))
      .collect();
    for (const report of reports) await ctx.db.delete(report._id);
  },
});
