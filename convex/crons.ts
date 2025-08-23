import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "load locations",
  { minutes: 5 }, // every 5 minutes
  internal.locations.loadLocations
);

export default crons;
