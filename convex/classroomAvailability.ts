import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requirePutz } from "./utils/auth";
import schema from "./schema";

// Every room's open windows for today and tomorrow, as last pushed by nickbot (about hourly).
export const getRoomAvailability = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    return await ctx.db.query("roomAvailability").collect();
  },
});

// Replaces all room availability with nickbot's latest push. Rooms missing from it are deleted.
export const setRoomAvailability = internalMutation({
  args: {
    rooms: v.array(schema.tables.roomAvailability.validator),
  },
  handler: async (ctx, args) => {
    const existing = new Map(
      (await ctx.db.query("roomAvailability").collect()).map((doc) => [doc.room, doc._id])
    );

    for (const room of args.rooms) {
      const id = existing.get(room.room);
      if (id) {
        await ctx.db.replace(id, room);
        existing.delete(room.room);
      } else {
        await ctx.db.insert("roomAvailability", room);
      }
    }

    for (const id of existing.values()) await ctx.db.delete(id);
  },
});
