import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Builds the study's working demos into one script, study/dist/study.js, so
 * they can be dropped into any page that has the demo markup (see
 * study/index.html). The game's own build is untouched: `npm run build` never
 * reads this file.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    lib: {
      entry: fileURLToPath(new URL("./src/main.ts", import.meta.url)),
      formats: ["iife"],
      name: "StillfieldStudy",
      fileName: () => "study.js",
    },
  },
});
