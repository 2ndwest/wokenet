import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requirePutz } from "./utils/auth";
import schema from "./schema";

// Every classroom's open windows for today and tomorrow, as last pushed by nickbot (each refreshed every ~6 hours).
export const getClassroomAvailability = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    return await ctx.db.query("classroomAvailability").collect();
  },
});

// Upserts the classrooms nickbot just refreshed, and deletes any classroom it no longer tracks.
export const updateClassroomAvailability = internalMutation({
  args: {
    classrooms: v.array(schema.tables.classroomAvailability.validator),
    tracked: v.array(v.string()), // Every room nickbot tracks, refreshed or not.
  },
  handler: async (ctx, args) => {
    const existing = new Map(
      (await ctx.db.query("classroomAvailability").collect()).map((doc) => [doc.room, doc._id])
    );

    for (const classroom of args.classrooms) {
      const id = existing.get(classroom.room);
      if (id) await ctx.db.replace(id, classroom);
      else await ctx.db.insert("classroomAvailability", classroom);
    }

    const tracked = new Set(args.tracked);
    for (const [room, id] of existing) if (!tracked.has(room)) await ctx.db.delete(id);
  },
});
