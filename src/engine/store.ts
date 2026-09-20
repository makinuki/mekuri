// Vanilla reader engine core: a framework-agnostic state store implementing
// the discrete engine contract. The React binding in useMekuriEngine.ts is a
// thin wrapper around this store. This module must never import React or
// browser-only globals so the engine stays testable and usable in
// non-DOM environments.
//
// Controlled mode: when liveOptions.state is defined the host owns the
// controlled fields. Actions optimistically update the internal mirror and
// report the changed subset through onStateChange; when the host re-renders
// with reconciled state, syncControlled reconciles the mirror. A compliant
// host therefore never observes drift between its state and engine output.

import { alignToSpread, calculateSpreads } from "./spreads";
import {
  resolvePageFromScrollOffset,
  type MekuriPageOffset,
  type MekuriReadingPosition,
} from "./scroll";
import { containerProps, viewportProps } from "./props";
import type { MekuriContainerProps, MekuriViewportProps } from "./props";
import { DEFAULT_MANGA_ZONE_MAP } from "./zones";
import type {
  ChapterBoundary,
  MekuriControlledState,
  MekuriDirection,
  MekuriMode,
  MekuriPage,
  MekuriSpreadConfig,
  MekuriState,
} from "./types";
import { DEFAULT_SPREAD_CONFIG } from "./types";

export interface MekuriEngineOptions {
  pages: MekuriPage[];

  /** Controlled mode contract: when defined, the host owns these fields. */
  state?: MekuriControlledState;
  onStateChange?: (patch: Partial<MekuriControlledState>) => void;

  /** Uncontrolled mode contract. */
  initialState?: Partial<MekuriControlledState>;

  /** Fired immediately on discrete page changes and throttled to
   * positionSampleInterval (default 1000 ms) during same-page scrolling.
   * Best-effort: samples may be dropped under throttling. */
  onPositionSample?: (position: MekuriReadingPosition) => void;
  positionSampleInterval?: number;

  onBoundaryReached?: (boundary: ChapterBoundary) => void;

  /** Monotonic clock for sample throttling. Defaults to Date.now;
   * injectable for deterministic tests. */
  now?: () => number;
}

export interface MekuriEngine {
  getState(): MekuriState;
  subscribe(listener: () => void): () => void;
  next(): void;
  prev(): void;
  goToIndex(index: number, relativeOffset?: number): void;
  setMode(mode: MekuriMode): void;
  setDirection(direction: MekuriDirection): void;
  setZoomScale(scale: number, origin?: { x: number; y: number }): void;
  resetZoom(): void;
  toggleHUD(force?: boolean): void;
  getReadingPosition(): MekuriReadingPosition;
  /** Feeds viewport scroll state from the view layer; resolves the dominant
   * page and emits position samples per the throttling contract. */
  reportScroll(scrollOffset: number, pageOffsets: MekuriPageOffset[]): void;
  /** Typed DOM prop bindings for host-owned containers. The records are
   * stable for a given mode and zoom lock so spreads do not churn child props
   * between renders. */
  getContainerProps(): MekuriContainerProps;
  getViewportProps(): MekuriViewportProps;
  /** Reconciles the internal mirror with host-owned state. No-op in
   * uncontrolled mode. Safe to call during render; never notifies. */
  syncControlled(state: MekuriControlledState | undefined): void;
}

export function createMekuriEngine(liveOptions: MekuriEngineOptions): MekuriEngine {
  const listeners = new Set<() => void>();
  const clock = (): number => (liveOptions.now ? liveOptions.now() : Date.now());

  const state: MekuriControlledState = {
    pageIndex: liveOptions.initialState?.pageIndex ?? 0,
    mode: liveOptions.initialState?.mode ?? "single",
    direction: liveOptions.initialState?.direction ?? "ltr",
    zoomScale: liveOptions.initialState?.zoomScale ?? 1,
    spreadConfig: liveOptions.initialState?.spreadConfig ?? DEFAULT_SPREAD_CONFIG,
  };

  let spreadCache: {
    pages: MekuriPage[];
    config: MekuriSpreadConfig;
    spreads: number[][];
  } | null = null;

  let isHUDVisible = true;
  let relativeOffset = 0;
  let lastSampleAt = Number.NEGATIVE_INFINITY;
  // Page list the cached snapshot was built from. Dimensions are the only page
  // input to the spread math, so a list that keeps its dimensions keeps its
  // derived state even when the host hands over a fresh array on every render.
  let snapshotPages: MekuriPage[] = liveOptions.pages;
  const dimensionKeys = new WeakMap<MekuriPage, string>();
  let snapshot = buildSnapshot();

  function dimensionKeyOf(page: MekuriPage): string {
    const cached = dimensionKeys.get(page);
    if (cached !== undefined) return cached;
    const key = `${page.width ?? ""}x${page.height ?? ""}@${page.aspectRatio ?? ""}`;
    dimensionKeys.set(page, key);
    return key;
  }

  function pagesChanged(): boolean {
    const pages = liveOptions.pages;
    if (snapshotPages === pages) return false;
    if (snapshotPages.length !== pages.length) return true;
    for (let index = 0; index < pages.length; index += 1) {
      if (dimensionKeyOf(snapshotPages[index]) !== dimensionKeyOf(pages[index])) return true;
    }
    return false;
  }

  function totalPages(): number {
    return liveOptions.pages.length;
  }

  function isControlled(): boolean {
    return liveOptions.state !== undefined;
  }

  function currentSpreads(): number[][] {
    if (
      spreadCache === null ||
      spreadCache.pages !== liveOptions.pages ||
      spreadCache.config !== state.spreadConfig
    ) {
      spreadCache = {
        pages: liveOptions.pages,
        config: state.spreadConfig,
        spreads: calculateSpreads(liveOptions.pages, state.spreadConfig),
      };
    }
    return spreadCache.spreads;
  }

  function clampedPageIndex(): number {
    const total = totalPages();
    if (total === 0) return 0;
    return Math.max(0, Math.min(state.pageIndex, total - 1));
  }

  function buildSnapshot(): MekuriState {
    return {
      pageIndex: clampedPageIndex(),
      mode: state.mode,
      direction: state.direction,
      zoomScale: state.zoomScale,
      spreadConfig: state.spreadConfig,
      totalPages: totalPages(),
      activeSpreads: currentSpreads(),
      isZoomLocked: state.zoomScale > 1,
      isHUDVisible,
      activeZoneMap: DEFAULT_MANGA_ZONE_MAP,
      failures: {},
    };
  }

  // Rebuilds the cached snapshot without notifying. Used for render-time
  // reconciliation where listener notification would be re-entrant.
  function rebuild(): void {
    snapshotPages = liveOptions.pages;
    snapshot = buildSnapshot();
  }

  function notify(): void {
    rebuild();
    for (const listener of listeners) listener();
  }

  function emitSample(): void {
    lastSampleAt = clock();
    liveOptions.onPositionSample?.({
      pageIndex: clampedPageIndex(),
      relativeOffset,
    });
  }

  function reportControlledPatch(patch: Partial<MekuriControlledState>): void {
    if (isControlled()) liveOptions.onStateChange?.(patch);
  }

  function setPageIndex(value: number): boolean {
    const clamped = totalPages() === 0 ? 0 : Math.max(0, Math.min(value, totalPages() - 1));
    if (clamped === state.pageIndex) return false;
    state.pageIndex = clamped;
    relativeOffset = 0;
    return true;
  }

  function next(): void {
    if (state.mode === "double") {
      const spreads = currentSpreads();
      const start = alignToSpread(state.pageIndex, spreads);
      const position = spreads.findIndex((spread) => spread[0] === start);
      if (position >= 0 && position < spreads.length - 1) {
        if (setPageIndex(spreads[position + 1][0])) {
          reportControlledPatch({ pageIndex: state.pageIndex });
          emitSample();
        }
      } else {
        liveOptions.onBoundaryReached?.("end");
      }
    } else if (state.pageIndex < totalPages() - 1) {
      if (setPageIndex(state.pageIndex + 1)) {
        reportControlledPatch({ pageIndex: state.pageIndex });
        emitSample();
      }
    } else {
      liveOptions.onBoundaryReached?.("end");
    }
    notify();
  }

  function prev(): void {
    if (state.mode === "double") {
      const spreads = currentSpreads();
      const start = alignToSpread(state.pageIndex, spreads);
      const position = spreads.findIndex((spread) => spread[0] === start);
      if (position > 0) {
        if (setPageIndex(spreads[position - 1][0])) {
          reportControlledPatch({ pageIndex: state.pageIndex });
          emitSample();
        }
      } else {
        liveOptions.onBoundaryReached?.("start");
      }
    } else if (state.pageIndex > 0) {
      if (setPageIndex(state.pageIndex - 1)) {
        reportControlledPatch({ pageIndex: state.pageIndex });
        emitSample();
      }
    } else {
      liveOptions.onBoundaryReached?.("start");
    }
    notify();
  }

  function goToIndex(index: number, offset?: number): void {
    const total = totalPages();
    const clamped = total === 0 ? 0 : Math.max(0, Math.min(index, total - 1));
    const target = state.mode === "double" ? alignToSpread(clamped, currentSpreads()) : clamped;
    state.pageIndex = target;
    relativeOffset = offset ?? 0;
    reportControlledPatch({ pageIndex: target });
    emitSample();
    notify();
  }

  function setMode(mode: MekuriMode): void {
    if (mode === state.mode) return;
    state.mode = mode;
    // Position preservation: entering double-page mode lands on the spread
    // containing the current page; all other transitions keep the index.
    let aligned = false;
    if (mode === "double") {
      const start = alignToSpread(state.pageIndex, currentSpreads());
      if (start !== state.pageIndex) {
        state.pageIndex = start;
        relativeOffset = 0;
        aligned = true;
      }
    }
    reportControlledPatch(aligned ? { mode, pageIndex: state.pageIndex } : { mode });
    notify();
  }

  function setDirection(direction: MekuriDirection): void {
    if (direction === state.direction) return;
    state.direction = direction;
    reportControlledPatch({ direction });
    notify();
  }

  function setZoomScale(scale: number, _origin?: { x: number; y: number }): void {
    const clamped = Math.max(1, scale);
    if (clamped === state.zoomScale) return;
    state.zoomScale = clamped;
    reportControlledPatch({ zoomScale: clamped });
    notify();
  }

  function resetZoom(): void {
    setZoomScale(1);
  }

  function toggleHUD(force?: boolean): void {
    isHUDVisible = force ?? !isHUDVisible;
    notify();
  }

  function getReadingPosition(): MekuriReadingPosition {
    return { pageIndex: clampedPageIndex(), relativeOffset };
  }

  function reportScroll(scrollOffset: number, pageOffsets: MekuriPageOffset[]): void {
    const resolved = resolvePageFromScrollOffset(scrollOffset, pageOffsets);
    relativeOffset = resolved.relativeOffset;
    if (resolved.pageIndex !== state.pageIndex) {
      state.pageIndex = resolved.pageIndex;
      emitSample();
      notify();
    } else if (clock() - lastSampleAt >= (liveOptions.positionSampleInterval ?? 1000)) {
      emitSample();
    }
  }

  const containerDomProps: MekuriContainerProps = containerProps();
  let viewportDomProps: {
    mode: MekuriMode;
    isZoomLocked: boolean;
    props: MekuriViewportProps;
  } | null = null;

  function getContainerProps(): MekuriContainerProps {
    return containerDomProps;
  }

  function getViewportProps(): MekuriViewportProps {
    const isZoomLocked = state.zoomScale > 1;
    if (
      viewportDomProps === null ||
      viewportDomProps.mode !== state.mode ||
      viewportDomProps.isZoomLocked !== isZoomLocked
    ) {
      viewportDomProps = {
        mode: state.mode,
        isZoomLocked,
        props: viewportProps(state.mode, isZoomLocked),
      };
    }
    return viewportDomProps.props;
  }

  function syncControlled(next?: MekuriControlledState): void {
    if (!isControlled() || !next) return;
    let changed = false;
    if (next.pageIndex !== state.pageIndex) {
      state.pageIndex = next.pageIndex;
      relativeOffset = 0;
      changed = true;
    }
    if (next.mode !== state.mode) {
      state.mode = next.mode;
      changed = true;
    }
    if (next.direction !== state.direction) {
      state.direction = next.direction;
      changed = true;
    }
    if (next.zoomScale !== state.zoomScale) {
      state.zoomScale = next.zoomScale;
      changed = true;
    }
    if (next.spreadConfig !== state.spreadConfig) {
      state.spreadConfig = next.spreadConfig;
      spreadCache = null;
      changed = true;
    }
    if (changed) rebuild();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    getState: () => {
      // The host owns the page list and replaces it in place; rebuild the
      // snapshot so derived values (spreads above all) never lag behind a page
      // list whose dimensions the host already swapped.
      if (pagesChanged()) rebuild();
      return snapshot;
    },
    subscribe,
    next,
    prev,
    goToIndex,
    setMode,
    setDirection,
    setZoomScale,
    resetZoom,
    toggleHUD,
    getReadingPosition,
    reportScroll,
    getContainerProps,
    getViewportProps,
    syncControlled,
  };
}
