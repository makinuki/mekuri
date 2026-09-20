// Touch and pointer gesture controller for a reading surface. The controller
// owns the gesture state machine (tap, double tap, swipe, pan, pinch) and the
// zoom matrix it writes to the transform target; the engine owns the discrete
// state the controller dispatches into. It attaches to DOM nodes but keeps no
// framework state, so a host may drive it from any renderer or from plain
// script.
//
// Contract:
// - A tap dispatches its zone action immediately. Nothing waits on a double-tap
//   timer, so a center-zone HUD toggle never inherits the platform click delay.
//   Two taps inside the double-tap window are one double tap: the second tap
//   zooms in, or resets the zoom while zoomed, instead of dispatching its zone
//   action a second time.
// - While the scale exceeds 1 the surface is locked: taps reach no zone and
//   swipes turn no page, and a one-finger drag pans inside the clamped matrix.
//   Navigation re-engages the moment the scale returns to 1, which a double tap
//   reaches from any zoom level.
// - A gesture this controller dispatches from also consumes the synthetic click
//   the platform emits afterwards, so a host zone layer bound to clicks cannot
//   act twice on one gesture.
// - Element geometry is read while a gesture is in flight, never at import
//   time, so importing the engine stays safe without a DOM.

import {
  clampPan,
  matrixToCss,
  panForPinch,
  panForZoom,
  zoomMatrix,
  type MekuriPanBounds,
} from "./matrix";
import type { MekuriEngine } from "./store";
import type { MekuriPoint, MekuriZoneAction } from "./types";
import { hitTestZone, normalizePoint, resolveZoneAction, swipePageAction } from "./zones";

export interface MekuriGestureOptions {
  engine: MekuriEngine;
  /** Element that receives the touch and pointer stream. */
  element: HTMLElement;
  /** Element the zoom matrix is applied to. Defaults to the element above. */
  transformTarget?: HTMLElement;
  /** Scale a double tap zooms to. Defaults to 2, clamped by the engine bounds. */
  doubleTapScale?: number;
  /** Longest gap between the two taps of a double tap, in ms. Defaults to 300. */
  doubleTapMs?: number;
  /** Largest movement that still counts as a tap, in px. Defaults to 12. */
  tapSlopPx?: number;
  /** Smallest horizontal drag that turns a page, in px. Defaults to 40. */
  swipeThresholdPx?: number;
  /** How long a dispatched gesture keeps consuming clicks, in ms. Defaults to
   * 500, which covers the synthetic click a platform emits after a touch. */
  clickSuppressionMs?: number;
  /** Gesture clock. Defaults to Date.now; injectable for deterministic tests. */
  now?: () => number;
}

/** Transform currently applied to the target element. */
export interface MekuriZoomTransform {
  scale: number;
  pan: MekuriPoint;
}

export interface MekuriGestureController {
  /** Removes every listener and clears the transform it applied. */
  detach(): void;
  getTransform(): MekuriZoomTransform;
  /** Re-applies the engine scale to the target; safe to call at any time. */
  sync(): void;
}

const DEFAULT_DOUBLE_TAP_SCALE = 2;
const DEFAULT_DOUBLE_TAP_MS = 300;
const DEFAULT_TAP_SLOP_PX = 12;
const DEFAULT_SWIPE_THRESHOLD_PX = 40;
const DEFAULT_CLICK_SUPPRESSION_MS = 500;
const ZERO_PAN: MekuriPoint = { x: 0, y: 0 };

type GesturePhase = "idle" | "drag" | "pinch";

interface TouchPointRecord {
  id: number;
  x: number;
  y: number;
}

interface PinchStart {
  span: number;
  scale: number;
  pan: MekuriPoint;
  mid: MekuriPoint;
}

export function attachGestures(options: MekuriGestureOptions): MekuriGestureController {
  const { engine, element } = options;
  const transformTarget = options.transformTarget ?? element;
  const doc = element.ownerDocument;
  const doubleTapScale = Math.max(1, options.doubleTapScale ?? DEFAULT_DOUBLE_TAP_SCALE);
  const doubleTapMs = options.doubleTapMs ?? DEFAULT_DOUBLE_TAP_MS;
  const tapSlopPx = options.tapSlopPx ?? DEFAULT_TAP_SLOP_PX;
  const swipeThresholdPx = options.swipeThresholdPx ?? DEFAULT_SWIPE_THRESHOLD_PX;
  const clickSuppressionMs = options.clickSuppressionMs ?? DEFAULT_CLICK_SUPPRESSION_MS;
  const clock = options.now ?? ((): number => Date.now());

  const touches = new Map<number, TouchPointRecord>();
  let phase: GesturePhase = "idle";
  let dragStart: MekuriPoint | null = null;
  let dragLast: MekuriPoint | null = null;
  let dragMovement = 0;
  let pinchStart: PinchStart | null = null;
  let lastTap: { point: MekuriPoint; time: number } | null = null;
  let mousePointerId: number | null = null;
  let suppressClickUntil = 0;
  let detached = false;

  // Transform on screen. The engine holds the discrete scale; the pan and the
  // animating scale live here, because only the layer that writes the matrix
  // can read the geometry the clamp needs.
  let scale = 1;
  let pan: MekuriPoint = ZERO_PAN;

  function bounds(): MekuriPanBounds {
    return {
      contentWidth: transformTarget.offsetWidth,
      contentHeight: transformTarget.offsetHeight,
      viewportWidth: element.clientWidth,
      viewportHeight: element.clientHeight,
    };
  }

  function viewportCenter(): MekuriPoint {
    return { x: element.clientWidth / 2, y: element.clientHeight / 2 };
  }

  /** Writes the matrix for a scale and pan pair. At scale 1 the inline
   * transform is removed outright, so an unzoomed continuous column keeps the
   * transform-free layout it was measured in. */
  function writeTransform(nextScale: number, nextPan: MekuriPoint): void {
    if (!(nextScale > 1)) {
      scale = 1;
      pan = ZERO_PAN;
      transformTarget.style.transform = "";
      transformTarget.style.transformOrigin = "";
      return;
    }
    scale = nextScale;
    pan = clampPan(nextPan, bounds(), nextScale);
    transformTarget.style.transformOrigin = "0 0";
    transformTarget.style.transform = matrixToCss(zoomMatrix(nextScale, pan));
  }

  /** Re-applies the engine scale when it differs from the transform on screen.
   * Host zoom actions land here through the subscription. */
  function reconcile(): void {
    const target = engine.getState().zoomScale;
    if (target === scale) return;
    if (target <= 1) {
      writeTransform(1, ZERO_PAN);
      return;
    }
    writeTransform(target, panForZoom(target, scale, pan, viewportCenter()));
  }

  /** Pushes a scale into the engine and lets the accepted value win, so an
   * engine-side clamp is what the user sees. */
  function commitZoom(nextScale: number): void {
    if (nextScale <= 1 || engine.getZoomBounds().max <= 1) {
      engine.resetZoom();
      writeTransform(1, ZERO_PAN);
      return;
    }
    engine.setZoomScale(nextScale);
    reconcile();
  }

  /** Zooms about an anchor, keeping the content point under it in place. */
  function zoomAbout(nextScale: number, anchor: MekuriPoint): void {
    const bounded = Math.min(engine.getZoomBounds().max, Math.max(1, nextScale));
    writeTransform(bounded, panForZoom(bounded, scale, pan, anchor));
    commitZoom(bounded);
  }

  function resetZoom(): void {
    engine.resetZoom();
    writeTransform(1, ZERO_PAN);
  }

  function dispatchAction(action: MekuriZoneAction): void {
    if (action === "next") engine.next();
    else if (action === "prev") engine.prev();
    else if (action === "toggleHUD") engine.toggleHUD();
  }

  function dispatchZone(point: MekuriPoint): void {
    const state = engine.getState();
    if (state.isZoomLocked) return;
    const normalized = normalizePoint(point, element.getBoundingClientRect());
    const zone = hitTestZone(state.activeZoneMap, normalized);
    if (zone === undefined) return;
    dispatchAction(resolveZoneAction(zone.action, state.direction));
  }

  function isPagedMode(): boolean {
    const mode = engine.getState().mode;
    return mode === "single" || mode === "double";
  }

  /** Arms the click guard. Called by every gesture the controller dispatches
   * from, so the platform click that follows cannot reach a host zone layer. */
  function consumeClick(): void {
    suppressClickUntil = clock() + clickSuppressionMs;
  }

  function readPoints(list: TouchList): TouchPointRecord[] {
    const points: TouchPointRecord[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const touch: Touch | undefined = list[index];
      if (touch === undefined) continue;
      points.push({ id: touch.identifier, x: touch.clientX, y: touch.clientY });
    }
    return points;
  }

  function firstTouch(): TouchPointRecord | null {
    const iterator = touches.values().next();
    return iterator.done === true ? null : iterator.value;
  }

  function beginDrag(point: TouchPointRecord): void {
    phase = "drag";
    pinchStart = null;
    dragStart = { x: point.x, y: point.y };
    dragLast = { x: point.x, y: point.y };
    dragMovement = 0;
  }

  function beginPinch(): void {
    const points = [...touches.values()].slice(0, 2);
    const first = points[0];
    const second = points[1];
    if (first === undefined || second === undefined) return;
    phase = "pinch";
    dragStart = null;
    dragLast = null;
    pinchStart = {
      span: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      scale,
      pan,
      mid: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    };
  }

  function updatePinch(): void {
    if (pinchStart === null) return;
    const points = [...touches.values()].slice(0, 2);
    const first = points[0];
    const second = points[1];
    if (first === undefined || second === undefined) return;
    const span = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
    const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const next = Math.min(
      engine.getZoomBounds().max,
      Math.max(1, pinchStart.scale * (span / pinchStart.span)),
    );
    writeTransform(next, panForPinch(next, pinchStart.scale, pinchStart.pan, pinchStart.mid, mid));
  }

  function endPinch(): void {
    pinchStart = null;
    phase = "idle";
    commitZoom(scale);
    consumeClick();
  }

  function handleTap(point: MekuriPoint): void {
    const time = clock();
    const previous = lastTap;
    lastTap = { point, time };
    consumeClick();
    if (
      previous !== null &&
      time - previous.time <= doubleTapMs &&
      Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= tapSlopPx
    ) {
      lastTap = null;
      if (scale > 1) resetZoom();
      else zoomAbout(doubleTapScale, point);
      return;
    }
    dispatchZone(point);
  }

  function finishDrag(end: MekuriPoint | null): void {
    const start = dragStart;
    dragStart = null;
    dragLast = null;
    phase = "idle";
    if (start === null || end === null) return;

    if (dragMovement <= tapSlopPx) {
      handleTap(end);
      return;
    }
    // A drag on a locked surface was panning, and a drag in a continuous mode
    // belongs to the native scroll the viewport contract already grants.
    if (scale <= 1 && isPagedMode()) {
      const action = swipePageAction(
        end.x - start.x,
        engine.getState().direction,
        swipeThresholdPx,
      );
      if (action !== null) dispatchAction(action);
    }
    consumeClick();
  }

  function onTouchStart(event: TouchEvent): void {
    if (detached) return;
    for (const point of readPoints(event.touches)) touches.set(point.id, point);
    if (touches.size === 0) return;
    if (touches.size === 1) {
      const point = firstTouch();
      if (point !== null) beginDrag(point);
      return;
    }
    beginPinch();
  }

  function onTouchMove(event: TouchEvent): void {
    if (detached) return;
    for (const point of readPoints(event.touches)) {
      if (touches.has(point.id)) touches.set(point.id, point);
    }
    if (phase === "pinch") {
      // The element refuses native panning through touch-action; refusing the
      // platform pinch keeps the matrix the single zoom authority.
      if (event.cancelable) event.preventDefault();
      updatePinch();
      return;
    }
    if (phase !== "drag") return;
    const point = firstTouch();
    if (point === null || dragStart === null || dragLast === null) return;
    dragMovement = Math.max(dragMovement, Math.hypot(point.x - dragStart.x, point.y - dragStart.y));
    if (scale > 1) {
      if (event.cancelable) event.preventDefault();
      writeTransform(scale, {
        x: pan.x + (point.x - dragLast.x),
        y: pan.y + (point.y - dragLast.y),
      });
    }
    dragLast = { x: point.x, y: point.y };
  }

  function onTouchEnd(event: TouchEvent): void {
    if (detached) return;
    const changed = readPoints(event.changedTouches);
    for (const point of changed) touches.delete(point.id);

    if (phase === "pinch") {
      if (touches.size >= 2) return;
      endPinch();
      if (touches.size === 1) {
        const point = firstTouch();
        if (point !== null) beginDrag(point);
      }
      return;
    }
    if (phase === "drag" && touches.size === 0) {
      const last = changed[changed.length - 1] ?? null;
      finishDrag(last === null ? null : { x: last.x, y: last.y });
    }
  }

  function onTouchCancel(event: TouchEvent): void {
    for (const point of readPoints(event.changedTouches)) touches.delete(point.id);
    if (touches.size > 0) return;
    phase = "idle";
    dragStart = null;
    dragLast = null;
    pinchStart = null;
  }

  // Pointer events carry the mouse: a desktop drag pans a zoomed surface, while
  // taps and clicks stay with the host zone layer.
  function onPointerDown(event: PointerEvent): void {
    if (detached || event.pointerType === "touch" || event.button !== 0) return;
    mousePointerId = event.pointerId;
    phase = "drag";
    dragStart = { x: event.clientX, y: event.clientY };
    dragLast = { x: event.clientX, y: event.clientY };
    dragMovement = 0;
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== mousePointerId) return;
    if (dragStart === null || dragLast === null) return;
    dragMovement = Math.max(
      dragMovement,
      Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y),
    );
    if (scale > 1) {
      writeTransform(scale, {
        x: pan.x + (event.clientX - dragLast.x),
        y: pan.y + (event.clientY - dragLast.y),
      });
    }
    dragLast = { x: event.clientX, y: event.clientY };
  }

  function endPointerDrag(consumesClick: boolean): void {
    const moved = dragMovement;
    mousePointerId = null;
    phase = "idle";
    dragStart = null;
    dragLast = null;
    if (consumesClick && moved > tapSlopPx) consumeClick();
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== mousePointerId) return;
    endPointerDrag(true);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== mousePointerId) return;
    endPointerDrag(false);
  }

  /** Capture-phase guard on the document: a dispatched gesture swallows the
   * click the platform emits next, before any host zone handler can see it. */
  function onDocumentClick(event: Event): void {
    if (suppressClickUntil === 0) return;
    if (clock() > suppressClickUntil) {
      suppressClickUntil = 0;
      return;
    }
    const target = event.target;
    if (target === null || !element.contains(target as Node)) return;
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  element.addEventListener("touchstart", onTouchStart, { passive: true });
  element.addEventListener("touchmove", onTouchMove, { passive: false });
  element.addEventListener("touchend", onTouchEnd, { passive: true });
  element.addEventListener("touchcancel", onTouchCancel, { passive: true });
  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerCancel);
  doc.addEventListener("click", onDocumentClick, true);
  const unsubscribe = engine.subscribe(reconcile);

  return {
    detach: () => {
      detached = true;
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchCancel);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerCancel);
      doc.removeEventListener("click", onDocumentClick, true);
      unsubscribe();
      touches.clear();
      phase = "idle";
      dragStart = null;
      dragLast = null;
      pinchStart = null;
      mousePointerId = null;
      transformTarget.style.transform = "";
      transformTarget.style.transformOrigin = "";
    },
    getTransform: () => ({ scale, pan: { x: pan.x, y: pan.y } }),
    sync: reconcile,
  };
}
