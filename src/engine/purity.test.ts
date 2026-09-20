import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

// Layering guard: the pure engine modules (types, page math, zones, and the
// vanilla store) may import only engine-local modules. This keeps the core
// free of React, DOM, and external runtime dependencies by construction; the
// React binding is the sole consumer of React and is excluded here.
const PURE_MODULES = [
  "src/engine/types.ts",
  "src/engine/spreads.ts",
  "src/engine/scroll.ts",
  "src/engine/zones.ts",
  "src/engine/store.ts",
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function importsOf(source: string): string[] {
  const stripped = stripComments(source);
  const matches = stripped.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["'];?$/gm);
  return [...matches].map((match) => match[1]);
}

describe("engine core purity", () => {
  it("imports only engine-local modules", () => {
    for (const file of PURE_MODULES) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importsOf(source)) {
        expect([file, specifier]).toEqual([file, expect.stringMatching(/^\.\/[a-zA-Z]+$/)]);
      }
    }
  });

  it("contains no React or DOM references", () => {
    for (const file of PURE_MODULES) {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(source).not.toMatch(/react/i);
      expect(source).not.toMatch(/\b(window|document|navigator)\b/);
    }
  });
});
