import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { titleCase } from "./utils/strings";

export const loadLocations = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!process.env.LOCATION_PROVIDER_URL || !process.env.LOCATION_PROVIDER_USERNAME_PASSWORD)
      throw new Error("LOCATION_PROVIDER_URL or LOCATION_PROVIDER_USERNAME_PASSWORD not set.");

    // Fetch location data from the location provider.
    const response = await fetch(process.env.LOCATION_PROVIDER_URL, {
      // LOCATION_PROVIDER_USERNAME_PASSWORD = username:password (eg. "wokenet:abcd1234")
      headers: { Authorization: `Basic ${btoa(process.env.LOCATION_PROVIDER_USERNAME_PASSWORD)}` },
    });

    if (!response.ok) throw new Error("Failed to fetch location data.");
    const data = (await response.json()) as {
      members: Array<{
        id?: string;
        firstName?: string;
        location?: {
          latitude?: number;
          longitude?: number;
          timestamp?: number;
          accuracy?: number;
        };
      }>;
    };

    // Map raw member data to our locations format.
    const locations = data.members.map((member) => {
      const location = member.location;
      return {
        name: titleCase(member.firstName || "UNKNOWN_NAME"),
        latitude: location?.latitude ? Number(location.latitude) : undefined,
        longitude: location?.longitude ? Number(location.longitude) : undefined,
        providerId: member.id ?? "UNKNOWN_ID",
        timestamp: location?.timestamp ? Number(location.timestamp) * 1000 : 0, // Life360 uses seconds, convert to ms
        accuracy: location?.accuracy ? Number(location.accuracy) : -1,
      };
    });

    await ctx.runMutation(internal.locations.setLocations, { locations });
  },
});
