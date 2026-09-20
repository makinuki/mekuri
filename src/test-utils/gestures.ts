// Touch gesture simulator for jsdom suites. jsdom implements TouchEvent but has
// no Touch constructor, so a simulated touch point is a plain record carried
// inside a real TouchEvent; when a document does provide Touch, real instances
// are used instead. Sequences match what a platform dispatches (start, move
// steps, end) and include the synthetic click that follows a touch sequence
// unless the caller opts out.

import type { MekuriPoint } from "../engine/types";

export interface SimulatedTouchPoint extends MekuriPoint {
  id: number;
}

export interface TouchGestureSequenceOptions {
  /** Steps a drag or pinch is dispatched in. Defaults to 4. */
  steps?: number;
  /** Emit the synthetic click a platform fires after the sequence. Defaults to
   * true, which is what a host zone layer bound to clicks would observe. */
  clickAfter?: boolean;
}

export type TouchGestureOptions =
  | ({ type: "tap"; at: MekuriPoint } & TouchGestureSequenceOptions)
  | ({ type: "doubleTap"; at: MekuriPoint; gapMs?: number } & TouchGestureSequenceOptions)
  | ({ type: "pan" | "swipe"; from: MekuriPoint; to: MekuriPoint } & TouchGestureSequenceOptions)
  | ({
      type: "pinch";
      /** Midpoint between the two fingers; both start on the horizontal axis. */
      center: MekuriPoint;
      /** Initial and final distance between the fingers, in px. */
      from: number;
      to: number;
    } & TouchGestureSequenceOptions);

const DEFAULT_STEPS = 4;
const TOUCH_IDS = [1, 2] as const;

/** Lets queued event work and microtasks settle between dispatched steps. */
async function tick(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function viewOf(element: HTMLElement): Window & typeof globalThis {
  const view = element.ownerDocument.defaultView;
  if (view === null) throw new Error("simulateTouchGesture: the element has no window");
  return view as Window & typeof globalThis;
}

function touchRecord(point: SimulatedTouchPoint, target: Element): Touch {
  const view = viewOf(target as HTMLElement);
  const TouchCtor = (view as { Touch?: new (init: TouchInit) => Touch }).Touch;
  const init: TouchInit = {
    identifier: point.id,
    target,
    clientX: point.x,
    clientY: point.y,
    pageX: point.x,
    pageY: point.y,
    screenX: point.x,
    screenY: point.y,
    radiusX: 1,
    radiusY: 1,
    rotationAngle: 0,
    force: 1,
  };
  if (typeof TouchCtor === "function") return new TouchCtor(init);
  return init as unknown as Touch;
}

function dispatchTouch(
  element: HTMLElement,
  type: string,
  points: SimulatedTouchPoint[],
  changed: SimulatedTouchPoint[],
): void {
  const view = viewOf(element);
  const event = new view.TouchEvent(type, {
    touches: points.map((point) => touchRecord(point, element)),
    targetTouches: points.map((point) => touchRecord(point, element)),
    changedTouches: changed.map((point) => touchRecord(point, element)),
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
}

function dispatchClick(element: HTMLElement, at: MekuriPoint): void {
  const view = viewOf(element);
  element.dispatchEvent(
    new view.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
    }),
  );
}

function interpolate(from: MekuriPoint, to: MekuriPoint, step: number, steps: number): MekuriPoint {
  const progress = steps === 0 ? 1 : step / steps;
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}

function pinchPoints(center: MekuriPoint, span: number): SimulatedTouchPoint[] {
  const half = span / 2;
  return [
    { id: TOUCH_IDS[0], x: center.x - half, y: center.y },
    { id: TOUCH_IDS[1], x: center.x + half, y: center.y },
  ];
}

async function tapOnce(element: HTMLElement, at: MekuriPoint, clickAfter: boolean): Promise<void> {
  const point: SimulatedTouchPoint = { id: TOUCH_IDS[0], x: at.x, y: at.y };
  dispatchTouch(element, "touchstart", [point], [point]);
  await tick();
  dispatchTouch(element, "touchend", [], [point]);
  await tick();
  if (clickAfter) dispatchClick(element, at);
}

async function drag(
  element: HTMLElement,
  from: MekuriPoint,
  to: MekuriPoint,
  steps: number,
  clickAfter: boolean,
): Promise<void> {
  const start: SimulatedTouchPoint = { id: TOUCH_IDS[0], x: from.x, y: from.y };
  dispatchTouch(element, "touchstart", [start], [start]);
  await tick();
  for (let step = 1; step <= steps; step += 1) {
    const at = interpolate(from, to, step, steps);
    const point: SimulatedTouchPoint = { id: TOUCH_IDS[0], x: at.x, y: at.y };
    dispatchTouch(element, "touchmove", [point], [point]);
    await tick();
  }
  const end: SimulatedTouchPoint = { id: TOUCH_IDS[0], x: to.x, y: to.y };
  dispatchTouch(element, "touchend", [], [end]);
  await tick();
  if (clickAfter) dispatchClick(element, to);
}

async function pinch(
  element: HTMLElement,
  center: MekuriPoint,
  from: number,
  to: number,
  steps: number,
  clickAfter: boolean,
): Promise<void> {
  const start = pinchPoints(center, from);
  dispatchTouch(element, "touchstart", start, start);
  await tick();
  for (let step = 1; step <= steps; step += 1) {
    const span = from + (to - from) * (step / steps);
    const points = pinchPoints(center, span);
    dispatchTouch(element, "touchmove", points, points);
    await tick();
  }
  const end = pinchPoints(center, to);
  dispatchTouch(element, "touchend", [], end);
  await tick();
  if (clickAfter) dispatchClick(element, center);
}

/** Dispatches one touch gesture on an element and waits for it to settle. */
export async function simulateTouchGesture(
  element: HTMLElement,
  gesture: TouchGestureOptions,
): Promise<void> {
  const steps = gesture.steps ?? DEFAULT_STEPS;
  const clickAfter = gesture.clickAfter ?? true;
  switch (gesture.type) {
    case "tap":
      await tapOnce(element, gesture.at, clickAfter);
      return;
    case "doubleTap": {
      await tapOnce(element, gesture.at, clickAfter);
      if (gesture.gapMs !== undefined && gesture.gapMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, gesture.gapMs);
        });
      }
      await tapOnce(element, gesture.at, clickAfter);
      return;
    }
    case "pan":
    case "swipe":
      await drag(element, gesture.from, gesture.to, steps, clickAfter);
      return;
    case "pinch":
      await pinch(element, gesture.center, gesture.from, gesture.to, steps, clickAfter);
      return;
  }
}
