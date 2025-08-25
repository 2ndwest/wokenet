import { Infer, v } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requirePutz } from "./utils/auth";
import { titleCase } from "./utils/strings";
import { booleanPointInPolygon } from "@turf/turf";
import locationLabels from "./utils/location_labels.json"; // Edit this on geojson.io
import schema from "./schema";
import { getGoogleMapsSharedPeople } from "google-maps-location-sharing-lib-js";
import { GOOGLE_AUTH_USER } from "./googleAuth";

export const refetchLocations = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePutz(ctx); // Avoid spamming Google Maps API.

    await ctx.scheduler.runAfter(0, internal.locations.loadLocations);
  },
});

export const loadLocations = internalAction({
  args: {},
  handler: async (ctx) => {
    const cookies = await ctx.runQuery(internal.googleAuth.getGoogleAuthCookies);

    const { people, newCookies } = await getGoogleMapsSharedPeople(
      new Map(cookies.map((cookie) => [cookie.name, cookie.value])),
      GOOGLE_AUTH_USER
    );

    await ctx.runMutation(internal.googleAuth.setGoogleAuthCookies, {
      cookies: Array.from(newCookies.entries()).map(([name, value]) => ({ name, value })),
    });

    await ctx.runMutation(internal.locations.setLocations, {
      locations: people.map((person) => {
        return {
          name: titleCase(person.nickname ?? "Unknown"),
          latitude: person.latitude ? Number(person.latitude) : undefined,
          longitude: person.longitude ? Number(person.longitude) : undefined,
          providerId: person.id ?? "UNKNOWN_ID",
          timestamp: Number(person.timestamp ?? 0),
          accuracy: Number(person.accuracy ?? -1),
        };
      }),
    });
  },
});

export const getLocations = query({
  args: {},
  handler: async (
    ctx
  ): Promise<
    (Infer<typeof schema.tables.locations.validator> & { label: string; color: string })[]
  > => {
    await requirePutz(ctx);

    const locations = await ctx.db.query("locations").collect();

    return locations.map((location) => {
      const [lat, lng] = [location.latitude, location.longitude];

      // Invalid location.
      if (!lat || !lng) return { ...location, label: "UNKNOWN", color: "dimgray" };

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
