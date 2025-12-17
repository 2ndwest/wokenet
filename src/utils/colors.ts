// Shorthands for some common fancy colors we use.
export const COLORS: [string, string][] = [
  ["green", "green"],
  ["darkgreen", "darkgreen"],
  ["yellow", "#ed8b00"],
  ["purple", "#80276c"],
  ["blue", "#003da5"],
  ["gray", "#7c878e"],
  ["crimson", "#a51c30"],
  ["red", "#da291c"],
  ["brown", "#7a4b2d"],
  ["dimgray", "dimgray"],
]; // Note: array order determines display priority!

export const COLOR_ORDER = COLORS.map(([name]) => name);
export const COLOR_HEX: Record<string, string> = Object.fromEntries(COLORS);
