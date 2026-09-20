// Test harness for ContinuousView. jsdom has no layout engine and observer
// entries never fire on their own, so the harness owns the geometry: rect and
// offset reads come from the geometry doubles, measurements are driven through
// the ResizeObserver double, and scroll sequences are dispatched on the real
// scroll element the view binds.
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ContinuousView } from "./continuous";
import { IMAGE_LOAD_FAILED, RESOLVE_FAILED } from "../engine/pipeline";
import type { MekuriReadingPosition } from "../engine/scroll";
import { createMekuriEngine, type MekuriEngineOptions } from "../engine/store";
import type { MekuriPage } from "../engine/types";
import { mockResizeObserver, type MockResizeObserverHandle } from "../test-utils/observers";
import { mockRetryScheduler } from "../test-utils/retries";
import { mockScrollGeometry } from "../test-utils/viewport";

const VIEWPORT_HEIGHT = 600;
const PAGE_HEIGHT = 1000;

interface Harness {
  resize: MockResizeObserverHandle;
  /** Fires one measurement entry per mounted item and viewport. */
  measure(height?: number): void;
  restore(): void;
}

let active: Harness | null = null;

function mountGeometry(viewportHeight = VIEWPORT_HEIGHT, pageHeight = PAGE_HEIGHT): Harness {
  const restoreGeometry = mockScrollGeometry({ viewportHeight, pageHeight });
  const resize = mockResizeObserver();
  const harness: Harness = {
    resize,
    measure(height = pageHeight) {
      act(() => {
        resize.fireAll(() => height);
      });
    },
    restore() {
      resize.restore();
      restoreGeometry();
    },
  };
  active = harness;
  return harness;
}

afterEach(() => {
  active?.restore();
  active = null;
});

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `page-${index}`,
    metadata: { src: `https://example.test/pages/${index}.jpg` },
  }));
}

function scroller(container: HTMLElement): HTMLElement {
  const element = container.querySelector("[data-mekuri-viewport]");
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

function column(container: HTMLElement): HTMLElement {
  const element = container.querySelector("[data-mekuri-column]");
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

function pageBoxes(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("[data-mekuri-page]")] as HTMLElement[];
}

function boxFor(container: HTMLElement, index: number): HTMLElement {
  const box = pageBoxes(container).find(
    (candidate) => candidate.getAttribute("data-index") === String(index),
  );
  expect(box).not.toBeUndefined();
  return box as HTMLElement;
}

/** Programmatic writes to scrollTop produce a scroll event on the platform;
 * jsdom reports none, so the harness reports one. */
function reportScroll(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new Event("scroll"));
  });
}

/** Lets the frame-coalesced scroll path and the virtualizer settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

function continuousEngine(options: Partial<MekuriEngineOptions> = {}) {
  const list = options.pages ?? pages(12);
  return createMekuriEngine({
    ...options,
    pages: list,
    initialState: { mode: "continuous-vertical", ...options.initialState },
  });
}

describe("ContinuousView alignment", () => {
  it("restores the stored position on mount without reporting navigation", () => {
    const layout = mountGeometry();
    const list = pages(8);
    const samples: MekuriReadingPosition[] = [];
    const engine = createMekuriEngine({
      pages: list,
      initialState: { mode: "continuous-vertical", pageIndex: 3 },
      onPositionSample: (position) => samples.push(position),
    });
    const { container } = render(<ContinuousView engine={engine} pages={list} />);
    const element = scroller(container);

    layout.measure();
    reportScroll(element);

    // The mount restore first lands on the estimate; measurements replace it
    // and the view re-applies the same reading position.
    expect(element.scrollTop).toBe(3 * PAGE_HEIGHT);
    expect(engine.getState().pageIndex).toBe(3);
    expect(samples.filter((sample) => sample.pageIndex !== 3)).toEqual([]);
  });

  it("lands on the fractional offset requested by goToIndex", async () => {
    const layout = mountGeometry();
    const list = pages(12);
    const engine = continuousEngine({ pages: list });
    const { container } = render(<ContinuousView engine={engine} pages={list} />);
    const element = scroller(container);
    layout.measure();
    reportScroll(element);
    await settle();

    act(() => {
      engine.goToIndex(6, 0.62);
    });
    reportScroll(element);
    await settle();
    // The target page mounts on the move; its measurement replaces the
    // estimate the first alignment used.
    layout.measure();
    reportScroll(element);
    await settle();

    expect(element.scrollTop).toBe(6 * PAGE_HEIGHT + 620);
    expect(engine.getReadingPosition().pageIndex).toBe(6);
    expect(engine.getReadingPosition().relativeOffset).toBeCloseTo(0.62, 6);
  });

  it("adopts the dominant page on user scroll", async () => {
    const layout = mountGeometry();
    const list = pages(12);
    const engine = continuousEngine({ pages: list });
    const { container } = render(<ContinuousView engine={engine} pages={list} />);
    const element = scroller(container);
    layout.measure();
    reportScroll(element);
    await settle();

    act(() => {
      element.scrollTop = 5 * PAGE_HEIGHT + 100;
      element.dispatchEvent(new Event("scroll"));
    });
    await settle();
    layout.measure();
    await settle();
    act(() => {
      element.scrollTop = 5 * PAGE_HEIGHT + 100;
      element.dispatchEvent(new Event("scroll"));
    });
    await settle();

    expect(engine.getState().pageIndex).toBe(5);
    expect(engine.getReadingPosition().relativeOffset).toBeCloseTo(0.1, 6);
  });
});

describe("ContinuousView integer layout", () => {
  it("rounds measured heights and column offsets to integer pixels", () => {
    const layout = mountGeometry(VIEWPORT_HEIGHT, 1000.4);
    const list = pages(4);
    const engine = continuousEngine({
      pages: list,
      initialState: { mode: "continuous-webtoon" },
    });
    const { container } = render(<ContinuousView engine={engine} pages={list} />);
    layout.measure(1000.4);
    reportScroll(scroller(container));

    // Four pages of 1000.4 px would total 4001.6 px without rounding.
    expect(column(container).style.height).toBe(`${4 * PAGE_HEIGHT}px`);

    const boxes = pageBoxes(container);
    expect(boxes).toHaveLength(4);
    for (const box of boxes) {
      expect(box.style.top).toMatch(/^\d+px$/);
      expect(box.style.display).toBe("block");
      expect(box.style.overflow).toBe("hidden");
      // No compositor promotion: transforms and will-change create layers.
      expect(box.getAttribute("style")).not.toMatch(/transform|will-change/);
      const image = box.querySelector("img");
      expect(image?.style.display).toBe("block");
      expect(image?.getAttribute("style")).not.toMatch(/transform|will-change/);
    }
  });

  it("honors the host gap and collapses it to zero in webtoon mode", () => {
    const layout = mountGeometry();
    const list = pages(4);
    const engine = continuousEngine({ pages: list });
    const { container, rerender } = render(
      <ContinuousView engine={engine} pages={list} gap={24} />,
    );
    layout.measure();
    reportScroll(scroller(container));
    // Four pages of 1000 px with three 24 px gaps.
    expect(column(container).style.height).toBe(`${4 * PAGE_HEIGHT + 3 * 24}px`);

    act(() => {
      engine.setMode("continuous-webtoon");
    });
    rerender(<ContinuousView engine={engine} pages={list} gap={24} />);
    expect(column(container).style.height).toBe(`${4 * PAGE_HEIGHT}px`);
    expect(scroller(container).getAttribute("data-mekuri-viewport")).toBe("continuous-webtoon");
  });
});

describe("ContinuousView memory safety", () => {
  it("keeps the mounted DOM bounded and detaches offscreen sources", async () => {
    const layout = mountGeometry();
    const list = pages(500);
    const engine = continuousEngine({ pages: list });
    const { container } = render(<ContinuousView engine={engine} pages={list} />);
    const element = scroller(container);
    layout.measure();
    reportScroll(element);
    await settle();

    // One visible page plus four pages of overscan on each side.
    expect(pageBoxes(container).length).toBeLessThanOrEqual(12);
    const detached = pageBoxes(container).filter(
      (box) => box.getAttribute("data-mekuri-detached") === "true",
    );
    expect(detached.length).toBeGreaterThan(0);
    for (const box of detached) {
      expect(box.querySelector("img")?.getAttribute("src")).toBeNull();
      expect(box.style.height).toMatch(/^\d+px$/);
    }

    act(() => {
      element.scrollTop = 40 * PAGE_HEIGHT;
      element.dispatchEvent(new Event("scroll"));
    });
    await settle();

    const activeIndexes = pageBoxes(container)
      .filter((box) => box.getAttribute("data-mekuri-active") === "true")
      .map((box) => Number(box.getAttribute("data-index")));
    // The jump lands deep in the chapter; exact page identity depends on
    // measurements the harness does not fire for every mounted item.
    expect(Math.min(...activeIndexes)).toBeGreaterThan(30);
    expect(pageBoxes(container).length).toBeLessThanOrEqual(12);
    for (const image of container.querySelectorAll("img[src]")) {
      const box = image.closest("[data-mekuri-page]");
      expect(activeIndexes).toContain(Number(box?.getAttribute("data-index")));
    }
  });
});

describe("ContinuousView repagination", () => {
  it("re-runs the restore when the page list shrinks under the reading position", () => {
    const layout = mountGeometry();
    const long = pages(6);
    const options: MekuriEngineOptions = {
      pages: long,
      initialState: { mode: "continuous-vertical", pageIndex: 4 },
    };
    const engine = createMekuriEngine(options);
    const { container, rerender } = render(<ContinuousView engine={engine} pages={long} />);
    layout.measure();
    reportScroll(scroller(container));
    expect(scroller(container).scrollTop).toBe(4 * PAGE_HEIGHT);

    const short = pages(4);
    options.pages = short;
    rerender(<ContinuousView engine={engine} pages={short} />);

    expect(engine.getReadingPosition().pageIndex).toBe(3);
    expect(scroller(container).scrollTop).toBe(3 * PAGE_HEIGHT);
  });

  it("recomputes spreads when a landscape page is discovered and holds the viewport on it", () => {
    const layout = mountGeometry();
    const portrait = pages(6);
    const options: MekuriEngineOptions = {
      pages: portrait,
      initialState: { mode: "continuous-vertical", pageIndex: 3 },
    };
    const engine = createMekuriEngine(options);
    const { container, rerender } = render(<ContinuousView engine={engine} pages={portrait} />);
    layout.measure();
    reportScroll(scroller(container));
    expect(scroller(container).scrollTop).toBe(3 * PAGE_HEIGHT);

    // Page 3 turns out to be landscape: the engine repaginates on the new
    // dimensions and the view holds the page the reading position points at.
    const discovered = portrait.map((page, index) =>
      index === 3 ? { ...page, width: 1600, height: 900 } : { ...page, width: 800, height: 1200 },
    );
    options.pages = discovered;
    rerender(<ContinuousView engine={engine} pages={discovered} />);

    expect(engine.getState().activeSpreads).toContainEqual([3]);
    expect(scroller(container).scrollTop).toBe(3 * PAGE_HEIGHT);
    expect(engine.getReadingPosition().pageIndex).toBe(3);
  });
});

describe("ContinuousView mode switching", () => {
  it("preserves the reading position across a mode switch round trip", async () => {
    const layout = mountGeometry();
    const list = pages(6);
    const engine = continuousEngine({ pages: list });
    const { container, rerender } = render(
      <ContinuousView engine={engine} pages={list} gap={24} />,
    );
    const element = scroller(container);
    layout.measure();
    reportScroll(element);
    await settle();

    act(() => {
      element.scrollTop = 4 * PAGE_HEIGHT + 4 * 24;
      element.dispatchEvent(new Event("scroll"));
    });
    await settle();
    expect(engine.getState().pageIndex).toBe(4);

    act(() => {
      engine.setMode("continuous-webtoon");
    });
    rerender(<ContinuousView engine={engine} pages={list} gap={24} />);
    reportScroll(element);
    expect(engine.getState().pageIndex).toBe(4);
    expect(element.scrollTop).toBe(4 * PAGE_HEIGHT);

    act(() => {
      engine.setMode("continuous-vertical");
    });
    rerender(<ContinuousView engine={engine} pages={list} gap={24} />);
    reportScroll(element);
    expect(engine.getState().pageIndex).toBe(4);
    expect(element.scrollTop).toBe(4 * PAGE_HEIGHT + 4 * 24);
  });
});

describe("ContinuousView image pipeline", () => {
  it("recovers a flaky source after exactly maxAutoRetries plus one attempts", async () => {
    const layout = mountGeometry();
    const list = pages(3);
    const retries = mockRetryScheduler();
    const attempts: number[] = [];
    const engine = continuousEngine({
      pages: list,
      scheduleRetry: retries.schedule,
      resolveSrc: (_page, attempt) => {
        attempts.push(attempt);
        if (attempt < 3) throw new Error(`attempt ${attempt} failed`);
        return `https://example.test/pages/0.jpg?retry=${attempt}`;
      },
    });
    const { container } = render(<ContinuousView engine={engine} pages={list} />);
    layout.measure();
    await settle();

    expect(attempts).toEqual([1]);
    expect(engine.getState().failures["page-0"]).toEqual({
      attempt: 1,
      stage: "resolve",
      code: RESOLVE_FAILED,
      message: "attempt 1 failed",
    });
    expect(boxFor(container, 0).getAttribute("data-mekuri-src-state")).toBe("failed");
    // One backoff per failure, doubling: 400 ms after attempt 1, 800 ms after 2.
    expect(retries.scheduled.map((entry) => entry.delayMs)).toEqual([400]);

    act(() => retries.next().run());
    await settle();

    expect(attempts).toEqual([1, 2]);
    expect(retries.scheduled.map((entry) => entry.delayMs)).toEqual([400, 800]);

    act(() => retries.next().run());
    await settle();

    expect(attempts).toEqual([1, 2, 3]);
    expect(engine.getState().failures).toEqual({});
    expect(retries.pending()).toEqual([]);
    expect(boxFor(container, 0).getAttribute("data-mekuri-src-state")).toBe("ready");
    expect(boxFor(container, 0).querySelector("img")?.getAttribute("src")).toBe(
      "https://example.test/pages/0.jpg?retry=3",
    );
  });

  it("keeps the attempt counter and the registry across a view remount", async () => {
    const layout = mountGeometry();
    const list = pages(3);
    const retries = mockRetryScheduler();
    const attempts: number[] = [];
    const engine = continuousEngine({
      pages: list,
      scheduleRetry: retries.schedule,
      resolveSrc: (_page, attempt) => {
        attempts.push(attempt);
        if (attempt < 2) throw new Error(`attempt ${attempt} failed`);
        return `https://example.test/pages/0.jpg?retry=${attempt}`;
      },
    });
    const first = render(<ContinuousView engine={engine} pages={list} />);
    layout.measure();
    await settle();
    expect(attempts).toEqual([1]);

    first.unmount();

    // The registry and the attempt counter belong to the engine, so the failure
    // survives the unmount as plain data.
    const failures = engine.getState().failures;
    expect(failures["page-0"]).toEqual({
      attempt: 1,
      stage: "resolve",
      code: RESOLVE_FAILED,
      message: "attempt 1 failed",
    });
    expect(failures["page-0"]).not.toBeInstanceOf(Error);
    expect(JSON.parse(JSON.stringify(failures))).toEqual(failures);

    const second = render(<ContinuousView engine={engine} pages={list} />);
    layout.measure();
    await settle();
    // A remount resumes the pending backoff instead of resolving attempt 1 again.
    expect(attempts).toEqual([1]);
    expect(retries.pending()).toHaveLength(1);

    act(() => retries.next().run());
    await settle();

    expect(attempts).toEqual([1, 2]);
    expect(engine.getState().failures).toEqual({});
    expect(boxFor(second.container, 0).querySelector("img")?.getAttribute("src")).toBe(
      "https://example.test/pages/0.jpg?retry=2",
    );
  });

  it("records a load error from the image element and clears it when the image loads", async () => {
    const layout = mountGeometry();
    const list = pages(3);
    const retries = mockRetryScheduler();
    const engine = continuousEngine({
      pages: list,
      scheduleRetry: retries.schedule,
      resolveSrc: (_page, attempt) => `https://example.test/pages/0.jpg?retry=${attempt}`,
    });
    const { container } = render(<ContinuousView engine={engine} pages={list} />);
    layout.measure();
    await settle();

    const image = boxFor(container, 0).querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.test/pages/0.jpg?retry=1");

    act(() => {
      fireEvent.error(image as HTMLImageElement);
    });

    expect(engine.getState().failures["page-0"]).toEqual({
      attempt: 1,
      stage: "load",
      code: IMAGE_LOAD_FAILED,
      message: "Page 1 reported a load error",
    });
    expect(boxFor(container, 0).getAttribute("data-mekuri-src-state")).toBe("failed");
    expect(retries.scheduled.map((entry) => entry.delayMs)).toEqual([400]);

    act(() => retries.next().run());
    await settle();

    // The new attempt re-resolves and the image element is recreated for it.
    const retried = boxFor(container, 0).querySelector("img");
    expect(retried).not.toBe(image);
    expect(retried?.getAttribute("src")).toBe("https://example.test/pages/0.jpg?retry=2");

    act(() => {
      fireEvent.load(retried as HTMLImageElement);
    });

    expect(engine.getState().failures).toEqual({});
    expect(retries.pending()).toEqual([]);
    expect(boxFor(container, 0).getAttribute("data-mekuri-src-state")).toBe("ready");
  });

  it("pins a page box at its measured height while its source is in flight", async () => {
    const layout = mountGeometry();
    const list = pages(2);
    const pending: (() => void)[] = [];
    const engine = continuousEngine({
      pages: list,
      scheduleRetry: mockRetryScheduler().schedule,
      resolveSrc: (_page, attempt) =>
        new Promise<string>((resolve) => {
          pending.push(() => resolve(`https://example.test/pages/0.jpg?retry=${attempt}`));
        }),
    });
    const { container } = render(<ContinuousView engine={engine} pages={list} />);
    layout.measure();

    const box = boxFor(container, 0);
    expect(box.getAttribute("data-mekuri-src-state")).toBe("pending");
    expect(box.style.height).toBe(`${PAGE_HEIGHT}px`);
    expect(column(container).style.height).toBe(`${2 * PAGE_HEIGHT}px`);

    await act(async () => {
      pending[0]?.();
    });

    expect(box.getAttribute("data-mekuri-src-state")).toBe("ready");
    expect(box.style.height).toBe("");
    expect(box.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.test/pages/0.jpg?retry=1",
    );
  });
});
