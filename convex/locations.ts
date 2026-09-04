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
    const displayNames = disambiguateNames(locations);

    return locations.map((location) => {
      const [lat, lng] = [location.latitude, location.longitude];

      const match = findLocationLabel({
        lat,
        lng,
        timestamp: location.timestamp,
      });

      return {
        ...location,
        name: displayNames.get(location.providerId) ?? location.name,
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

/**
 * Returns a display name per providerId. People who share a first name get
 * their last initial appended (e.g. "Aiden S."), and if that still collides,
 * their full last name (e.g. "Aiden Smith").
 */
export function disambiguateNames(
  locations: Array<{ providerId: string; name: string; lastName?: string }>
): Map<string, string> {
  const countBy = (names: string[]) => {
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  };

  const firstNameCounts = countBy(locations.map((l) => l.name));
  const withInitial = locations.map((l) =>
    firstNameCounts.get(l.name)! > 1 && l.lastName ? `${l.name} ${l.lastName[0]}.` : l.name
  );

  const initialCounts = countBy(withInitial);
  const result = new Map<string, string>();
  locations.forEach((l, i) => {
    const collides = initialCounts.get(withInitial[i])! > 1 && withInitial[i] !== l.name;
    result.set(l.providerId, collides ? `${l.name} ${l.lastName}` : withInitial[i]);
  });

  return result;
}
