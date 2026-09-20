import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// The lab imports the package entry points exactly as a host application does.
// The aliases resolve them to the library source so a contributor does not have
// to build first; pointing them at dist instead is how a release check would
// exercise the published entries.
const libraryRoot = fileURLToPath(new URL("../..", import.meta.url)).replace(/\\/g, "/");

const alias = [
  { find: "@makinuki/mekuri/engine", replacement: libraryRoot + "/src/engine/index.ts" },
  { find: "@makinuki/mekuri/views", replacement: libraryRoot + "/src/views/index.ts" },
  { find: "@makinuki/mekuri/test-utils", replacement: libraryRoot + "/src/test-utils/index.ts" },
  { find: "@makinuki/mekuri", replacement: libraryRoot + "/src/index.ts" },
];

export default defineConfig({
  server: { port: 5273 },
  preview: { port: 5273 },
  resolve: { alias },
  test: { environment: "jsdom" },
});
