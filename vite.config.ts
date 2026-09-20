import { defineConfig } from "vite-plus";

// Library build with one entry point per package surface. The engine entry
// must stay free of DOM and React-DOM references so it can be pulled in
// without the views.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: {
        index: "src/index.ts",
        engine: "src/engine/index.ts",
        views: "src/views/index.ts",
        "test-utils": "src/test-utils/index.ts",
      },
      formats: ["es"],
    },
  },
  test: { environment: "jsdom" },
  lint: { ignorePatterns: ["dist/**", "node_modules/**"] },
  fmt: { ignorePatterns: ["dist/**", "node_modules/**"] },
});
