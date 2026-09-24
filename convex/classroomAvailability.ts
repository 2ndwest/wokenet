import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requirePutz } from "./utils/auth";
import schema from "./schema";

// Every classroom's open windows for today and tomorrow, as last pushed by nickbot (about hourly).
export const getClassroomAvailability = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    return await ctx.db.query("classroomAvailability").collect();
  },
});

// Replaces all classroom availability with nickbot's latest push. Classrooms missing from it are deleted.
export const setClassroomAvailability = internalMutation({
  args: {
    classrooms: v.array(schema.tables.classroomAvailability.validator),
  },
  handler: async (ctx, args) => {
    const existing = new Map(
      (await ctx.db.query("classroomAvailability").collect()).map((doc) => [doc.room, doc._id])
    );

    for (const classroom of args.classrooms) {
      const id = existing.get(classroom.room);
      if (id) {
        await ctx.db.replace(id, classroom);
        existing.delete(classroom.room);
      } else {
        await ctx.db.insert("classroomAvailability", classroom);
      }
    }

    for (const id of existing.values()) await ctx.db.delete(id);
  },
});
