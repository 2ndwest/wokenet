// Run automatically as part of precommit hooks.
import { promises as fs } from "node:fs";
import path from "node:path";
import { area } from "@turf/turf";

const ROOT = process.cwd();
const INPUT_DIR = "convex/location_labels";
const OUTPUT_FILE = "convex/location_labels_generated.json";

const readJson = async (absolutePath) => {
  const raw = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(raw);
};

const main = async () => {
  const inputDirPath = path.join(ROOT, INPUT_DIR);
  const entries = await fs.readdir(inputDirPath, { withFileTypes: true });
  const inputFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => name !== path.basename(OUTPUT_FILE))
    .map((name) => path.join(inputDirPath, name));

  if (inputFiles.length === 0) {
    throw new Error(`No input JSON files found in ${INPUT_DIR}`);
  }

  const inputs = await Promise.all(inputFiles.map(readJson));
  const features = inputs.flatMap((collection) => collection.features);

  const withArea = features.map((feature) => {
    const computedArea = feature?.geometry ? area(feature) : 0;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        area: computedArea,
      },
    };
  });

  withArea.sort((a, b) => {
    const areaDiff = (a.properties?.area ?? 0) - (b.properties?.area ?? 0);
    if (areaDiff !== 0) return areaDiff;
    const aId = typeof a.id === "number" ? a.id : Number.POSITIVE_INFINITY;
    const bId = typeof b.id === "number" ? b.id : Number.POSITIVE_INFINITY;
    if (aId !== bId) return aId - bId;
    const aName = a.properties?.name ?? "";
    const bName = b.properties?.name ?? "";
    return aName.localeCompare(bName);
  });

  const output = {
    type: "FeatureCollection",
    features: withArea,
  };

  const outputPath = path.join(ROOT, OUTPUT_FILE);
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUTPUT_FILE} with ${withArea.length} features.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
