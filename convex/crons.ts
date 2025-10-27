import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "load locations",
  { seconds: 45 }, // every 45 seconds
  internal.loadLocations.loadLocations
);

export default crons;
