import { booleanPointInPolygon } from "@turf/turf";
import generated from "../location_labels_generated.json";

type LocationLabelArgs = {
  lat: number;
  lng: number;
  timestamp: number;
  now?: number;
};

export const findLocationLabel = ({
  lat,
  lng,
  timestamp,
  now = Date.now(),
}: LocationLabelArgs) => {
  const THREE_HOURS_MS = 1000 * 60 * 60 * 3;
  if (timestamp < now - THREE_HOURS_MS) {
    return { label: "UNKNOWN", color: "dimgray" };
  }

  for (const feature of generated.features) {
    if (booleanPointInPolygon([lng, lat], feature as any)) {
      return {
        label: String(feature.properties?.name ?? "").toUpperCase(),
        color: feature.properties?.color ?? "gray",
      };
    }
  }

  return { label: "OFF CAMPUS", color: "red" };
};

export default generated;
