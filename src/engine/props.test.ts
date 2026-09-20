import { describe, expect, it } from "vite-plus/test";
import { containerProps, viewportProps } from "./props";
import { createMekuriEngine } from "./store";

describe("containerProps", () => {
  it("marks the container as the positioning context that never scrolls", () => {
    const props = containerProps();
    expect(props["data-mekuri-container"]).toBe("true");
    expect(props.style).toEqual({ position: "relative", width: "100%", height: "100%" });
  });
});

describe("viewportProps", () => {
  it("keeps native vertical panning and refuses the horizontal axis in continuous modes", () => {
    for (const mode of ["continuous-webtoon", "continuous-vertical"] as const) {
      const props = viewportProps(mode, false);
      expect(props["data-mekuri-viewport"]).toBe(mode);
      expect(props.style.touchAction).toBe("pan-y");
    }
  });

  it("contains overscroll chaining and clips the horizontal axis on every viewport", () => {
    const props = viewportProps("continuous-vertical", false);
    expect(props.style.overscrollBehavior).toBe("contain");
    expect(props.style.overflowY).toBe("auto");
    expect(props.style.overflowX).toBe("hidden");
  });

  it("refuses both axes in paged modes and while zoom is locked", () => {
    expect(viewportProps("single", false).style.touchAction).toBe("none");
    expect(viewportProps("double", false).style.touchAction).toBe("none");
    expect(viewportProps("continuous-webtoon", true).style.touchAction).toBe("none");
    expect(viewportProps("continuous-vertical", true).style.touchAction).toBe("none");
  });
});

describe("engine DOM prop bindings", () => {
  it("returns one stable container record", () => {
    const engine = createMekuriEngine({ pages: [] });
    expect(engine.getContainerProps()).toBe(engine.getContainerProps());
    expect(engine.getContainerProps()["data-mekuri-container"]).toBe("true");
  });

  it("re-caches the viewport record only when mode or zoom lock changes", () => {
    const engine = createMekuriEngine({ pages: [] });
    const initial = engine.getViewportProps();
    expect(engine.getViewportProps()).toBe(initial);

    engine.setMode("continuous-webtoon");
    const webtoon = engine.getViewportProps();
    expect(webtoon).not.toBe(initial);
    expect(webtoon["data-mekuri-viewport"]).toBe("continuous-webtoon");
    expect(webtoon.style.touchAction).toBe("pan-y");
    expect(engine.getViewportProps()).toBe(webtoon);

    engine.setZoomScale(2);
    const zoomed = engine.getViewportProps();
    expect(zoomed).not.toBe(webtoon);
    expect(zoomed.style.touchAction).toBe("none");
    expect(engine.getViewportProps()).toBe(zoomed);

    engine.resetZoom();
    const restored = engine.getViewportProps();
    expect(restored["data-mekuri-viewport"]).toBe("continuous-webtoon");
    expect(restored.style.touchAction).toBe("pan-y");
    expect(engine.getViewportProps()).toBe(restored);
  });
});
