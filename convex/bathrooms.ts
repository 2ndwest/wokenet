import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requirePutz } from "./utils/auth";

export const updateBathroom = internalMutation({
  args: {
    doorId: v.string(),
    isOpen: v.boolean(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("bathrooms")
      .withIndex("by_doorId", (q) => q.eq("doorId", args.doorId))
      .first();

    if (existing) {
      // Toggle occupancy when door opens (not when it closes)
      let isOccupied = existing.isOccupied ?? false;
      let occupiedSince = existing.occupiedSince;

      if (args.isOpen && !existing.isOpen) {
        // Door just opened - toggle occupancy
        isOccupied = !isOccupied;
        occupiedSince = isOccupied ? args.timestamp : undefined;
      }

      await ctx.db.patch(existing._id, {
        isOpen: args.isOpen,
        timestamp: args.timestamp,
        isOccupied,
        occupiedSince,
      });
    } else {
      // New bathroom: if door is open, someone just entered
      const isOccupied = args.isOpen;
      await ctx.db.insert("bathrooms", {
        doorId: args.doorId,
        isOpen: args.isOpen,
        timestamp: args.timestamp,
        isOccupied,
        occupiedSince: isOccupied ? args.timestamp : undefined,
      });
    }
  },
});

export const getBathrooms = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    return await ctx.db.query("bathrooms").collect();
  },
});

export const resetStaleBathroomOccupancy = internalMutation({
  args: {},
  handler: async (ctx) => {
    const bathrooms = await ctx.db.query("bathrooms").collect();

    // Auto-vacate rooms that have been occupied for more than 50 minutes.
    for (const bathroom of bathrooms) {
      if (
        bathroom.isOccupied &&
        bathroom.occupiedSince != null &&
        Date.now() - bathroom.occupiedSince >= 50 * 60 * 1000 // 50 minutes in ms
      ) {
        await ctx.db.patch(bathroom._id, {
          isOccupied: false,
          occupiedSince: undefined,
        });
        console.log(`Auto-vacated bathroom: ${bathroom.doorId} (occupied for >1 hour)`);
      }
    }
  },
});
