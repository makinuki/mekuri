import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// The lab imports the package entry points exactly as a host application does.
// The default aliases resolve them to the library source, so a contributor
// does not have to build first. `--mode dist` resolves them to the built
// output instead, which is how the browser tier exercises the entries a host
// installs rather than the modules under development.
const libraryRoot = fileURLToPath(new URL("../..", import.meta.url)).replace(/\\/g, "/");

const SOURCE_ENTRIES: Record<string, string> = {
  "@makinuki/mekuri/engine": "/src/engine/index.ts",
  "@makinuki/mekuri/views": "/src/views/index.ts",
  "@makinuki/mekuri/test-utils": "/src/test-utils/index.ts",
  "@makinuki/mekuri": "/src/index.ts",
};

const BUILT_ENTRIES: Record<string, string> = {
  "@makinuki/mekuri/engine": "/dist/engine.js",
  "@makinuki/mekuri/views": "/dist/views.js",
  "@makinuki/mekuri/test-utils": "/dist/test-utils.js",
  "@makinuki/mekuri": "/dist/index.js",
};

export default defineConfig(({ mode }) => {
  const entries = mode === "dist" ? BUILT_ENTRIES : SOURCE_ENTRIES;
  return {
    server: { port: 5273 },
    preview: { port: 5274 },
    resolve: {
      alias: Object.entries(entries).map(([find, file]) => ({
        find,
        replacement: libraryRoot + file,
      })),
    },
    test: { environment: "jsdom" },
  };
});
