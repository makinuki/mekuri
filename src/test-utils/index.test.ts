import { describe, expect, it } from "vite-plus/test";
import {
  MockIntersectionObserver,
  MockResizeObserver,
  mockIntersectionObserver,
  mockResizeObserver,
} from "./observers";
import { mockScrollGeometry, mockViewportDimensions } from "./viewport";
import { mockRetryScheduler } from "./retries";
import { simulateTouchGesture } from "./gestures";

describe("mockResizeObserver", () => {
  it("installs the double on the window and restores the previous value", () => {
    const previous = window.ResizeObserver;
    const handle = mockResizeObserver();
    expect(window.ResizeObserver).toBe(MockResizeObserver);

    const seen: number[] = [];
    const observer = new MockResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) seen.push(entry.contentRect.height);
    });
    observer.observe(document.createElement("div"));
    handle.fireAll(() => 480);
    expect(seen).toEqual([480]);

    handle.restore();
    expect(window.ResizeObserver).toBe(previous);
  });

  it("resolves the instance after construction instead of at install time", () => {
    const handle = mockResizeObserver();
    try {
      expect(() => handle.fireAll(() => 100)).toThrow();
      const observer = new MockResizeObserver(() => {});
      expect(handle.latest()).toBe(observer);
      expect(handle.instances).toEqual([observer]);
    } finally {
      handle.restore();
    }
  });

  it("ignores nodes that were never observed", () => {
    const handle = mockResizeObserver();
    try {
      let fired = 0;
      const observer = new MockResizeObserver(() => {
        fired += 1;
      });
      observer.fire(document.createElement("div"), 100);
      expect(fired).toBe(0);
      expect(observer.observed).toEqual([]);
    } finally {
      handle.restore();
    }
  });
});

describe("mockIntersectionObserver", () => {
  it("reports intersections for observed nodes and restores the window", () => {
    const previous = window.IntersectionObserver;
    const handle = mockIntersectionObserver();
    expect(window.IntersectionObserver).toBe(MockIntersectionObserver);

    const seen: boolean[] = [];
    const observer = new MockIntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) seen.push(entry.isIntersecting);
    });
    const node = document.createElement("div");
    observer.observe(node);
    handle.intersect(node);
    handle.intersect(node, false);
    handle.intersect(document.createElement("div"));
    expect(seen).toEqual([true, false]);
    expect(handle.latest()).toBe(observer);

    handle.restore();
    expect(window.IntersectionObserver).toBe(previous);
  });

  it("drops observations and pending records when disconnected", () => {
    const observer = new MockIntersectionObserver(() => {});
    observer.observe(document.createElement("div"));
    observer.disconnect();
    expect(observer.disconnected).toBe(true);
    expect(observer.observed).toEqual([]);
    expect(observer.takeRecords()).toEqual([]);
  });
});

describe("mockViewportDimensions", () => {
  it("patches rect and layout metrics for one element and restores them", () => {
    const node = document.createElement("div");
    const restore = mockViewportDimensions(node, { width: 320, height: 640 });
    expect(node.getBoundingClientRect().height).toBe(640);
    expect(node.getBoundingClientRect().width).toBe(320);
    expect(node.clientHeight).toBe(640);
    expect(node.offsetHeight).toBe(640);
    expect(node.offsetWidth).toBe(320);

    restore();
    expect(node.getBoundingClientRect().height).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(node, "clientHeight")).toBe(false);
  });
});

describe("mockScrollGeometry", () => {
  it("keys viewport height on the viewport attribute and page height elsewhere", () => {
    const restore = mockScrollGeometry({ viewportHeight: 600, pageHeight: 1000 });
    try {
      const viewport = document.createElement("div");
      viewport.setAttribute("data-mekuri-viewport", "continuous-vertical");
      const page = document.createElement("div");
      expect(viewport.getBoundingClientRect().height).toBe(600);
      expect(viewport.clientHeight).toBe(600);
      expect(page.getBoundingClientRect().height).toBe(1000);
      expect(page.offsetHeight).toBe(1000);
      expect(page.getBoundingClientRect().width).toBe(400);
    } finally {
      restore();
    }
  });
});

describe("mockRetryScheduler", () => {
  it("captures scheduled retries and runs them on demand", () => {
    const scheduler = mockRetryScheduler();
    const ran: string[] = [];
    const cancelFirst = scheduler.schedule(() => ran.push("first"), 400);
    scheduler.schedule(() => ran.push("second"), 800);

    expect(scheduler.scheduled.map((entry) => entry.delayMs)).toEqual([400, 800]);
    expect(scheduler.next().cancelled).toBe(false);

    cancelFirst();
    expect(scheduler.pending().map((entry) => entry.delayMs)).toEqual([800]);

    scheduler.runAll();
    expect(ran).toEqual(["second"]);
    expect(scheduler.pending()).toEqual([]);
    expect(() => scheduler.next()).toThrow();
  });

  it("skips an entry that already ran or was cancelled", () => {
    const scheduler = mockRetryScheduler();
    let runs = 0;
    scheduler.schedule(() => {
      runs += 1;
    }, 400);

    const entry = scheduler.next();
    entry.run();
    entry.run();

    expect(runs).toBe(1);
    expect(entry.cancelled).toBe(true);
  });
});

describe("simulateTouchGesture", () => {
  interface RecordedEvent {
    type: string;
    touches: number;
    changed: number;
  }

  function record(element: HTMLElement, types: string[]): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const type of types) {
      element.addEventListener(type, (event) => {
        // A click carries no touch lists, so the record tolerates both shapes.
        const touchEvent = event as Partial<TouchEvent>;
        events.push({
          type,
          touches: touchEvent.touches?.length ?? 0,
          changed: touchEvent.changedTouches?.length ?? 0,
        });
      });
    }
    return events;
  }

  it("dispatches a drag as start, move steps, end, and a trailing click", async () => {
    const element = document.createElement("div");
    const events = record(element, ["touchstart", "touchmove", "touchend", "click"]);

    await simulateTouchGesture(element, {
      type: "pan",
      from: { x: 0, y: 0 },
      to: { x: 100, y: 40 },
      steps: 2,
    });

    expect(events).toEqual([
      { type: "touchstart", touches: 1, changed: 1 },
      { type: "touchmove", touches: 1, changed: 1 },
      { type: "touchmove", touches: 1, changed: 1 },
      { type: "touchend", touches: 0, changed: 1 },
      { type: "click", touches: 0, changed: 0 },
    ]);
  });

  it("carries the interpolated coordinates a controller reads", async () => {
    const element = document.createElement("div");
    const points: Array<{ id: number; x: number; y: number }> = [];
    element.addEventListener("touchmove", (event) => {
      const touch = (event as TouchEvent).touches[0];
      if (touch === undefined) return;
      points.push({ id: touch.identifier, x: touch.clientX, y: touch.clientY });
    });

    await simulateTouchGesture(element, {
      type: "swipe",
      from: { x: 10, y: 20 },
      to: { x: 110, y: 120 },
      steps: 2,
    });

    expect(points).toEqual([
      { id: 1, x: 60, y: 70 },
      { id: 1, x: 110, y: 120 },
    ]);
  });

  it("moves two fingers apart for a pinch", async () => {
    const element = document.createElement("div");
    const spans: number[] = [];
    element.addEventListener("touchmove", (event) => {
      const touches = (event as TouchEvent).touches;
      const first = touches[0];
      const second = touches[1];
      if (first === undefined || second === undefined) return;
      spans.push(Math.abs(second.clientX - first.clientX));
    });

    await simulateTouchGesture(element, {
      type: "pinch",
      center: { x: 100, y: 100 },
      from: 100,
      to: 200,
      steps: 2,
    });

    expect(spans).toEqual([150, 200]);
  });

  it("emits two taps for a double tap and can skip the trailing click", async () => {
    const element = document.createElement("div");
    const events = record(element, ["touchstart", "touchend", "click"]);

    await simulateTouchGesture(element, {
      type: "doubleTap",
      at: { x: 30, y: 40 },
      clickAfter: false,
    });

    expect(events).toEqual([
      { type: "touchstart", touches: 1, changed: 1 },
      { type: "touchend", touches: 0, changed: 1 },
      { type: "touchstart", touches: 1, changed: 1 },
      { type: "touchend", touches: 0, changed: 1 },
    ]);
  });
});
