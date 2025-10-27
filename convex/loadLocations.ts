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
        id: string;
        firstName: string;
        features: {
          shareLocation: "1" | "0";
          disconnected: "1" | "0";
          shareOffTimestamp: string | null;
        };
        location: {
          latitude: string;
          longitude: string;
          timestamp: string;
          accuracy: string;
          battery: string;
        } | null;
      }>;
    };

    // Map raw member data to our locations format.
    const locations = data.members
      .filter(
        (member) =>
          member.location &&
          member.features.shareLocation === "1" &&
          member.features.disconnected === "0"
      )
      .map(({ location, id, firstName }) => {
        return {
          providerId: id,
          name: titleCase(firstName),
          latitude: Number(location!.latitude),
          longitude: Number(location!.longitude),
          timestamp: Number(location!.timestamp) * 1000, // convert to ms
          accuracy: Number(location!.accuracy),
        };
      });

    await ctx.runMutation(internal.locations.setLocations, { locations });
  },
});
