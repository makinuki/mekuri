// WebtoonView tests compose the continuous surface with the reader chrome. The
// virtualized column needs geometry, so the harness installs the same doubles
// the continuous view suite uses and drives measurements itself.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { WebtoonView, type WebtoonViewProps } from "./webtoon";
import { createMekuriEngine, type MekuriEngine, type MekuriEngineOptions } from "../engine/store";
import type { MekuriPage } from "../engine/types";
import { mockResizeObserver, type MockResizeObserverHandle } from "../test-utils/observers";
import { mockScrollGeometry } from "../test-utils/viewport";

const VIEWPORT_HEIGHT = 600;
const PAGE_HEIGHT = 1000;

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    metadata: { src: `https://example.test/pages/${index}.jpg` },
  }));
}

const PAGES = pages(6);

let geometry: { resize: MockResizeObserverHandle; restore(): void } | null = null;

function mountGeometry(): MockResizeObserverHandle {
  const restoreGeometry = mockScrollGeometry({
    viewportHeight: VIEWPORT_HEIGHT,
    pageHeight: PAGE_HEIGHT,
  });
  const resize = mockResizeObserver();
  geometry = {
    resize,
    restore() {
      resize.restore();
      restoreGeometry();
    },
  };
  return resize;
}

function measure(resize: MockResizeObserverHandle, height = PAGE_HEIGHT): void {
  act(() => {
    resize.fireAll(() => height);
  });
}

afterEach(() => {
  cleanup();
  geometry?.restore();
  geometry = null;
});

interface Harness {
  engine: MekuriEngine;
  container: HTMLElement;
}

function renderWebtoon(
  engineOptions: Partial<MekuriEngineOptions> = {},
  props: Partial<WebtoonViewProps> = {},
): Harness {
  const viewPages = engineOptions.pages ?? PAGES;
  const engine = createMekuriEngine({
    pages: viewPages,
    initialState: { mode: "continuous-webtoon" },
    ...engineOptions,
  });
  const { container } = render(<WebtoonView engine={engine} pages={viewPages} {...props} />);
  return { engine, container };
}

describe("WebtoonView composition", () => {
  it("renders the continuous column with the reader chrome", () => {
    const resize = mountGeometry();
    const { container } = renderWebtoon();
    measure(resize);

    expect(container.querySelector("[data-mekuri-column]")).not.toBeNull();
    expect(container.querySelectorAll("[data-mekuri-page]").length).toBeGreaterThan(0);
    expect(container.querySelector("[data-mekuri-hud]")).not.toBeNull();
    expect(container.querySelector("[data-mekuri-status]")?.textContent).toBe("Page 1 of 6");
  });

  it("wraps the column without nesting a second reading container", () => {
    mountGeometry();
    const { container } = renderWebtoon();

    const view = container.querySelector("[data-mekuri-view]");
    expect(view?.getAttribute("data-mode")).toBe("continuous-webtoon");
    expect(view?.getAttribute("data-direction")).toBe("ltr");
    expect(container.querySelectorAll("[data-mekuri-container]")).toHaveLength(1);
  });

  it("turns the page from the keyboard", () => {
    mountGeometry();
    const { engine } = renderWebtoon();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });

    expect(engine.getState().pageIndex).toBe(1);
  });

  it("renders host children at the boundary mount point", () => {
    mountGeometry();
    const { container } = renderWebtoon({}, { boundarySlot: <p>Chapter complete</p> });
    expect(container.querySelector("[data-mekuri-boundary]")?.textContent).toBe("Chapter complete");
  });

  it("mounts nothing while the boundary slot is empty", () => {
    mountGeometry();
    const { container } = renderWebtoon({}, { boundarySlot: null });
    expect(container.querySelector("[data-mekuri-boundary]")).toBeNull();
  });

  it("draws the zone geometry and drops the HUD on request", () => {
    mountGeometry();
    const overlay = renderWebtoon({}, { showZoneOverlay: true });
    expect(overlay.container.querySelectorAll("[data-mekuri-zone]")).toHaveLength(3);

    const bare = renderWebtoon({}, { hud: false });
    expect(bare.container.querySelector("[data-mekuri-hud]")).toBeNull();
  });

  it("renders nothing without pages", () => {
    mountGeometry();
    const { container } = renderWebtoon({ pages: [] });
    expect(container.querySelector("[data-mekuri-view]")).toBeNull();
  });
});
