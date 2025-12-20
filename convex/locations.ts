import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requirePutz } from "./utils/auth";
import { findLocationLabel } from "./utils/location_labels"; // Edit these in convex/location_labels/*.json via geojson.io
import schema from "./schema";

export const refetchLocations = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx); // Avoid spamming the location provider.

    await ctx.scheduler.runAfter(0, internal.loadLocations.loadLocations);
  },
});

export const getLocations = query({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx);

    const locations = await ctx.db.query("locations").collect();

    return locations.map((location) => {
      const [lat, lng] = [location.latitude, location.longitude];

      const match = findLocationLabel({
        lat,
        lng,
        timestamp: location.timestamp,
      });

      return {
        ...location,
        label: match.label,
        color: match.color,
      };
    });
  },
});

export const setLocations = internalMutation({
  args: {
    locations: v.array(schema.tables.locations.validator),
  },
  handler: async (ctx, args) => {
    for (const location of args.locations) {
      const existing = await ctx.db
        .query("locations")
        .withIndex("by_providerId", (q) => q.eq("providerId", location.providerId))
        .unique();

      if (existing) {
        await ctx.db.replace(existing._id, location);
      } else {
        await ctx.db.insert("locations", location);
      }
    }
  },
});
