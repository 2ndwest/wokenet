import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "load locations",
  { seconds: 30 }, // every 30 seconds
  internal.loadLocations.loadLocations
);

// Movie Monday starts over once Monday night is done: Tuesday 09:00 UTC is
// 4am or 5am in Boston, depending on daylight saving.
crons.weekly(
  "movie monday reset",
  { dayOfWeek: "tuesday", hourUTC: 9, minuteUTC: 0 },
  internal.movieMonday.weeklyReset
);

export default crons;
