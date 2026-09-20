// Pure scroll-offset to reading-position resolution. Consumed by the
// continuous engine to adopt the dominant page from scroll events and by
// hosts to persist and restore exact reading positions.

export interface MekuriPageOffset {
  /** 0-based page index. */
  index: number;
  /** Top edge of the page layout box in scroll pixels. */
  top: number;
  /** Bottom edge of the page layout box in scroll pixels. */
  bottom: number;
}

export interface MekuriReadingPosition {
  pageIndex: number;
  /** Fractional position within the page, clamped to [0, 1]. */
  relativeOffset: number;
}

/** Resolves the page that owns a scroll offset and the fractional position
 * within it.
 *
 * Offsets are sorted by `top` defensively, so callers may pass virtualizer
 * output in any order. An offset above the first page resolves to the first
 * page at 0; below the last page resolves to the last page at 1; offsets in
 * the gap after a page resolve to that page at 1. Zero-height entries
 * resolve to relativeOffset 0. An empty list resolves to page 0 at 0. */
export function resolvePageFromScrollOffset(
  scrollOffset: number,
  pageOffsets: MekuriPageOffset[],
): MekuriReadingPosition {
  if (pageOffsets.length === 0) {
    return { pageIndex: 0, relativeOffset: 0 };
  }

  const offsets = [...pageOffsets].sort((a, b) => a.top - b.top);

  // Binary search for the last entry whose top edge is at or above the
  // scroll offset.
  let low = 0;
  let high = offsets.length - 1;
  let candidate = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid].top <= scrollOffset) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const target = offsets[candidate];
  const height = target.bottom - target.top;
  const relativeOffset = height > 0 ? (scrollOffset - target.top) / height : 0;

  return {
    pageIndex: target.index,
    relativeOffset: Math.min(1, Math.max(0, relativeOffset)),
  };
}
