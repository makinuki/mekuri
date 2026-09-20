import { defineConfig } from "vite-plus";

// Library build with one entry point per package surface. The engine entry
// must stay free of DOM and React-DOM references so it can be pulled in
// without the views. React and the future virtualization dependency are
// peers/runtime externals and must never be bundled: a copy of React inside
// the bundle would break host applications.
const EXTERNALS = ["react", "react-dom", "@tanstack/react-virtual"];

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
    rollupOptions: {
      external: (id) =>
        EXTERNALS.some((external) => id === external || id.startsWith(`${external}/`)),
    },
  },
  test: { environment: "jsdom" },
  // Build output, installed packages, and the untracked planning and scratch
  // tree stay out of lint and format runs, so the gates only cover content a
  // host or contributor consumes.
  lint: { ignorePatterns: ["dist/**", "node_modules/**", "_internal/**"] },
  fmt: { ignorePatterns: ["dist/**", "node_modules/**", "_internal/**"] },
});
