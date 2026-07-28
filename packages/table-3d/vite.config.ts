import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The casino theme files live outside this package so the SVG previews and the
// 3D models stay driven by exactly one source of design tokens.
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  server: {
    fs: {
      allow: [fileURLToPath(new URL("./", import.meta.url)), repositoryRoot],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
