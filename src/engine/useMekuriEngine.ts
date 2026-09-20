// React binding for the vanilla engine store. The hook owns no logic: it
// reconciles host-controlled state during render, subscribes via
// useSyncExternalStore (SSR-safe through the server snapshot), and forwards
// actions. All behavior lives in store.ts.
import { useMemo, useRef, useSyncExternalStore, type HTMLAttributes } from "react";
import { createMekuriEngine, type MekuriEngineOptions, type MekuriZoomBounds } from "./store";
import type { MekuriPageRequest } from "./pipeline";
import type { MekuriReadingPosition } from "./scroll";
import type { MekuriDirection, MekuriKeyboardMap, MekuriMode, MekuriState } from "./types";

export interface MekuriEngineOutput {
  state: MekuriState;

  /** Imperative state access with the same shape as the vanilla store, for
   * layers that only hold the hook output. */
  getState: () => MekuriState;

  /** Imperative synchronous position access; authoritative for persistence. */
  getReadingPosition: () => MekuriReadingPosition;

  next: () => void;
  prev: () => void;
  /** Lands on a page (spread start in double mode) at an optional fractional
   * offset for exact position restores. */
  goToIndex: (index: number, relativeOffset?: number) => void;
  setMode: (mode: MekuriMode) => void;
  setDirection: (direction: MekuriDirection) => void;
  toggleHUD: (force?: boolean) => void;

  setZoomScale: (scale: number, origin?: { x: number; y: number }) => void;
  resetZoom: () => void;
  /** Multiplies the zoom scale by one step, clamped to the zoom bounds. */
  zoomIn: () => void;
  /** Divides the zoom scale by one step, never below 1. */
  zoomOut: () => void;
  /** Zoom range the engine clamps to, for host zoom controls. */
  getZoomBounds: () => MekuriZoomBounds;

  /** Keyboard bindings in force, for host shortcut help surfaces. */
  getKeyboardMap: () => MekuriKeyboardMap;
  /** True while the host holds the keyboard, for a host that attaches the
   * engine dispatcher to its own markup. */
  isKeyboardSuppressed: () => boolean;
  /** Bounded page indices to warm around the reading position. */
  getPreloadWindow: () => number[];

  /** Failure registry actions. */
  retryPage: (pageId: string | number) => void;
  retryAllFailures: () => void;

  /** Host image pipeline. The engine owns attempt counting, retry scheduling,
   * and the failure registry; the host resolver owns the request and the view
   * reports load outcomes. */
  getPageRequest: (pageId: string | number) => MekuriPageRequest | undefined;
  resolvePageSrc: (pageId: string | number) => Promise<string | null>;
  reportPageLoaded: (pageId: string | number) => void;
  reportPageLoadFailed: (pageId: string | number, code: string, message: string) => void;

  /** Typed DOM prop bindings for the host's containers. Both records are
   * stable for a given mode and zoom lock; the gesture layer refines the
   * dead-zone contract on the viewport. */
  getContainerProps: () => HTMLAttributes<HTMLElement>;
  getViewportProps: () => HTMLAttributes<HTMLElement>;
}

export function useMekuriEngine(options: MekuriEngineOptions): MekuriEngineOutput {
  // The engine reads options through a stable object whose fields are
  // refreshed on every render, so callbacks and controlled state stay live
  // without recreating the store.
  const optionsRef = useRef<MekuriEngineOptions | null>(null);
  if (optionsRef.current === null) {
    optionsRef.current = { ...options };
  } else {
    Object.assign(optionsRef.current, options);
  }

  const engine = useMemo(() => createMekuriEngine(optionsRef.current as MekuriEngineOptions), []);

  // Render-time reconciliation for controlled mode: idempotent, never
  // notifies listeners, so React's snapshot comparison stays stable.
  engine.syncControlled(options.state);

  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  return {
    state,
    getState: engine.getState,
    getReadingPosition: engine.getReadingPosition,
    next: engine.next,
    prev: engine.prev,
    goToIndex: engine.goToIndex,
    setMode: engine.setMode,
    setDirection: engine.setDirection,
    toggleHUD: engine.toggleHUD,
    setZoomScale: engine.setZoomScale,
    resetZoom: engine.resetZoom,
    zoomIn: engine.zoomIn,
    zoomOut: engine.zoomOut,
    getZoomBounds: engine.getZoomBounds,
    getKeyboardMap: engine.getKeyboardMap,
    isKeyboardSuppressed: engine.isKeyboardSuppressed,
    getPreloadWindow: engine.getPreloadWindow,
    retryPage: engine.retryPage,
    retryAllFailures: engine.retryAllFailures,
    getPageRequest: engine.getPageRequest,
    resolvePageSrc: engine.resolvePageSrc,
    reportPageLoaded: engine.reportPageLoaded,
    reportPageLoadFailed: engine.reportPageLoadFailed,
    getContainerProps: engine.getContainerProps,
    getViewportProps: engine.getViewportProps,
  };
}
