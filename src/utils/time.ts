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
