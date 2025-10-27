import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "load locations",
  { minutes: 1 }, // every minute
  internal.loadLocations.loadLocations
);

export default crons;
