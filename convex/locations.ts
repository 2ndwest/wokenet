import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requirePutz } from "./utils/auth";
import { booleanPointInPolygon } from "@turf/turf";
import locationLabels from "./utils/location_labels.json"; // Edit this on geojson.io
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

      // Invalid location.
      const ONE_HOUR_MS = 1000 * 60 * 60;
      if (!lat || !lng || location.timestamp < Date.now() - ONE_HOUR_MS)
        return {
          ...location,
          label: "UNKNOWN",
          color: "dimgray",
        };

      // Check if point is within any of the labeled polygons.
      for (const feature of locationLabels.features.sort((a, b) => {
        // If feature has matchLast: true, sort it to the back.
        if (a.properties.matchLast && !b.properties.matchLast) return 1;
        if (!a.properties.matchLast && b.properties.matchLast) return -1;
        return 0;
      })) {
        // Note: GeoJSON uses [lng, lat] ordering.
        if (booleanPointInPolygon([lng, lat], feature as any)) {
          return {
            ...location,
            label: feature.properties.name.toUpperCase(),
            color: feature.properties.color ?? "gray",
          };
        }
      }

      return { ...location, label: "OFF CAMPUS", color: "red" };
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
