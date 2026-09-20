import { describe, expect, it } from "vite-plus/test";
import {
  MockIntersectionObserver,
  MockResizeObserver,
  mockIntersectionObserver,
  mockResizeObserver,
} from "./observers";
import { mockScrollGeometry, mockViewportDimensions } from "./viewport";

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
