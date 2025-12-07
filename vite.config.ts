import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync } from "fs";
import { resolve } from "path";

// Plugin to generate version.json to enable auto refresh on updates.
function versionPlugin(): Plugin {
  return {
    name: "version-plugin",
    writeBundle(options) {
      const outDir = options.dir || "dist";
      const buildId = Date.now().toString(36);
      writeFileSync(resolve(outDir, "version.json"), JSON.stringify({ buildId }));
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionPlugin()],
});
