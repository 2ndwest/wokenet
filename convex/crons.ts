import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "load locations",
  { seconds: 30 }, // every 30 seconds
  internal.loadLocations.loadLocations
);

crons.interval(
  "reset stale bathroom occupancy",
  { minutes: 5 }, // check every 5 minutes
  internal.bathrooms.resetStaleBathroomOccupancy
);

export default crons;
