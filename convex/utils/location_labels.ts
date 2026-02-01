import { booleanPointInPolygon } from "@turf/turf";
import generated from "../location_labels_generated.json";

type FeatureCollection = {
  type: "FeatureCollection";
  features: Array<any>;
};

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

  // We now check the polygons in the order they're in the generated list, which
  // is guaranteed to be sorted by area (smallest to largest). This assigns the
  // label of the smallest polygon a putzen is in, rather than using some manual
  // "priority" field.
  for (const feature of (generated as FeatureCollection).features) {
    if (booleanPointInPolygon([lng, lat], feature as any)) {
      return {
        label: String(feature.properties?.name ?? "").toUpperCase(),
        color: feature.properties?.color ?? "gray",
      };
    }
  }

  return { label: "INTERNATIONAL", color: "lightblue" };
};

export default generated;
