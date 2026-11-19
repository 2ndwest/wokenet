import { COLOR_ORDER } from "../../utils/colors";
import type { PersonRowData } from "./PersonRows";

// Location data -> board rows, sorted by, in order:
// 1) color (using COLOR_ORDER)
// 2) label length (alternating longer/shorter first per color)
// 3) label (alphabetically)
// 4) name (alphabetically)
export const toPersonRows = (
  data: { providerId: string; label: string; color: string; name: string }[]
): PersonRowData[] =>
  data
    .map(({ providerId, label, color, name }) => ({
      key: providerId,
      name,
      color,
      label,
      dimmed: label === "UNKNOWN",
    }))
    .sort((a, b) => {
      const aOrder = COLOR_ORDER.indexOf(a.color);
      const bOrder = COLOR_ORDER.indexOf(b.color);
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Alternate: even color indices sorted longer
      // first, odd color indices sorted shorter first.
      const longerFirst = aOrder % 2 === 0;
      const labelLengthCompare = longerFirst
        ? b.label.length - a.label.length
        : a.label.length - b.label.length;
      if (labelLengthCompare !== 0) return labelLengthCompare;
      const labelCompare = a.label.localeCompare(b.label);
      if (labelCompare !== 0) return labelCompare;
      return a.name.localeCompare(b.name);
    });
