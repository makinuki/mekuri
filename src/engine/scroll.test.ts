import { describe, expect, it } from "vite-plus/test";
import { resolvePageFromScrollOffset, type MekuriPageOffset } from "./scroll";

function offsets(entries: Array<[number, number, number]>): MekuriPageOffset[] {
  return entries.map(([index, top, bottom]) => ({ index, top, bottom }));
}

// Three consecutive pages of height 1000 covering [0, 3000).
const FIXTURE = offsets([
  [0, 0, 1000],
  [1, 1000, 2000],
  [2, 2000, 3000],
]);

describe("resolvePageFromScrollOffset", () => {
  it("resolves a point inside a page to that page with a fractional offset", () => {
    expect(resolvePageFromScrollOffset(1250, FIXTURE)).toEqual({
      pageIndex: 1,
      relativeOffset: 0.25,
    });
    expect(resolvePageFromScrollOffset(2000, FIXTURE)).toEqual({
      pageIndex: 2,
      relativeOffset: 0,
    });
    expect(resolvePageFromScrollOffset(999.5, FIXTURE)).toEqual({
      pageIndex: 0,
      relativeOffset: 0.9995,
    });
  });

  it("clamps offsets above the first page to the first page at 0", () => {
    expect(resolvePageFromScrollOffset(-50, FIXTURE)).toEqual({
      pageIndex: 0,
      relativeOffset: 0,
    });
  });

  it("clamps offsets past the last page to the last page at 1", () => {
    expect(resolvePageFromScrollOffset(5000, FIXTURE)).toEqual({
      pageIndex: 2,
      relativeOffset: 1,
    });
  });

  it("resolves gap offsets to the preceding page at 1", () => {
    const gapped = offsets([
      [0, 0, 1000],
      [1, 1100, 2100],
    ]);
    expect(resolvePageFromScrollOffset(1050, gapped)).toEqual({
      pageIndex: 0,
      relativeOffset: 1,
    });
  });

  it("handles zero-height entries without dividing by zero", () => {
    const degenerate = offsets([
      [0, 0, 0],
      [1, 0, 1000],
    ]);
    expect(resolvePageFromScrollOffset(0, degenerate).relativeOffset).toBe(0);
  });

  it("sorts defensively so unsorted input still resolves correctly", () => {
    const unsorted = offsets([
      [2, 2000, 3000],
      [0, 0, 1000],
      [1, 1000, 2000],
    ]);
    expect(resolvePageFromScrollOffset(1500, unsorted)).toEqual({
      pageIndex: 1,
      relativeOffset: 0.5,
    });
  });

  it("does not mutate the input array", () => {
    const input = offsets([
      [2, 2000, 3000],
      [0, 0, 1000],
    ]);
    resolvePageFromScrollOffset(100, input);
    expect(input[0]).toEqual({ index: 2, top: 2000, bottom: 3000 });
  });

  it("resolves an empty list to page 0 at 0", () => {
    expect(resolvePageFromScrollOffset(100, [])).toEqual({
      pageIndex: 0,
      relativeOffset: 0,
    });
  });

  it("resolves a single page at any offset with clamped fractions", () => {
    const single = offsets([[7, 500, 1500]]);
    expect(resolvePageFromScrollOffset(800, single)).toEqual({
      pageIndex: 7,
      relativeOffset: 0.3,
    });
    expect(resolvePageFromScrollOffset(100, single)).toEqual({
      pageIndex: 7,
      relativeOffset: 0,
    });
    expect(resolvePageFromScrollOffset(2000, single)).toEqual({
      pageIndex: 7,
      relativeOffset: 1,
    });
  });
});
