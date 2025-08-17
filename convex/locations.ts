import type { Infer } from "convex/values";
import { mutation, query } from "./_generated/server";

import schema from "./schema";

export const loadLocations = mutation({
  args: {},
  handler: async (ctx) => {
    for (const member of [] as any) {
      let locationName: Infer<typeof schema.tables.locations.validator.fields.location> = undefined;

      if (member.location) {
        if (
          member.location.name?.toLowerCase().includes("house") ||
          member.location.name?.toLowerCase().includes("haus") ||
          member.location.name?.toLowerCase().includes("hall") ||
          member.location.name?.toLowerCase().includes("macgregor") ||
          member.location.name?.toLowerCase().includes("masseh")
        ) {
          locationName = "IN HOUSING";
        } else if (member.location && member.location.latitude && member.location.longitude) {
          // MIT campus bounding box:
          // Bottom left: 42.353384, -71.108388
          // Top right:   42.365686, -71.091830
          const lat = parseFloat(member.location.latitude);
          const lng = parseFloat(member.location.longitude);
          if (lat >= 42.353384 && lat <= 42.365686 && lng >= -71.108388 && lng <= -71.09183) {
            locationName = "ON CAMPUS";
          } else {
            locationName = "OFF CAMPUS";
          }
        }
      }

      ctx.db.insert("locations", {
        name: member.firstName.split(" ")[0],
        location: locationName,
      });
    }
  },
});

export const getLocations = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("locations").collect();
  },
});
