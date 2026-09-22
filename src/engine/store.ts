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

import { alignToSpread, calculateSpreads, identitySpreads } from "./spreads";
import {
  resolvePageFromScrollOffset,
  type MekuriPageOffset,
  type MekuriReadingPosition,
} from "./scroll";
import { containerProps, viewportProps } from "./props";
import type { MekuriContainerProps, MekuriViewportProps } from "./props";
import {
  DEFAULT_MAX_AUTO_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  RESOLVE_FAILED,
  defaultSrcResolver,
  failureMessage,
  retryDelayMs,
  type MekuriDecodeConstraints,
  type MekuriPageRequest,
} from "./pipeline";
import { DEFAULT_MANGA_ZONE_MAP } from "./zones";
import type {
  ChapterBoundary,
  MekuriControlledState,
  MekuriDirection,
  MekuriFailureRecord,
  MekuriMode,
  MekuriPage,
  MekuriPoint,
  MekuriKeyboardMap,
  MekuriSpreadConfig,
  MekuriState,
  MekuriZoneMap,
} from "./types";
import { DEFAULT_SPREAD_CONFIG } from "./types";
import { mergeKeyboardMap } from "./keyboard";
import { DEFAULT_PRELOAD_BUFFER, preloadWindow, type MekuriPreloadBuffer } from "./preload";

/** Upper zoom bound used when the host configures none. */
export const DEFAULT_MAX_ZOOM_SCALE = 4;

/** Multiplier one zoom step applies when the host configures none. */
export const DEFAULT_ZOOM_STEP = 1.5;

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

  /** Host image pipeline hook: resolves the display source for one attempt.
   * The host owns authentication, proxying, unscrambling, and cache busting
   * keyed on the attempt number. When absent, the source is read from the page
   * metadata. */
  resolveSrc?: (
    page: MekuriPage,
    attempt: number,
    constraints?: MekuriDecodeConstraints,
  ) => string | Promise<string>;

  /** Auto-retries attempted after a failure before escalation. Defaults to 2,
   * so a page that never loads is resolved at most 3 times. */
  maxAutoRetries?: number;

  /** Decode constraints passed through to resolveSrc when configured. */
  maxDecodeDimensions?: MekuriDecodeConstraints;

  /** Base delay of the exponential retry backoff. Defaults to 400 ms. */
  retryDelayMs?: number;

  /** Schedules a delayed callback and returns its canceller. Defaults to
   * setTimeout; injectable so retry timing is testable. */
  scheduleRetry?: (callback: () => void, delayMs: number) => () => void;

  /** Tap zone map the gesture layer dispatches from, and the map hosts read
   * back through activeZoneMap. Defaults to the default-manga preset. */
  zoneMap?: MekuriZoneMap;

  /** Upper bound of the zoom range. Defaults to 4; a value of 1 disables
   * zooming entirely. */
  maxZoomScale?: number;

  /** Multiplier one zoom step applies. Defaults to 1.5. */
  zoomStep?: number;

  /** Keyboard bindings merged over the defaults; see mergeKeyboardMap. */
  keyboardMap?: Partial<MekuriKeyboardMap>;

  /** Imperative keyboard suppression. While true, host modals, dialogs, and
   * focused text inputs own the keyboard and no shortcut is dispatched. */
  isKeyboardSuppressed?: boolean;

  /** Bounded preload buffer around the reading position. Defaults to three
   * pages forward and one back. */
  preloadBuffer?: MekuriPreloadBuffer;

  /** Monotonic clock for sample throttling. Defaults to Date.now;
   * injectable for deterministic tests. */
  now?: () => number;
}

/** Zoom range the engine enforces. Read it instead of repeating the clamp. */
export interface MekuriZoomBounds {
  min: number;
  max: number;
}

export interface MekuriEngine {
  getState(): MekuriState;
  subscribe(listener: () => void): () => void;
  next(): void;
  prev(): void;
  goToIndex(index: number, relativeOffset?: number): void;
  setMode(mode: MekuriMode): void;
  setDirection(direction: MekuriDirection): void;
  /** Sets the discrete zoom scale, clamped to getZoomBounds. The origin is
   * informational for the layer that owns the transform: the engine stores the
   * scale only, so the matrix math stays with the code that applies it. */
  setZoomScale(scale: number, origin?: MekuriPoint): void;
  resetZoom(): void;
  /** Multiplies the scale by the zoom step, clamped to getZoomBounds. */
  zoomIn(): void;
  /** Divides the scale by the zoom step; the floor is 1, so zooming out from
   * an unzoomed surface is a no-op. */
  zoomOut(): void;
  getZoomBounds(): MekuriZoomBounds;
  /** Keyboard bindings in force, host overrides merged over the defaults. */
  getKeyboardMap(): MekuriKeyboardMap;
  /** True while the host holds the keyboard through the isKeyboardSuppressed
   * option. Read live; input layers consult it before dispatching. */
  isKeyboardSuppressed(): boolean;
  /** Bounded page indices to warm around the reading position. */
  getPreloadWindow(): number[];
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
  /** Pipeline state of one page: attempt counter, resolved source, failure.
   * Undefined only for ids the current chapter does not carry. */
  getPageRequest(pageId: string | number): MekuriPageRequest | undefined;
  /** Advances to the page's current attempt and resolves it through the host
   * resolver. Resolves to null when the page is unknown, the resolver fails, or
   * a newer attempt superseded this one. */
  resolvePageSrc(pageId: string | number): Promise<string | null>;
  /** Clears the failure and the scheduled retry for a page. */
  reportPageLoaded(pageId: string | number): void;
  /** Records a load-stage failure and schedules an automatic retry while
   * attempts remain. */
  reportPageLoadFailed(pageId: string | number, code: string, message: string): void;
  /** Re-resolves one page immediately, bypassing the retry backoff. */
  retryPage(pageId: string | number): void;
  /** Re-resolves every page in the failure registry. */
  retryAllFailures(): void;
  /** Reconciles the internal mirror with host-owned state. No-op in
   * uncontrolled mode. Safe to call during render; never notifies. */
  syncControlled(state: MekuriControlledState | undefined): void;
}

/** Engine surface the prebuilt views and the input layers they attach read:
 * subscription, state, reading position, page requests, the container and
 * viewport bindings, and the actions their controls dispatch. Every member is
 * stable for the life of the engine. The vanilla store implements this shape,
 * and the React binding output satisfies it, so a host that renders its own
 * markup can also render the shipped views from the hook output without
 * reaching for the vanilla store. */
export interface MekuriViewEngine {
  getState(): MekuriState;
  subscribe(listener: () => void): () => void;
  next(): void;
  prev(): void;
  toggleHUD(force?: boolean): void;
  setZoomScale(scale: number, origin?: MekuriPoint): void;
  resetZoom(): void;
  zoomIn(): void;
  zoomOut(): void;
  getZoomBounds(): MekuriZoomBounds;
  isKeyboardSuppressed(): boolean;
  getPreloadWindow(): number[];
  getReadingPosition(): MekuriReadingPosition;
  reportScroll(scrollOffset: number, pageOffsets: MekuriPageOffset[]): void;
  getContainerProps(): MekuriContainerProps;
  getViewportProps(): MekuriViewportProps;
  getPageRequest(pageId: string | number): MekuriPageRequest | undefined;
  resolvePageSrc(pageId: string | number): Promise<string | null>;
  reportPageLoaded(pageId: string | number): void;
  reportPageLoadFailed(pageId: string | number, code: string, message: string): void;
}

export function createMekuriEngine(liveOptions: MekuriEngineOptions): MekuriEngine {
  const listeners = new Set<() => void>();
  const clock = (): number => (liveOptions.now ? liveOptions.now() : Date.now());
  const scheduleRetry =
    liveOptions.scheduleRetry ??
    ((callback: () => void, delayMs: number): (() => void) => {
      const handle = setTimeout(callback, delayMs);
      return () => {
        clearTimeout(handle);
      };
    });
  // Pipeline state per page id: attempt counter, resolved source, failure, and
  // the pending automatic retry.
  const requests = new Map<string | number, MekuriPageRequest>();
  const retryCancels = new Map<string | number, () => void>();

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
    mode: MekuriMode;
    spreads: number[][];
  } | null = null;

  let isHUDVisible = true;
  let relativeOffset = 0;
  let lastSampleAt = Number.NEGATIVE_INFINITY;
  // Page list the cached snapshot was built from. Dimensions are the only page
  // input to the spread math, so a list that keeps its dimensions keeps its
  // derived state even when the host hands over a fresh array on every render.
  let snapshotPages: MekuriPage[] = liveOptions.pages;
  // Zone map the cached snapshot was built from. A host may swap presets
  // between renders, so the derived activeZoneMap follows the option.
  let snapshotZoneMap: MekuriZoneMap = liveOptions.zoneMap ?? DEFAULT_MANGA_ZONE_MAP;
  const dimensionKeys = new WeakMap<MekuriPage, string>();
  let snapshot = buildSnapshot();

  function currentZoneMap(): MekuriZoneMap {
    return liveOptions.zoneMap ?? DEFAULT_MANGA_ZONE_MAP;
  }

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
      spreadCache.config !== state.spreadConfig ||
      spreadCache.mode !== state.mode
    ) {
      spreadCache = {
        pages: liveOptions.pages,
        config: state.spreadConfig,
        mode: state.mode,
        // Pairing is a double-page rule. Every other mode holds one page per
        // position, so its grouping is the identity and a host reading
        // activeSpreads renders the page the reading position points at.
        spreads:
          state.mode === "double"
            ? calculateSpreads(liveOptions.pages, state.spreadConfig)
            : identitySpreads(liveOptions.pages.length),
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
      activeZoneMap: currentZoneMap(),
      failures: failureRegistry(),
    };
  }

  /** Serializable view of the registry: only failing pages appear, and every
   * record holds primitives so a host may persist or transmit it directly. */
  function failureRegistry(): Record<string | number, MekuriFailureRecord> {
    const registry: Record<string | number, MekuriFailureRecord> = {};
    for (const [pageId, request] of requests) {
      if (request.failure !== undefined) registry[pageId] = request.failure;
    }
    return registry;
  }

  // Rebuilds the cached snapshot without notifying. Used for render-time
  // reconciliation where listener notification would be re-entrant.
  function rebuild(): void {
    snapshotPages = liveOptions.pages;
    snapshotZoneMap = currentZoneMap();
    snapshot = buildSnapshot();
  }

  function notify(): void {
    rebuild();
    for (const listener of listeners) listener();
  }

  function pageById(pageId: string | number): MekuriPage | undefined {
    return liveOptions.pages.find((page) => page.id === pageId);
  }

  function requestOf(pageId: string | number): MekuriPageRequest {
    const existing = requests.get(pageId);
    if (existing !== undefined) return existing;
    const created: MekuriPageRequest = { attempt: 0, retryScheduled: false };
    requests.set(pageId, created);
    return created;
  }

  function cancelRetry(pageId: string | number): void {
    const cancel = retryCancels.get(pageId);
    if (cancel !== undefined) {
      cancel();
      retryCancels.delete(pageId);
    }
  }

  /** Auto-retries allowed after a failure. Read live so a host may change the
   * budget between attempts; negative and fractional values are clamped. */
  function maxAutoRetries(): number {
    return Math.max(0, Math.floor(liveOptions.maxAutoRetries ?? DEFAULT_MAX_AUTO_RETRIES));
  }

  /** Advances the attempt counter after the backoff the current attempt earns.
   * The advance is what wakes the view, which then resolves the new attempt
   * through resolveSrc. */
  function scheduleAutoRetry(pageId: string | number): void {
    const request = requestOf(pageId);
    request.retryScheduled = false;
    cancelRetry(pageId);
    if (request.attempt > maxAutoRetries()) return;
    const attempt = request.attempt;
    request.retryScheduled = true;
    const delay = retryDelayMs(attempt, liveOptions.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    retryCancels.set(
      pageId,
      scheduleRetry(() => {
        retryCancels.delete(pageId);
        const current = requestOf(pageId);
        current.retryScheduled = false;
        current.attempt = attempt + 1;
        notify();
      }, delay),
    );
  }

  function recordFailure(
    pageId: string | number,
    stage: MekuriFailureRecord["stage"],
    code: string,
    message: string,
  ): void {
    const request = requestOf(pageId);
    request.failure = { attempt: request.attempt, stage, code, message };
  }

  async function resolvePageSrc(pageId: string | number): Promise<string | null> {
    const page = pageById(pageId);
    if (page === undefined) return null;
    const request = requestOf(pageId);
    // The first resolve starts attempt 1; later resolves use the attempt a
    // retry already advanced to, which is what lets a host key its cache
    // busting on the attempt number.
    request.attempt = Math.max(1, request.attempt);
    cancelRetry(pageId);
    request.retryScheduled = false;
    notify();
    const attempt = request.attempt;
    const resolver = liveOptions.resolveSrc;
    let src: string;
    try {
      src = resolver
        ? await resolver(page, attempt, liveOptions.maxDecodeDimensions)
        : defaultSrcResolver(page);
    } catch (error) {
      if (request.attempt !== attempt) return null;
      recordFailure(pageId, "resolve", RESOLVE_FAILED, failureMessage(error));
      scheduleAutoRetry(pageId);
      notify();
      return null;
    }
    // A retry that advanced the attempt while this resolve was in flight owns
    // the request now.
    if (request.attempt !== attempt) return null;
    if (request.failure?.stage === "resolve") request.failure = undefined;
    request.src = src;
    notify();
    return src;
  }

  function reportPageLoaded(pageId: string | number): void {
    const request = requests.get(pageId);
    if (request === undefined) return;
    cancelRetry(pageId);
    request.retryScheduled = false;
    request.failure = undefined;
    notify();
  }

  function reportPageLoadFailed(pageId: string | number, code: string, message: string): void {
    recordFailure(pageId, "load", code, message);
    scheduleAutoRetry(pageId);
    notify();
  }

  function retryPage(pageId: string | number): void {
    const request = requestOf(pageId);
    cancelRetry(pageId);
    request.retryScheduled = false;
    request.failure = undefined;
    request.attempt += 1;
    notify();
  }

  function retryAllFailures(): void {
    for (const [pageId, request] of requests) {
      if (request.failure !== undefined) retryPage(pageId);
    }
  }

  /** Drops pipeline state for pages the chapter no longer carries. Pages that
   * survive keep their attempt counters, so a virtualized page leaving the
   * window never loses a retry. */
  function pruneRequests(pages: MekuriPage[]): void {
    const ids = new Set(pages.map((page) => page.id));
    // Map iteration tolerates deletion of the entry being visited.
    for (const pageId of requests.keys()) {
      if (!ids.has(pageId)) {
        cancelRetry(pageId);
        requests.delete(pageId);
      }
    }
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
    // The zoom lock is enforced here, not only in the gesture layer, so
    // keyboard, HUD, and host callers share the guarantee. goToIndex stays
    // available as the programmatic restore path.
    if (state.zoomScale > 1) return;
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
    // See next(): locked navigation is a no-op for every caller.
    if (state.zoomScale > 1) return;
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

  // Programmatic restore stays available while zoomed: unlike next() and
  // prev(), this move is never a gesture turn.
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

  function setZoomScale(scale: number, _origin?: MekuriPoint): void {
    if (!Number.isFinite(scale)) return;
    const bounds = getZoomBounds();
    const clamped = Math.min(bounds.max, Math.max(bounds.min, scale));
    if (clamped === state.zoomScale) return;
    state.zoomScale = clamped;
    reportControlledPatch({ zoomScale: clamped });
    notify();
  }

  function resetZoom(): void {
    setZoomScale(1);
  }

  /** Zoom range the engine clamps to. Read live so a host may change the range
   * between zoom actions. */
  function getZoomBounds(): MekuriZoomBounds {
    const configured = liveOptions.maxZoomScale;
    const max =
      configured !== undefined && Number.isFinite(configured)
        ? Math.max(1, configured)
        : DEFAULT_MAX_ZOOM_SCALE;
    return { min: 1, max };
  }

  function zoomStep(): number {
    const configured = liveOptions.zoomStep;
    return configured !== undefined && Number.isFinite(configured) && configured > 1
      ? configured
      : DEFAULT_ZOOM_STEP;
  }

  function zoomIn(): void {
    setZoomScale(state.zoomScale * zoomStep());
  }

  function zoomOut(): void {
    setZoomScale(state.zoomScale / zoomStep());
  }

  function getKeyboardMap(): MekuriKeyboardMap {
    return mergeKeyboardMap(liveOptions.keyboardMap);
  }

  function isKeyboardSuppressed(): boolean {
    return liveOptions.isKeyboardSuppressed === true;
  }

  function getPreloadWindow(): number[] {
    return preloadWindow({
      pageIndex: clampedPageIndex(),
      totalPages: totalPages(),
      buffer: liveOptions.preloadBuffer ?? DEFAULT_PRELOAD_BUFFER,
    });
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
      if (pagesChanged() || snapshotZoneMap !== currentZoneMap()) {
        pruneRequests(liveOptions.pages);
        rebuild();
      }
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
    zoomIn,
    zoomOut,
    getZoomBounds,
    getKeyboardMap,
    isKeyboardSuppressed,
    getPreloadWindow,
    toggleHUD,
    getReadingPosition,
    reportScroll,
    getContainerProps,
    getViewportProps,
    getPageRequest: (pageId) => {
      const request = requests.get(pageId);
      if (request !== undefined) return { ...request };
      // Pages the chapter carries but the pipeline never touched report a zeroed
      // record; only ids outside the chapter have no pipeline state at all.
      return pageById(pageId) === undefined ? undefined : { attempt: 0, retryScheduled: false };
    },
    resolvePageSrc,
    reportPageLoaded,
    reportPageLoadFailed,
    retryPage,
    retryAllFailures,
    syncControlled,
  };
}
