// Pure spread arithmetic. Direction-independent by design: grouping never
// depends on reading direction; directional placement within a spread is a
// view concern.

import type { MekuriPage, MekuriSpreadConfig } from "./types";

/** Aspect ratio of a page, or null when it cannot be determined. Explicit
 * pixel dimensions take precedence over a precomputed aspectRatio field. */
export function pageAspectRatio(page: MekuriPage): number | null {
  if (page.width != null && page.height != null && page.height > 0) {
    return page.width / page.height;
  }
  if (page.aspectRatio != null && page.aspectRatio > 0) {
    return page.aspectRatio;
  }
  return null;
}

/** True when the page occupies a full spread on its own. Pages with unknown
 * dimensions are treated as portrait until proven otherwise; late landscape
 * discovery triggers repagination at the engine layer. */
export function isLandscapePage(page: MekuriPage, config: MekuriSpreadConfig): boolean {
  const ratio = pageAspectRatio(page);
  return ratio != null && ratio > config.landscapeThreshold;
}

/** Groups page indices into spreads.
 *
 * Rules:
 * - With firstPageIsCover, index 0 renders alone and pairing starts at
 *   index 1.
 * - A landscape page is isolated onto its own spread and the pairing
 *   sequence continues fresh after it.
 * - A portrait page followed by a landscape page renders alone; the
 *   landscape page is isolated on the next iteration.
 * - Indices are 0-based and the union of the result covers every index of
 *   the input exactly once, ascending. */
export function calculateSpreads(pages: MekuriPage[], config: MekuriSpreadConfig): number[][] {
  const spreads: number[][] = [];
  let index = 0;

  if (config.firstPageIsCover && pages.length > 0) {
    spreads.push([0]);
    index = 1;
  }

  while (index < pages.length) {
    if (isLandscapePage(pages[index], config)) {
      spreads.push([index]);
      index += 1;
      continue;
    }

    const next = pages[index + 1];
    if (next !== undefined && !isLandscapePage(next, config)) {
      spreads.push([index, index + 1]);
      index += 2;
    } else {
      // No following page, or the following page is landscape and must
      // stand alone; this page renders alone either way.
      spreads.push([index]);
      index += 1;
    }
  }

  return spreads;
}

/** Clamps an arbitrary page index to the start index of its parent spread.
 * Indices below the first spread clamp to its start; indices past the last
 * spread clamp to the last spread's start. An empty spread list yields 0.
 *
 * Binary search over spread starts; spreads are ascending by construction. */
export function alignToSpread(pageIndex: number, spreads: number[][]): number {
  if (spreads.length === 0) {
    return 0;
  }

  let low = 0;
  let high = spreads.length - 1;
  let candidate = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (spreads[mid][0] <= pageIndex) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return spreads[candidate][0];
}

/** One page per spread. Pairing rules belong to the double-page mode; the
 * single-page and continuous modes place one page per position, so their
 * grouping is the identity over the page list. */
export function identitySpreads(pageCount: number): number[][] {
  const total = Math.max(0, Math.floor(pageCount));
  const spreads: number[][] = [];
  for (let index = 0; index < total; index += 1) {
    spreads.push([index]);
  }
  return spreads;
}
