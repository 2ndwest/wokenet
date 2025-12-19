import misc from "./location_labels_misc.json";
import states from "./location_labels_states.json";

const locationLabels = {
  type: "FeatureCollection",
  features: [...states.features, ...misc.features],
};

export default locationLabels;
