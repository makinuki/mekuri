// @vitest-environment node
// Store tests run in plain Node: the vanilla engine must be fully usable
// without any DOM, which is the SSR-safety guarantee.
import { describe, expect, it, vi } from "vite-plus/test";
import { createMekuriEngine, type MekuriEngineOptions } from "./store";
import { DEFAULT_SPREAD_CONFIG, type MekuriPage } from "./types";

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, i) => ({ id: i }));
}

// 6 pages, default spread config (cover on): [[0], [1, 2], [3, 4], [5]]
function harness(overrides: Partial<MekuriEngineOptions> = {}) {
  const events = {
    patches: [] as Array<Record<string, unknown>>,
    boundaries: [] as string[],
    samples: [] as Array<{ pageIndex: number; relativeOffset: number }>,
    time: 0,
  };
  const options: MekuriEngineOptions = {
    pages: pages(6),
    now: () => events.time,
    onStateChange: (patch) => events.patches.push(patch),
    onPositionSample: (position) => events.samples.push(position),
    onBoundaryReached: (boundary) => events.boundaries.push(boundary),
    ...overrides,
  };
  return { engine: createMekuriEngine(options), events, options };
}

const OFFSETS = [
  { index: 0, top: 0, bottom: 1000 },
  { index: 1, top: 1000, bottom: 2000 },
  { index: 2, top: 2000, bottom: 3000 },
];

function defaultControlled() {
  return {
    pageIndex: 0,
    mode: "single" as const,
    direction: "ltr" as const,
    zoomScale: 1,
    spreadConfig: { ...DEFAULT_SPREAD_CONFIG },
  };
}

describe("uncontrolled store defaults and derivation", () => {
  it("starts with sensible defaults and derived state", () => {
    const { engine } = harness();
    const state = engine.getState();
    expect(state.pageIndex).toBe(0);
    expect(state.mode).toBe("single");
    expect(state.direction).toBe("ltr");
    expect(state.zoomScale).toBe(1);
    expect(state.totalPages).toBe(6);
    expect(state.activeSpreads).toEqual([[0], [1, 2], [3, 4], [5]]);
    expect(state.isZoomLocked).toBe(false);
    expect(state.isHUDVisible).toBe(true);
    expect(state.failures).toEqual({});
  });

  it("keeps the snapshot stable until state actually changes", () => {
    const { engine } = harness();
    const before = engine.getState();
    expect(engine.getState()).toBe(before);
    engine.next();
    expect(engine.getState()).not.toBe(before);
    expect(engine.getState().pageIndex).toBe(1);
  });

  it("notifies subscribers on mutation and honors unsubscribe", () => {
    const { engine } = harness();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    engine.next();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    engine.next();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("navigation actions", () => {
  it("advances and retreats one page in single mode", () => {
    const { engine } = harness();
    engine.next();
    engine.next();
    expect(engine.getState().pageIndex).toBe(2);
    engine.prev();
    expect(engine.getState().pageIndex).toBe(1);
  });

  it("fires boundary events and holds at chapter edges", () => {
    const { engine, events } = harness();
    engine.prev();
    expect(events.boundaries).toEqual(["start"]);
    expect(engine.getState().pageIndex).toBe(0);
    engine.goToIndex(5);
    engine.next();
    expect(events.boundaries).toEqual(["start", "end"]);
    expect(engine.getState().pageIndex).toBe(5);
  });

  it("navigates by spread in double mode", () => {
    const { engine, events } = harness({
      initialState: { mode: "double" },
    });
    engine.next();
    expect(engine.getState().pageIndex).toBe(1);
    engine.next();
    expect(engine.getState().pageIndex).toBe(3);
    engine.next();
    expect(engine.getState().pageIndex).toBe(5);
    engine.next();
    expect(events.boundaries).toEqual(["end"]);
    engine.prev();
    expect(engine.getState().pageIndex).toBe(3);
  });

  it("clamps goToIndex and stores the fractional offset", () => {
    const { engine } = harness();
    engine.goToIndex(4, 0.5);
    expect(engine.getReadingPosition()).toEqual({
      pageIndex: 4,
      relativeOffset: 0.5,
    });
    engine.goToIndex(99);
    expect(engine.getState().pageIndex).toBe(5);
    expect(engine.getReadingPosition().relativeOffset).toBe(0);
    engine.goToIndex(-3);
    expect(engine.getState().pageIndex).toBe(0);
  });

  it("aligns goToIndex to the spread in double mode", () => {
    const { engine } = harness({ initialState: { mode: "double" } });
    engine.goToIndex(2);
    expect(engine.getState().pageIndex).toBe(1);
  });
});

describe("mode switching preserves logical position", () => {
  it("aligns to the spread start when entering double mode", () => {
    const { engine } = harness();
    engine.goToIndex(2);
    engine.setMode("double");
    expect(engine.getState().pageIndex).toBe(1);
  });

  it("keeps the spread start index when leaving double mode", () => {
    const { engine } = harness();
    engine.setMode("double");
    engine.next();
    expect(engine.getState().pageIndex).toBe(1);
    engine.setMode("single");
    expect(engine.getState().pageIndex).toBe(1);
  });

  it("keeps the index for continuous mode transitions", () => {
    const { engine } = harness();
    engine.goToIndex(3);
    engine.setMode("continuous-webtoon");
    expect(engine.getState().pageIndex).toBe(3);
    engine.setMode("double");
    expect(engine.getState().pageIndex).toBe(3);
  });
});

describe("display state actions", () => {
  it("toggles HUD and honors explicit force", () => {
    const { engine } = harness();
    engine.toggleHUD();
    expect(engine.getState().isHUDVisible).toBe(false);
    engine.toggleHUD(true);
    expect(engine.getState().isHUDVisible).toBe(true);
    engine.toggleHUD(false);
    expect(engine.getState().isHUDVisible).toBe(false);
  });

  it("locks zoom above 1.0 and clamps negative scales", () => {
    const { engine } = harness();
    engine.setZoomScale(2.5, { x: 0.5, y: 0.5 });
    expect(engine.getState().zoomScale).toBe(2.5);
    expect(engine.getState().isZoomLocked).toBe(true);
    engine.setZoomScale(0.5);
    expect(engine.getState().zoomScale).toBe(1);
    expect(engine.getState().isZoomLocked).toBe(false);
    engine.setZoomScale(3);
    engine.resetZoom();
    expect(engine.getState().zoomScale).toBe(1);
  });

  it("applies direction changes", () => {
    const { engine } = harness();
    engine.setDirection("rtl");
    expect(engine.getState().direction).toBe("rtl");
  });
});

describe("controlled mode", () => {
  it("reports minimal patches and mirrors them optimistically", () => {
    const { engine, events } = harness({ state: { ...defaultControlled() } });
    engine.next();
    expect(events.patches).toEqual([{ pageIndex: 1 }]);
    expect(engine.getState().pageIndex).toBe(1);
    engine.setDirection("rtl");
    expect(events.patches[1]).toEqual({ direction: "rtl" });
    engine.toggleHUD(false);
    expect(events.patches).toHaveLength(2); // HUD is derived, never patched
  });

  it("experiences zero drift when the host echoes patches back", () => {
    const { engine, events, options } = harness({
      state: { ...defaultControlled() },
    });
    engine.next();
    // Compliant host applies the patch and feeds reconciled state back.
    const hostState = {
      ...defaultControlled(),
      ...events.patches[events.patches.length - 1],
    };
    options.state = hostState;
    engine.syncControlled(hostState);
    expect(engine.getState().pageIndex).toBe(1);
    expect(events.patches).toHaveLength(1);
  });

  it("lets host state win on reconciliation", () => {
    const { engine, options } = harness({ state: { ...defaultControlled() } });
    engine.next();
    const hostState = { ...defaultControlled(), pageIndex: 4 };
    options.state = hostState;
    engine.syncControlled(hostState);
    expect(engine.getState().pageIndex).toBe(4);
  });

  it("never calls onStateChange in uncontrolled mode", () => {
    const { engine, events } = harness();
    engine.next();
    engine.setMode("double");
    engine.resetZoom();
    expect(events.patches).toEqual([]);
  });

  it("reports mode plus aligned index when entering double mode", () => {
    const { engine, events } = harness({ state: { ...defaultControlled() } });
    engine.goToIndex(2);
    engine.setMode("double");
    expect(events.patches[events.patches.length - 1]).toEqual({
      mode: "double",
      pageIndex: 1,
    });
  });
});

describe("position sampling", () => {
  it("fires a sample immediately on discrete page changes", () => {
    const { engine, events } = harness();
    engine.next();
    expect(events.samples).toEqual([{ pageIndex: 1, relativeOffset: 0 }]);
  });

  it("fires a sample on goToIndex with the requested offset", () => {
    const { engine, events } = harness();
    engine.goToIndex(3, 0.75);
    expect(events.samples).toEqual([{ pageIndex: 3, relativeOffset: 0.75 }]);
  });

  it("throttles same-page scroll samples to the interval", () => {
    const { engine, events } = harness({ positionSampleInterval: 1000 });
    engine.goToIndex(0, 0.1);
    events.samples.length = 0;
    events.time = 500;
    engine.reportScroll(500, OFFSETS);
    expect(events.samples).toEqual([]); // within window, same page
    events.time = 1600;
    engine.reportScroll(600, OFFSETS);
    expect(events.samples).toEqual([{ pageIndex: 0, relativeOffset: 0.6 }]);
  });

  it("fires immediately when scrolling crosses into a new page", () => {
    const { engine, events } = harness({ positionSampleInterval: 1000 });
    engine.goToIndex(0);
    events.samples.length = 0; // goToIndex emits its own sample first
    events.time = 100;
    engine.reportScroll(1500, OFFSETS);
    expect(events.samples).toEqual([{ pageIndex: 1, relativeOffset: 0.5 }]);
    expect(engine.getState().pageIndex).toBe(1);
    expect(engine.getReadingPosition()).toEqual({
      pageIndex: 1,
      relativeOffset: 0.5,
    });
  });
});

describe("engine edge cases", () => {
  it("survives an empty page list", () => {
    const { engine, events } = harness({ pages: [] });
    engine.next();
    expect(events.boundaries).toEqual(["end"]);
    expect(engine.getState().pageIndex).toBe(0);
    expect(engine.getState().totalPages).toBe(0);
  });

  it("recomputes spreads when the host swaps the page list", () => {
    const { engine, options } = harness();
    expect(engine.getState().totalPages).toBe(6);
    options.pages = pages(3);
    engine.next();
    expect(engine.getState().totalPages).toBe(3);
    expect(engine.getState().activeSpreads).toEqual([[0], [1, 2]]);
  });

  it("respects initialState overrides", () => {
    const { engine } = harness({
      initialState: {
        pageIndex: 2,
        mode: "double",
        direction: "rtl",
        zoomScale: 2,
        spreadConfig: { firstPageIsCover: false, landscapeThreshold: 1.2 },
      },
    });
    const state = engine.getState();
    expect(state.pageIndex).toBe(2);
    expect(state.direction).toBe("rtl");
    expect(state.isZoomLocked).toBe(true);
    expect(state.activeSpreads).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    expect(state.spreadConfig).toEqual({
      firstPageIsCover: false,
      landscapeThreshold: 1.2,
    });
  });

  it("uses the default spread config shape", () => {
    expect(DEFAULT_SPREAD_CONFIG).toEqual({
      firstPageIsCover: true,
      landscapeThreshold: 1.2,
    });
  });
});

describe("page list replacement", () => {
  it("keeps derived state stable when a fresh list carries the same dimensions", () => {
    const options: MekuriEngineOptions = { pages: pages(6) };
    const engine = createMekuriEngine(options);
    const before = engine.getState();

    options.pages = pages(6);

    expect(engine.getState()).toBe(before);
  });

  it("repaginates when dimensions are discovered on a replacement list", () => {
    const options: MekuriEngineOptions = {
      pages: Array.from({ length: 6 }, (_, index) => ({ id: index, width: 800, height: 1200 })),
    };
    const engine = createMekuriEngine(options);
    expect(engine.getState().activeSpreads).toContainEqual([3, 4]);

    options.pages = options.pages.map((page, index) =>
      index === 3 ? { ...page, width: 1600, height: 900 } : page,
    );

    expect(engine.getState().activeSpreads).toContainEqual([3]);
    expect(engine.getState().pageIndex).toBe(0);
  });

  it("rebuilds when the list length changes", () => {
    const options: MekuriEngineOptions = { pages: pages(6) };
    const engine = createMekuriEngine(options);
    const before = engine.getState();

    options.pages = pages(4);

    expect(engine.getState()).not.toBe(before);
    expect(engine.getState().totalPages).toBe(4);
  });
});
