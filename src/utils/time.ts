export const formatTimestamp = (ms: number) => {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
};
