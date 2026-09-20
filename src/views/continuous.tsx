// Interface contract for ContinuousView (this file only):
//
// ContinuousView takes the vanilla MekuriEngine plus the page list. The
// engine stores the reading position against a concrete scrolled column; the
// continuous view reconciles the two.
//
// Consequences:
// - The view owns scroll. Programmatic position changes (mount restore,
//   engine actions, repagination) align the viewport under the alignment
//   lock; user scrolls adopt the dominant page and report it to the engine.
// - Layout is integer pixels end to end: measured heights are rounded, items
//   are placed with absolute offsets, and no transform or will-change is
//   applied, so continuous seams and compositor layers cannot appear.
// - Images outside the visible range keep their layout box and lose their
//   source, releasing decoded texture memory without shifting the column.
// - Host page bodies come from renderPage. Host slots own their nodes and are
//   never detached by the view.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { resolvePageFromScrollOffset, type MekuriReadingPosition } from "../engine/scroll";
import { createScrollAlignmentLock, type ScrollAlignmentLock } from "../engine/scroll-lock";
import type { MekuriEngine } from "../engine/store";
import type { MekuriMode, MekuriPage } from "../engine/types";

export interface ContinuousViewProps {
  engine: MekuriEngine;
  pages: MekuriPage[];
  /** Width cap for the reading column. Defaults to full width. */
  maxWidth?: number | string;
  /** Vertical gap in pixels. Forced to 0 in webtoon mode. */
  gap?: number;
  /** Rendered items above and below the visible range. Defaults to 4. */
  overscan?: number;
  /** Estimated page height in pixels before the first measurement. */
  estimateSize?: number;
  /** Settling window in milliseconds for programmatic alignment. */
  alignmentWindowMs?: number;
  /** Renders one page body. Defaults to the source image of the page. */
  renderPage?: (page: MekuriPage, index: number) => ReactNode;
}

const DEFAULT_OVERSCAN = 4;
const DEFAULT_ESTIMATE_SIZE = 720;
const DEFAULT_ALIGNMENT_WINDOW_MS = 750;

/** Reading position the viewport is anchored to: the page index, the item top
 * and size the layout reported for it, and the fractional position inside the
 * page. */
interface ScrollAnchor {
  index: number;
  start: number;
  size: number;
  fraction: number;
}

/** Integer main-axis measurement. ResizeObserver entries and
 * getBoundingClientRect both report fractional heights, and a fractional
 * height is the only source of a seam line in a continuous column, so every
 * measurement is rounded before it reaches the layout. */
function integerHeight(node: HTMLElement): number {
  return Math.max(1, Math.round(node.getBoundingClientRect().height));
}

/** Vertical gap for the current mode. Webtoon mode contractually enforces
 * zero spacing; every other mode keeps the host gap, rounded to integer
 * pixels. */
function modeGap(mode: MekuriMode, gap: number | undefined): number {
  if (mode === "continuous-webtoon") return 0;
  return Math.max(0, Math.round(gap ?? 0));
}

/** Default image source for the no-slot path. Hosts own real resolution
 * (pipeline callbacks, proxying, cache busting); the default reads the source
 * the host attached to the page metadata. */
function renderPageSrc(page: MekuriPage): string {
  const metadata = page.metadata ?? {};
  const src = metadata["src"];
  return typeof src === "string" ? src : "";
}

/** Coalesces scroll work into one animation frame, falling back to a timer
 * where the environment has no frame scheduler. */
function scheduleFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const handle = requestAnimationFrame(callback);
    return () => {
      cancelAnimationFrame(handle);
    };
  }
  const handle = window.setTimeout(callback, 0);
  return () => {
    window.clearTimeout(handle);
  };
}

export function ContinuousView({
  engine,
  pages,
  maxWidth = "100%",
  gap,
  overscan = DEFAULT_OVERSCAN,
  estimateSize = DEFAULT_ESTIMATE_SIZE,
  alignmentWindowMs = DEFAULT_ALIGNMENT_WINDOW_MS,
  renderPage,
}: ContinuousViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [, forceRender] = useReducer((value: number) => value + 1, 0);
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const reportedRef = useRef<MekuriReadingPosition | null>(null);

  // The lock lives for the lifetime of the view and is re-created only when
  // the settling window changes.
  const lockRef = useRef<ScrollAlignmentLock | null>(null);
  const lockWindowRef = useRef(alignmentWindowMs);
  if (lockRef.current === null || lockWindowRef.current !== alignmentWindowMs) {
    lockRef.current = createScrollAlignmentLock({ windowMs: alignmentWindowMs });
    lockWindowRef.current = alignmentWindowMs;
  }
  const lock = lockRef.current;
  const settleTimerRef = useRef<number | null>(null);
  const landingCancelRef = useRef<(() => void) | null>(null);
  const anchorRef = useRef<ScrollAnchor | null>(null);

  const mode = engine.getState().mode;
  const containerBindings = engine.getContainerProps();
  const viewportBindings = engine.getViewportProps();

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => Math.max(1, Math.round(estimateSize)),
    overscan: Math.max(0, Math.round(overscan)),
    gap: modeGap(mode, gap),
    enabled: pages.length > 0,
    measureElement: (node) => integerHeight(node as HTMLElement),
    scrollToFn: (offset) => {
      const element = scrollRef.current;
      if (element !== null) element.scrollTop = Math.max(0, Math.round(offset));
    },
  });

  // Absorbs the scroll events a programmatic move produces. The lock is
  // released as soon as the move lands: one frame after the write the offset is
  // either the target, in which case the events it produced resolve the
  // position the engine already holds, or it is not, in which case the target
  // was unreachable (clamped at a list edge) and the lock stays armed for the
  // rest of the settling window so a clamped move never reports navigation.
  const openLock = useCallback(
    (index: number, target: number) => {
      lock.raise(index, target);
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        lock.clear();
      }, alignmentWindowMs);
      landingCancelRef.current?.();
      landingCancelRef.current = scheduleFrame(() => {
        landingCancelRef.current = null;
        const element = scrollRef.current;
        if (element === null || lock.target() !== target) return;
        if (Math.abs(element.scrollTop - target) <= 1) lock.clear();
      });
    },
    [alignmentWindowMs, lock],
  );

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      landingCancelRef.current?.();
    },
    [],
  );

  // Programmatic alignment. The lock absorbs the scroll events this move
  // produces, so a restore never reports back to the engine as user
  // navigation.
  const alignToPosition = useCallback(
    (position: MekuriReadingPosition) => {
      const element = scrollRef.current;
      const total = pagesRef.current.length;
      if (element === null || total === 0) return;
      const index = Math.max(0, Math.min(Math.round(position.pageIndex), total - 1));
      const fraction = Math.min(1, Math.max(0, position.relativeOffset));
      const bounds = virtualizer.getOffsetForIndex(index, "start");
      if (bounds === undefined) return;
      const start = Math.round(bounds[0]);
      const size =
        virtualizer.measurementsCache[index]?.size ?? Math.max(1, Math.round(estimateSize));
      const target = Math.max(0, Math.round(start + fraction * size));
      anchorRef.current = { index, start, size, fraction };
      openLock(index, target);
      virtualizer.scrollToOffset(target);
    },
    [estimateSize, openLock, virtualizer],
  );

  // Engine-driven position changes (goToIndex, next, prev, mode switch,
  // controlled host state) are programmatic: align the viewport under the
  // lock. Positions the view itself reported are left alone.
  useEffect(
    () =>
      engine.subscribe(() => {
        const position = engineRef.current.getReadingPosition();
        const reported = reportedRef.current;
        const alreadySynced =
          reported !== null &&
          reported.pageIndex === position.pageIndex &&
          reported.relativeOffset === position.relativeOffset;
        if (!alreadySynced) {
          reportedRef.current = position;
          alignToPosition(position);
        }
        forceRender();
      }),
    [alignToPosition, engine],
  );

  // User scrolls adopt the dominant rendered item. Reports are coalesced into
  // one frame; reports that belong to a programmatic move are dropped by the
  // lock.
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    let cancel: (() => void) | null = null;
    const onScroll = () => {
      cancel?.();
      cancel = scheduleFrame(() => {
        cancel = null;
        const scrollOffset = element.scrollTop;
        const items = virtualizer.getVirtualItems();
        if (items.length === 0) return;
        const offsets = items.map((item) => ({
          index: item.index,
          top: item.start,
          bottom: item.end,
        }));
        const resolved = resolvePageFromScrollOffset(scrollOffset, offsets);
        if (lock.isProgrammatic(resolved.pageIndex, scrollOffset)) return;
        const anchored = items.find((item) => item.index === resolved.pageIndex);
        anchorRef.current = {
          index: resolved.pageIndex,
          start: Math.round(anchored?.start ?? 0),
          size: Math.round(anchored?.size ?? 0),
          fraction: resolved.relativeOffset,
        };
        reportedRef.current = resolved;
        engineRef.current.reportScroll(scrollOffset, offsets);
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancel?.();
      element.removeEventListener("scroll", onScroll);
    };
  }, [lock, virtualizer]);

  // The engine position is authoritative, and the viewport is reconciled with
  // it after every render. A missing or stale anchor (mount, repagination,
  // engine action) re-aligns to the engine position; a changed item top or
  // item size (estimates replaced by measurements, gaps recomputed) re-applies
  // the anchored reading position instead of drifting away from it.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const total = pagesRef.current.length;
    if (element === null || total === 0) return;
    const position = engineRef.current.getReadingPosition();
    const index = Math.max(0, Math.min(position.pageIndex, total - 1));
    const anchor = anchorRef.current;
    const synced =
      anchor !== null &&
      anchor.index === index &&
      Math.abs(anchor.fraction - position.relativeOffset) < 1e-9;
    if (!synced) {
      reportedRef.current = position;
      alignToPosition(position);
      return;
    }
    const bounds = virtualizer.getOffsetForIndex(index, "start");
    if (bounds === undefined) return;
    const start = Math.round(bounds[0]);
    const size = Math.round(virtualizer.measurementsCache[index]?.size ?? anchor.size);
    if (start === anchor.start && size === anchor.size) return;
    const target = Math.max(0, Math.round(start + anchor.fraction * size));
    anchorRef.current = { index, start, size, fraction: anchor.fraction };
    openLock(index, target);
    virtualizer.scrollToOffset(target);
  });

  if (pages.length === 0) return null;

  const virtualItems = virtualizer.getVirtualItems();
  const activeStart = virtualizer.range?.startIndex ?? 0;
  const activeEnd = virtualizer.range?.endIndex ?? Number.MAX_SAFE_INTEGER;
  const columnStyle: CSSProperties = {
    position: "relative",
    height: Math.round(virtualizer.getTotalSize()),
    maxWidth,
    marginLeft: "auto",
    marginRight: "auto",
  };

  return (
    <div {...containerBindings}>
      <div
        {...viewportBindings}
        ref={scrollRef}
        style={{ ...viewportBindings.style, height: "100%" }}
      >
        <div data-mekuri-column="true" style={columnStyle}>
          {virtualItems.map((item) => {
            const page = pagesRef.current[item.index];
            if (page === undefined) return null;
            const isActive = item.index >= activeStart && item.index <= activeEnd;
            // Detachment applies to the default image body only: a host slot
            // owns its nodes.
            const detached = !isActive && renderPage === undefined;
            return (
              <div
                key={page.id}
                ref={virtualizer.measureElement}
                data-index={item.index}
                data-mekuri-page="true"
                data-mekuri-active={isActive ? "true" : "false"}
                data-mekuri-detached={detached ? "true" : "false"}
                style={{
                  position: "absolute",
                  top: Math.round(item.start),
                  left: 0,
                  right: 0,
                  display: "block",
                  overflow: "hidden",
                  height: detached ? Math.round(item.size) : undefined,
                }}
              >
                {renderPage !== undefined ? (
                  renderPage(page, item.index)
                ) : (
                  <img
                    src={isActive ? renderPageSrc(page) : undefined}
                    alt={`Page ${item.index + 1}`}
                    decoding="async"
                    style={{ display: "block", width: "100%" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
