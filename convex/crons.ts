import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "load locations",
  { seconds: 30 }, // every 30 seconds
  internal.loadLocations.loadLocations
);

export default crons;
