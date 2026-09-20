import { describe, expect, it } from "vite-plus/test";
import { alignToSpread, calculateSpreads, isLandscapePage, pageAspectRatio } from "./spreads";
import { DEFAULT_SPREAD_CONFIG, type MekuriPage } from "./types";

function pages(count: number, overrides: Record<number, Partial<MekuriPage>> = {}): MekuriPage[] {
  return Array.from({ length: count }, (_, i) => ({ id: i, ...overrides[i] }));
}

const LANDSCAPE: Partial<MekuriPage> = { width: 2000, height: 1000 };

describe("pageAspectRatio", () => {
  it("computes from explicit pixel dimensions", () => {
    expect(pageAspectRatio({ id: 0, width: 2000, height: 1000 })).toBe(2);
  });

  it("falls back to the precomputed aspectRatio field", () => {
    expect(pageAspectRatio({ id: 0, aspectRatio: 1.5 })).toBe(1.5);
  });

  it("prefers pixel dimensions over the precomputed field", () => {
    expect(pageAspectRatio({ id: 0, width: 100, height: 100, aspectRatio: 2 })).toBe(1);
  });

  it("returns null for dimensionless pages and degenerate values", () => {
    expect(pageAspectRatio({ id: 0 })).toBeNull();
    expect(pageAspectRatio({ id: 0, width: 100, height: 0 })).toBeNull();
    expect(pageAspectRatio({ id: 0, aspectRatio: 0 })).toBeNull();
    expect(pageAspectRatio({ id: 0, aspectRatio: -1 })).toBeNull();
  });
});

describe("isLandscapePage", () => {
  it("uses a strictly-greater threshold comparison", () => {
    const atThreshold = { id: 0, aspectRatio: 1.2 };
    const justAbove = { id: 0, aspectRatio: 1.2000001 };
    expect(isLandscapePage(atThreshold, DEFAULT_SPREAD_CONFIG)).toBe(false);
    expect(isLandscapePage(justAbove, DEFAULT_SPREAD_CONFIG)).toBe(true);
  });

  it("treats dimensionless pages as portrait", () => {
    expect(isLandscapePage({ id: 0 }, DEFAULT_SPREAD_CONFIG)).toBe(false);
  });
});

describe("calculateSpreads", () => {
  it("returns an empty list for an empty chapter", () => {
    expect(calculateSpreads([], DEFAULT_SPREAD_CONFIG)).toEqual([]);
  });

  it("renders a single page alone", () => {
    expect(calculateSpreads(pages(1), DEFAULT_SPREAD_CONFIG)).toEqual([[0]]);
  });

  it("pairs without cover offset, leaving an odd tail alone", () => {
    const noCover = { ...DEFAULT_SPREAD_CONFIG, firstPageIsCover: false };
    expect(calculateSpreads(pages(5), noCover)).toEqual([[0, 1], [2, 3], [4]]);
    expect(calculateSpreads(pages(4), noCover)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("with cover offset renders page 1 alone and pairs from page 2", () => {
    expect(calculateSpreads(pages(5), DEFAULT_SPREAD_CONFIG)).toEqual([[0], [1, 2], [3, 4]]);
    expect(calculateSpreads(pages(4), DEFAULT_SPREAD_CONFIG)).toEqual([[0], [1, 2], [3]]);
  });

  it("isolates a landscape page in the middle and resets pairing", () => {
    const result = calculateSpreads(pages(5, { 2: LANDSCAPE }), {
      ...DEFAULT_SPREAD_CONFIG,
      firstPageIsCover: false,
    });
    expect(result).toEqual([[0, 1], [2], [3, 4]]);
  });

  it("renders a portrait page alone when the next page is landscape", () => {
    const result = calculateSpreads(pages(2, { 1: LANDSCAPE }), {
      ...DEFAULT_SPREAD_CONFIG,
      firstPageIsCover: false,
    });
    expect(result).toEqual([[0], [1]]);
  });

  it("isolates a landscape page at the head", () => {
    const result = calculateSpreads(pages(3, { 0: LANDSCAPE }), {
      ...DEFAULT_SPREAD_CONFIG,
      firstPageIsCover: false,
    });
    expect(result).toEqual([[0], [1, 2]]);
  });

  it("isolates consecutive landscape pages individually", () => {
    const result = calculateSpreads(pages(5, { 1: LANDSCAPE, 2: LANDSCAPE }), {
      ...DEFAULT_SPREAD_CONFIG,
      firstPageIsCover: false,
    });
    expect(result).toEqual([[0], [1], [2], [3, 4]]);
  });

  it("combines cover offset with an interior landscape page", () => {
    const result = calculateSpreads(pages(5, { 2: LANDSCAPE }), DEFAULT_SPREAD_CONFIG);
    expect(result).toEqual([[0], [1], [2], [3, 4]]);
  });

  it("combines cover offset with a landscape cover page", () => {
    const result = calculateSpreads(pages(3, { 0: LANDSCAPE }), DEFAULT_SPREAD_CONFIG);
    expect(result).toEqual([[0], [1, 2]]);
  });

  it("treats dimensionless pages as portrait", () => {
    const noCover = { ...DEFAULT_SPREAD_CONFIG, firstPageIsCover: false };
    expect(calculateSpreads(pages(2), noCover)).toEqual([[0, 1]]);
  });

  it("respects a custom landscape threshold", () => {
    const wide = pages(2, { 1: { aspectRatio: 1.5 } });
    const strict = calculateSpreads(wide, {
      firstPageIsCover: false,
      landscapeThreshold: 2,
    });
    const loose = calculateSpreads(wide, {
      firstPageIsCover: false,
      landscapeThreshold: 1.4,
    });
    expect(strict).toEqual([[0, 1]]);
    expect(loose).toEqual([[0], [1]]);
  });
});

describe("alignToSpread", () => {
  const spreads = [[0], [1, 2], [3, 4]];

  it("returns the spread start for contained indices", () => {
    expect(alignToSpread(0, spreads)).toBe(0);
    expect(alignToSpread(1, spreads)).toBe(1);
    expect(alignToSpread(2, spreads)).toBe(1);
    expect(alignToSpread(4, spreads)).toBe(3);
  });

  it("clamps below the first spread to its start", () => {
    expect(alignToSpread(-1, spreads)).toBe(0);
    expect(alignToSpread(-100, spreads)).toBe(0);
  });

  it("clamps past the last spread to the last spread start", () => {
    expect(alignToSpread(5, spreads)).toBe(3);
    expect(alignToSpread(99, spreads)).toBe(3);
  });

  it("resolves an empty spread list to 0", () => {
    expect(alignToSpread(0, [])).toBe(0);
    expect(alignToSpread(7, [])).toBe(0);
  });
});

describe("calculateSpreads and alignToSpread invariants", () => {
  const configs = [
    DEFAULT_SPREAD_CONFIG,
    { ...DEFAULT_SPREAD_CONFIG, firstPageIsCover: false },
    {
      ...DEFAULT_SPREAD_CONFIG,
      firstPageIsCover: false,
      landscapeThreshold: 1.05,
    },
    { ...DEFAULT_SPREAD_CONFIG, landscapeThreshold: 3 },
  ];

  for (const config of configs) {
    for (const count of [0, 1, 2, 3, 4, 5, 6, 7, 11]) {
      const landscape: Record<number, Partial<MekuriPage>> = count > 2 ? { 2: LANDSCAPE } : {};
      const chapter = pages(count, landscape);
      const spreads = calculateSpreads(chapter, config);
      const label = `count=${count} ${config.firstPageIsCover ? "cover" : "no-cover"} threshold=${config.landscapeThreshold}`;

      it(`covers indices exactly once and aligns every index (${label})`, () => {
        expect(spreads.flat()).toEqual(Array.from({ length: count }, (_, i) => i));
        for (const spread of spreads) {
          expect(spread.length).toBeLessThanOrEqual(2);
          for (const index of spread) {
            expect(alignToSpread(index, spreads)).toBe(spread[0]);
          }
        }
      });
    }
  }
});
