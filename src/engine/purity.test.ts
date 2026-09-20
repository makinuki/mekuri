import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

// Layering guard: the pure page-math modules may import nothing except the
// engine's own type module. This keeps the math layer free of React, DOM,
// and cross-module runtime dependencies by construction.
const PURE_MODULES = ["src/engine/types.ts", "src/engine/spreads.ts", "src/engine/scroll.ts"];

const ALLOWED_IMPORTS = new Set(["./types"]);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function importsOf(source: string): string[] {
  const stripped = stripComments(source);
  const matches = stripped.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["'];?$/gm);
  return [...matches].map((match) => match[1]);
}

describe("page math purity", () => {
  it("imports nothing outside engine types", () => {
    for (const file of PURE_MODULES) {
      const source = readFileSync(file, "utf8");
      const imports = importsOf(source);
      for (const specifier of imports) {
        expect([file, specifier]).toEqual([file, "./types"]);
        expect(ALLOWED_IMPORTS.has(specifier)).toBe(true);
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
