export const formatTimestamp = (ms: number) => {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
};

// Converts a time string in "HH:MM" format to total minutes since midnight
export const toMins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
