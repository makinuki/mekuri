// PagedView tests render the surface against a real engine. jsdom has no
// layout, so placement is asserted through the attributes and styles the view
// writes, and pointer behavior is driven through the touch simulator with the
// geometry double supplying the element box the zone hit-test normalizes
// against.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { PagedView, type PagedViewProps } from "./paged";
import type { MekuriEngine, MekuriEngineOptions } from "../engine/store";
import { createMekuriEngine } from "../engine/store";
import type { ChapterBoundary, MekuriPage } from "../engine/types";
import { simulateTouchGesture } from "../test-utils/gestures";
import { mockViewportDimensions } from "../test-utils/viewport";

const WIDTH = 400;
const HEIGHT = 600;

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

const PAGES = pages(6);

interface Harness {
  engine: MekuriEngine;
  container: HTMLElement;
}

function renderPaged(
  engineOptions: Partial<MekuriEngineOptions> = {},
  props: Partial<PagedViewProps> = {},
): Harness {
  const enginePages = engineOptions.pages ?? PAGES;
  const engine = createMekuriEngine({ pages: enginePages, ...engineOptions });
  const { container } = render(<PagedView engine={engine} pages={enginePages} {...props} />);
  return { engine, container };
}

afterEach(cleanup);

function pageBoxes(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("[data-mekuri-paged-page]")] as HTMLElement[];
}

function control(container: HTMLElement, name: string): HTMLButtonElement | null {
  return container.querySelector(`[data-mekuri-control="${name}"]`);
}

function surface(container: HTMLElement): HTMLElement {
  const element = container.querySelector("[data-mekuri-viewport]");
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

describe("PagedView layout", () => {
  it("renders the page at the reading position with its description", () => {
    const { container } = renderPaged();

    const boxes = pageBoxes(container);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].getAttribute("data-index")).toBe("0");
    expect(boxes[0].getAttribute("data-mekuri-spread-position")).toBe("0");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("Page 1");
  });

  it("uses the host labeler for the description", () => {
    const { container } = renderPaged({}, { altLabeler: (_page, index) => `Sheet ${index + 1}` });
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("Sheet 1");
  });

  it("renders one page per position in single mode", () => {
    const { engine, container } = renderPaged({ initialState: { mode: "single" } });

    act(() => engine.goToIndex(1));
    const boxes = pageBoxes(container);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].getAttribute("data-index")).toBe("1");

    // One step moves one page, so the rendered page never lags the position.
    act(() => engine.next());
    expect(pageBoxes(container).map((box) => box.getAttribute("data-index"))).toEqual(["2"]);
  });

  it("renders both pages of a double spread", () => {
    const { engine, container } = renderPaged();
    act(() => engine.setMode("double"));
    act(() => engine.next());

    const boxes = pageBoxes(container);
    expect(boxes.map((box) => box.getAttribute("data-index"))).toEqual(["1", "2"]);
    expect(boxes.map((box) => box.getAttribute("data-mekuri-spread-position"))).toEqual(["0", "1"]);
    expect(boxes[0].style.flex).toBe("1 1 50%");
  });

  it("places the spread start at the start edge in RTL while the DOM keeps reading order", () => {
    const { engine, container } = renderPaged();
    const root = container.querySelector("[data-mekuri-container]") as HTMLElement;
    const row = container.querySelector("[data-mekuri-transform]") as HTMLElement;

    act(() => engine.setMode("double"));
    act(() => engine.next());
    expect(root.getAttribute("dir")).toBe("ltr");

    act(() => engine.setDirection("rtl"));

    // The row is a flex line, so declaring the direction mirrors placement
    // without touching the order assistive technology reads.
    expect(root.getAttribute("dir")).toBe("rtl");
    expect(row.style.display).toBe("flex");
    expect(pageBoxes(container).map((box) => box.getAttribute("data-index"))).toEqual(["1", "2"]);
  });

  it("exposes the reading mode to the host stylesheet", () => {
    const { engine, container } = renderPaged();
    const root = container.querySelector("[data-mekuri-container]") as HTMLElement;
    expect(root.getAttribute("data-mekuri-paged")).toBe("");
    expect(root.getAttribute("data-mode")).toBe("single");
    expect(root.getAttribute("data-direction")).toBe("ltr");
    expect(root.getAttribute("data-zoomed")).toBe("false");
    expect(root.getAttribute("data-hud-visible")).toBe("true");

    act(() => {
      engine.setZoomScale(2);
      engine.toggleHUD(false);
    });
    expect(root.getAttribute("data-zoomed")).toBe("true");
    expect(root.getAttribute("data-hud-visible")).toBe("false");
  });

  it("renders the host page body in place of the default image", () => {
    const { container } = renderPaged(
      {},
      { renderPage: (page) => <canvas data-mekuri-custom={String(page.id)} /> },
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-mekuri-custom]")).not.toBeNull();
  });

  it("renders nothing without pages", () => {
    const { container } = renderPaged({ pages: [] });
    expect(container.querySelector("[data-mekuri-container]")).toBeNull();
  });
});

describe("PagedView pipeline", () => {
  it("resolves the spread and the preload window around it", async () => {
    const requested: number[] = [];
    renderPaged({
      resolveSrc: (page) => {
        requested.push(Number(page.id));
        return `https://example.test/pages/${page.id}.jpg`;
      },
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(requested).toContain(0);
    expect(requested).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("marks a page ready once its source resolves", async () => {
    const { container } = renderPaged({
      resolveSrc: (page) => `https://example.test/pages/${page.id}.jpg`,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const box = pageBoxes(container)[0];
    expect(box.getAttribute("data-mekuri-src-state")).toBe("ready");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.test/pages/0.jpg",
    );
  });

  it("records a reported load failure for the failed page", async () => {
    const { engine, container } = renderPaged({
      resolveSrc: (page) => `https://example.test/pages/${page.id}.jpg`,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const image = container.querySelector("img") as HTMLImageElement;
    act(() => {
      fireEvent.error(image);
    });

    expect(engine.getState().failures[0]).toMatchObject({ stage: "load", attempt: 1 });
    expect(pageBoxes(container)[0].getAttribute("data-mekuri-src-state")).toBe("failed");
  });
});

describe("PagedView input wiring", () => {
  it("turns the page from the keyboard", () => {
    const { engine } = renderPaged();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(engine.getState().pageIndex).toBe(1);
  });

  it("turns the page from a tap on a zone", async () => {
    const { engine, container } = renderPaged();
    const element = surface(container);
    const restore = mockViewportDimensions(element, { width: WIDTH, height: HEIGHT });

    await act(async () => {
      await simulateTouchGesture(element, { type: "tap", at: { x: 360, y: HEIGHT / 2 } });
    });

    expect(engine.getState().pageIndex).toBe(1);
    restore();
  });

  it("writes the engine scale onto the transform target", () => {
    const { engine, container } = renderPaged();
    const target = container.querySelector("[data-mekuri-transform]") as HTMLElement;
    expect(target.style.transform).toBe("");

    act(() => engine.setZoomScale(2));
    expect(target.style.transform).toBe("matrix(2, 0, 0, 2, 0, 0)");

    act(() => engine.resetZoom());
    expect(target.style.transform).toBe("");
  });

  it("takes a host keyboard map", () => {
    const { engine } = renderPaged({}, { keyboardOptions: { map: { nextPage: ["KeyN"] } } });

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(engine.getState().pageIndex).toBe(0);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyN", bubbles: true, cancelable: true }),
      );
    });
    expect(engine.getState().pageIndex).toBe(1);
  });

  it("leaves the keyboard to the host when keyboard is false", () => {
    const { engine } = renderPaged({}, { keyboard: false });

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(engine.getState().pageIndex).toBe(0);
  });

  it("leaves gestures to the host when gestures is false", async () => {
    const { engine, container } = renderPaged({}, { gestures: false });
    const element = surface(container);

    await act(async () => {
      await simulateTouchGesture(element, { type: "tap", at: { x: 360, y: HEIGHT / 2 } });
    });

    expect(engine.getState().pageIndex).toBe(0);
  });
});

describe("PagedView host chrome", () => {
  it("renders the default HUD and drops it on request", () => {
    const withHud = renderPaged();
    expect(withHud.container.querySelector("[data-mekuri-hud]")).not.toBeNull();

    const withoutHud = renderPaged({}, { hud: false });
    expect(withoutHud.container.querySelector("[data-mekuri-hud]")).toBeNull();
  });

  it("draws the zone geometry when the host asks for it", () => {
    const { container } = renderPaged({}, { showZoneOverlay: true });
    expect(container.querySelectorAll("[data-mekuri-zone]")).toHaveLength(3);
  });

  it("holds the position and mounts the host interstitial at a chapter boundary", () => {
    let boundary: ChapterBoundary | null = null;
    const engine = createMekuriEngine({
      pages: PAGES,
      onBoundaryReached: (value) => {
        boundary = value;
      },
    });
    const { container, rerender } = render(<PagedView engine={engine} pages={PAGES} />);
    act(() => engine.goToIndex(5));

    act(() => fireEvent.click(control(container, "next") as HTMLButtonElement));

    expect(boundary).toBe("end");
    expect(engine.getState().pageIndex).toBe(5);
    expect(container.querySelector("[data-mekuri-boundary]")).toBeNull();

    // The host owns the interstitial; the view only provides the mount point.
    rerender(<PagedView engine={engine} pages={PAGES} boundarySlot={<p>Chapter complete</p>} />);
    expect(container.querySelector("[data-mekuri-boundary]")?.textContent).toBe("Chapter complete");
  });

  it("mounts nothing while the boundary slot is empty", () => {
    // An overlay that covers the surface while it holds no content takes every
    // tap, click, and double tap before the zone map can see them.
    const { container } = renderPaged({}, { boundarySlot: null });
    expect(container.querySelector("[data-mekuri-boundary]")).toBeNull();
  });

  it("lets empty-area taps reach the zone map while the boundary slot shows", async () => {
    const { engine, container } = renderPaged({}, { boundarySlot: <p>Chapter complete</p> });
    const mount = container.querySelector("[data-mekuri-boundary]") as HTMLElement;
    expect(mount.style.pointerEvents).toBe("none");

    const element = surface(container);
    const restore = mockViewportDimensions(element, { width: WIDTH, height: HEIGHT });
    await act(async () => {
      await simulateTouchGesture(element, { type: "tap", at: { x: 360, y: HEIGHT / 2 } });
    });
    expect(engine.getState().pageIndex).toBe(1);
    restore();
  });

  it("reports the start boundary without moving before the first page", () => {
    let boundary: ChapterBoundary | null = null;
    const engine = createMekuriEngine({
      pages: PAGES,
      onBoundaryReached: (value) => {
        boundary = value;
      },
    });
    const { container } = render(<PagedView engine={engine} pages={PAGES} />);

    act(() => fireEvent.click(control(container, "prev") as HTMLButtonElement));

    expect(boundary).toBe("start");
    expect(engine.getState().pageIndex).toBe(0);
  });
});
