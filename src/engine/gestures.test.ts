// Gesture tests drive the controller through the touch simulator, which
// dispatches real TouchEvent sequences against a geometry double: jsdom has no
// layout, so element size and rect come from mockViewportDimensions and gesture
// timing from the injected clock.
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  attachGestures,
  type MekuriGestureController,
  type MekuriGestureOptions,
} from "./gestures";
import { createMekuriEngine, type MekuriEngineOptions } from "./store";
import type { MekuriPage, MekuriPoint } from "./types";
import { DISABLED_ZONE_MAP, EDGE_ONLY_ZONE_MAP } from "./zones";
import { simulateTouchGesture } from "../test-utils/gestures";
import { mockViewportDimensions } from "../test-utils/viewport";

const WIDTH = 400;
const HEIGHT = 600;
const CENTER: MekuriPoint = { x: WIDTH / 2, y: HEIGHT / 2 };
const LEFT: MekuriPoint = { x: 40, y: HEIGHT / 2 };
const RIGHT: MekuriPoint = { x: 360, y: HEIGHT / 2 };

interface Harness {
  engine: ReturnType<typeof createMekuriEngine>;
  controller: MekuriGestureController;
  element: HTMLElement;
  target: HTMLElement;
  clock: { time: number };
  restore(): void;
}

let active: Harness | null = null;

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

function harness(
  engineOptions: Partial<MekuriEngineOptions> = {},
  gestureOptions: Partial<MekuriGestureOptions> = {},
): Harness {
  const element = document.createElement("div");
  const target = document.createElement("div");
  element.appendChild(target);
  document.body.appendChild(element);

  const clock = { time: 0 };
  const restoreElement = mockViewportDimensions(element, { width: WIDTH, height: HEIGHT });
  const restoreTarget = mockViewportDimensions(target, { width: WIDTH, height: HEIGHT });
  const engine = createMekuriEngine({ pages: pages(6), ...engineOptions });
  const controller = attachGestures({
    engine,
    element,
    transformTarget: target,
    now: () => clock.time,
    ...gestureOptions,
  });

  const instance: Harness = {
    engine,
    controller,
    element,
    target,
    clock,
    restore() {
      controller.detach();
      restoreTarget();
      restoreElement();
      element.remove();
    },
  };
  active = instance;
  return instance;
}

afterEach(() => {
  active?.restore();
  active = null;
});

/** Advances the clock so the gesture cannot pair with the previous one. */
async function tapAt(h: Harness, at: MekuriPoint): Promise<void> {
  h.clock.time += 1000;
  await simulateTouchGesture(h.element, { type: "tap", at });
}

async function doubleTapAt(h: Harness, at: MekuriPoint): Promise<void> {
  h.clock.time += 1000;
  await simulateTouchGesture(h.element, { type: "doubleTap", at });
}

function clickOn(element: HTMLElement): void {
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }),
  );
}

function collectClicks(element: HTMLElement): MouseEvent[] {
  const clicks: MouseEvent[] = [];
  element.addEventListener("click", (event) => clicks.push(event as MouseEvent));
  return clicks;
}

function mouseDrag(h: Harness, fromX: number, toX: number, y = HEIGHT / 2): void {
  const init = {
    bubbles: true,
    cancelable: true,
    pointerType: "mouse",
    pointerId: 7,
    button: 0,
    clientY: y,
  };
  h.element.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: fromX }));
  h.element.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: toX }));
  h.element.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: toX }));
}

describe("tap dispatch", () => {
  it("toggles the HUD on a tap without waiting on a double-tap timer", async () => {
    const h = harness();
    expect(h.engine.getState().isHUDVisible).toBe(true);

    await simulateTouchGesture(h.element, { type: "tap", at: CENTER });

    expect(h.engine.getState().isHUDVisible).toBe(false);
    // The injected clock never moved, so nothing was deferred to disambiguate
    // the tap from a double tap.
    expect(h.clock.time).toBe(0);
  });

  it("turns pages from the side zones in reading order", async () => {
    const h = harness();

    await tapAt(h, RIGHT);
    expect(h.engine.getState().pageIndex).toBe(1);
    await tapAt(h, LEFT);
    expect(h.engine.getState().pageIndex).toBe(0);

    // RTL reads the same geometry in reverse reading order.
    h.engine.setDirection("rtl");
    await tapAt(h, LEFT);
    expect(h.engine.getState().pageIndex).toBe(1);
    await tapAt(h, RIGHT);
    expect(h.engine.getState().pageIndex).toBe(0);
  });

  it("leaves a tap in a zone gap inert", async () => {
    const h = harness({ zoneMap: EDGE_ONLY_ZONE_MAP });
    const hud = h.engine.getState().isHUDVisible;

    await simulateTouchGesture(h.element, { type: "tap", at: CENTER });

    expect(h.engine.getState().isHUDVisible).toBe(hud);
    expect(h.engine.getState().pageIndex).toBe(0);
  });

  it("dispatches nothing with the disabled preset", async () => {
    const h = harness({ zoneMap: DISABLED_ZONE_MAP });

    await simulateTouchGesture(h.element, { type: "tap", at: RIGHT });
    await simulateTouchGesture(h.element, { type: "tap", at: CENTER });

    expect(h.engine.getState().pageIndex).toBe(0);
    expect(h.engine.getState().isHUDVisible).toBe(true);
  });
});

describe("zoom locking", () => {
  it("keeps the reset reachable by double tap while zoomed and locks the zones", async () => {
    const h = harness();

    await doubleTapAt(h, CENTER);
    expect(h.engine.getState().zoomScale).toBe(2);
    expect(h.controller.getTransform().scale).toBe(2);
    expect(h.target.style.transform).toContain("matrix(");

    // Locked: a center tap no longer toggles the HUD and a side tap no longer
    // turns the page.
    const hud = h.engine.getState().isHUDVisible;
    await tapAt(h, CENTER);
    expect(h.engine.getState().isHUDVisible).toBe(hud);
    await tapAt(h, RIGHT);
    expect(h.engine.getState().pageIndex).toBe(0);

    // The reset stays reachable from the locked state.
    await doubleTapAt(h, CENTER);
    expect(h.engine.getState().zoomScale).toBe(1);
    expect(h.controller.getTransform()).toEqual({ scale: 1, pan: { x: 0, y: 0 } });
    expect(h.target.style.transform).toBe("");

    // Navigation re-engages once the scale is back at 1.
    await tapAt(h, RIGHT);
    expect(h.engine.getState().pageIndex).toBe(1);
  });

  it("honors the engine zoom bounds on a double tap", async () => {
    const h = harness({ maxZoomScale: 1.5 }, { doubleTapScale: 3 });

    await doubleTapAt(h, CENTER);

    expect(h.engine.getState().zoomScale).toBe(1.5);
    expect(h.controller.getTransform().scale).toBe(1.5);
  });

  it("leaves the surface unzoomed when the engine disables zoom", async () => {
    const h = harness({ maxZoomScale: 1 });

    await doubleTapAt(h, CENTER);

    expect(h.engine.getState().zoomScale).toBe(1);
    expect(h.target.style.transform).toBe("");
  });

  it("follows host zoom actions and clears the transform on reset", async () => {
    const h = harness();

    h.engine.setZoomScale(3);
    expect(h.controller.getTransform()).toEqual({ scale: 3, pan: { x: -400, y: -600 } });
    expect(h.target.style.transform).toContain("matrix(3");
    expect(h.target.style.transformOrigin).toBe("0 0");

    h.engine.resetZoom();
    expect(h.controller.getTransform()).toEqual({ scale: 1, pan: { x: 0, y: 0 } });
    expect(h.target.style.transform).toBe("");
    expect(h.target.style.transformOrigin).toBe("");
  });

  it("stops listening once detached", async () => {
    const h = harness();
    h.engine.setZoomScale(2);
    expect(h.target.style.transform).not.toBe("");

    h.controller.detach();
    h.engine.resetZoom();

    expect(h.target.style.transform).toBe("");
    const hud = h.engine.getState().isHUDVisible;
    await simulateTouchGesture(h.element, { type: "tap", at: CENTER });
    expect(h.engine.getState().isHUDVisible).toBe(hud);
    expect(h.engine.getState().pageIndex).toBe(0);
  });
});

describe("pan and pinch", () => {
  it("never turns a page while a pan drags a zoomed surface", async () => {
    const h = harness();
    h.engine.setZoomScale(2);

    await simulateTouchGesture(h.element, {
      type: "pan",
      from: { x: 340, y: 300 },
      to: { x: 40, y: 300 },
    });

    expect(h.engine.getState().pageIndex).toBe(0);
    expect(h.controller.getTransform().pan.x).toBeLessThan(-200);
  });

  it("clamps panning to the scaled content edges", async () => {
    const h = harness();
    h.engine.setZoomScale(2);
    expect(h.controller.getTransform().pan).toEqual({ x: -200, y: -300 });

    await simulateTouchGesture(h.element, {
      type: "pan",
      from: { x: 200, y: 300 },
      to: { x: 3000, y: 300 },
    });
    expect(h.controller.getTransform().pan.x).toBe(0);

    await simulateTouchGesture(h.element, {
      type: "pan",
      from: { x: 200, y: 300 },
      to: { x: -3000, y: 300 },
    });
    expect(h.controller.getTransform().pan.x).toBe(-WIDTH);
  });

  it("pinches to the finger span and commits the scale to the engine", async () => {
    const h = harness();

    await simulateTouchGesture(h.element, { type: "pinch", center: CENTER, from: 100, to: 250 });

    expect(h.controller.getTransform().scale).toBeCloseTo(2.5);
    expect(h.engine.getState().zoomScale).toBeCloseTo(2.5);
    expect(h.engine.getState().isZoomLocked).toBe(true);
    expect(h.target.style.transform).toContain("matrix(");
  });

  it("returns to the unzoomed transform when a pinch falls back to scale 1", async () => {
    const h = harness();
    h.engine.setZoomScale(3);
    expect(h.target.style.transform).not.toBe("");

    await simulateTouchGesture(h.element, { type: "pinch", center: CENTER, from: 300, to: 60 });

    expect(h.controller.getTransform()).toEqual({ scale: 1, pan: { x: 0, y: 0 } });
    expect(h.engine.getState().zoomScale).toBe(1);
    expect(h.target.style.transform).toBe("");
  });
});

describe("swipes", () => {
  it("turns exactly one page when a swipe ends inside a side zone", async () => {
    const h = harness();
    const clicks = collectClicks(h.element);

    await simulateTouchGesture(h.element, {
      type: "swipe",
      from: { x: 320, y: 300 },
      to: { x: 20, y: 300 },
    });

    expect(h.engine.getState().pageIndex).toBe(1);
    expect(clicks).toHaveLength(0);

    h.clock.time += 1000;
    await simulateTouchGesture(h.element, {
      type: "swipe",
      from: { x: 20, y: 300 },
      to: { x: 320, y: 300 },
    });

    expect(h.engine.getState().pageIndex).toBe(0);
    expect(clicks).toHaveLength(0);
  });

  it("reads a touch that moved inside the tap slop as a tap", async () => {
    const h = harness();

    await simulateTouchGesture(h.element, {
      type: "swipe",
      from: { x: 200, y: 300 },
      to: { x: 208, y: 300 },
    });

    // The 8 px jitter lands in the center zone, so the tap still dispatches.
    expect(h.engine.getState().isHUDVisible).toBe(false);
    expect(h.engine.getState().pageIndex).toBe(0);
  });

  it("turns nothing when a drag clears the slop but not the swipe threshold", async () => {
    const h = harness();
    const hud = h.engine.getState().isHUDVisible;

    await simulateTouchGesture(h.element, {
      type: "swipe",
      from: { x: 200, y: 300 },
      to: { x: 170, y: 300 },
    });

    expect(h.engine.getState().pageIndex).toBe(0);
    expect(h.engine.getState().isHUDVisible).toBe(hud);
  });

  it("leaves a drag in a continuous mode to the native scroll", async () => {
    const h = harness({ initialState: { mode: "continuous-vertical" } });

    await simulateTouchGesture(h.element, {
      type: "swipe",
      from: { x: 320, y: 300 },
      to: { x: 20, y: 300 },
    });

    expect(h.engine.getState().pageIndex).toBe(0);
  });
});

describe("ghost-click suppression", () => {
  it("consumes the click a dispatched gesture emits and lets a later one through", async () => {
    const h = harness();
    const clicks = collectClicks(h.element);

    await simulateTouchGesture(h.element, { type: "tap", at: CENTER, clickAfter: false });
    clickOn(h.element);
    expect(clicks).toHaveLength(0);

    clickOn(h.element);
    expect(clicks).toHaveLength(1);

    h.clock.time += 10_000;
    clickOn(h.element);
    expect(clicks).toHaveLength(2);
  });

  it("swallows the trailing click the simulator emits after a gesture", async () => {
    const h = harness();
    const clicks = collectClicks(h.element);

    await simulateTouchGesture(h.element, { type: "tap", at: CENTER });

    expect(clicks).toHaveLength(0);
  });

  it("swallows the click that follows a pinch", async () => {
    const h = harness();
    const clicks = collectClicks(h.element);

    await simulateTouchGesture(h.element, { type: "pinch", center: CENTER, from: 100, to: 200 });

    expect(clicks).toHaveLength(0);
  });
});

describe("pointer input", () => {
  it("pans on a mouse drag and consumes the click that follows it", async () => {
    const h = harness();
    h.engine.setZoomScale(2);
    const clicks = collectClicks(h.element);

    mouseDrag(h, 340, 40);

    expect(h.engine.getState().pageIndex).toBe(0);
    expect(h.controller.getTransform().pan.x).toBeLessThan(-200);
    clickOn(h.element);
    expect(clicks).toHaveLength(0);
  });

  it("leaves a mouse click that carried no drag to the host zone layer", async () => {
    const h = harness();
    h.engine.setZoomScale(2);
    const clicks = collectClicks(h.element);

    mouseDrag(h, 200, 200);
    clickOn(h.element);

    expect(clicks).toHaveLength(1);
    expect(h.controller.getTransform().pan).toEqual({ x: -200, y: -300 });
  });

  it("ignores a pointer event that belongs to touch", async () => {
    const h = harness();
    h.engine.setZoomScale(2);
    const init = {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 2,
      button: 0,
      clientY: 300,
    };

    for (const type of ["pointerdown", "pointermove", "pointerup"]) {
      h.element.dispatchEvent(new PointerEvent(type, { ...init, clientX: 40 }));
    }

    expect(h.controller.getTransform().pan).toEqual({ x: -200, y: -300 });
  });
});
