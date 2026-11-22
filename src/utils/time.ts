import { useState, useEffect } from "react";

// Force re-render at a given interval (in ms), e.g. to update relative times.
export const useRerender = (intervalMs: number) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);
};

export const formatTimestamp = (ms: number) => {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
};

// Converts a time string in "HH:MM" format to total minutes since midnight
export const toMins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);

// Converts a timestamp to a relative time string.
// Example: "1 hour ago", "2 days ago", "just now", "in 5 minutes".
export const getRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return new Date(timestamp).toLocaleDateString();
};

// Eastern Time (the house's clock), whatever time zone the browser is in.
const ET = "America/New_York";
const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const ET_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// The ET wall clock at an instant, as an <input type="date"> value ("YYYY-MM-DD") and an
// <input type="time"> value ("HH:MM").
export const toET = (ms: number) => {
  const p = Object.fromEntries(ET_PARTS.formatToParts(ms).map((part) => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

// The instant (ms since epoch) when the ET wall clock reads `date` ("YYYY-MM-DD") `time` ("HH:MM").
export const fromET = (date: string, time: string) => {
  const asUTC = (d: string, t: string) => {
    const [year, month, day] = d.split("-").map(Number);
    const [hour, minute] = t.split(":").map(Number);
    return Date.UTC(year, month - 1, day, hour, minute);
  };
  const wanted = asUTC(date, time);
  // Start as if ET were UTC, then shift by however far off the ET clock reads; twice settles DST.
  let ms = wanted;
  for (let i = 0; i < 2; i++) {
    const shown = toET(ms);
    ms += wanted - asUTC(shown.date, shown.time);
  }
  return ms;
};

// E.g. "Sat, Nov 22, 8:00 PM ET".
export const formatET = (ms: number) => `${ET_LABEL.format(ms)} ET`;
