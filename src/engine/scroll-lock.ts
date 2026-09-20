// Programmatic scroll alignment lock for the continuous reading path. A
// caller that positions the viewport itself (initial restore, engine action,
// mode switch, repagination) arms the lock around that move, so the scroll
// events the move produces are never reported back to the engine as user page
// changes.

export interface ScrollAlignmentLockOptions {
  /** Settling window in milliseconds. Reports that miss the programmatic
   * target count as programmatic until this window expires, which covers
   * coalesced events and scroll positions the layout cannot reach. */
  windowMs?: number;
  /** Arrival tolerance in pixels. Defaults to 1. */
  tolerancePx?: number;
  /** Monotonic clock. Defaults to Date.now; injectable for tests. */
  now?: () => number;
}

export interface ScrollAlignmentLock {
  /** Arms the lock for a programmatic move to targetOffset, anchored on the
   * index the move lands. Re-arming restarts the settling window. */
  raise(anchorIndex: number, targetOffset: number): void;
  /** Disarms the lock immediately. Suppression stops. */
  clear(): void;
  /** Classifies one scroll report. Returns true when the report belongs to
   * the programmatic move and must not move the reading position. Reporting
   * the anchor index, or an offset within tolerance of the target, counts as
   * arrival and releases the lock. */
  isProgrammatic(index: number, scrollOffset: number): boolean;
  isArmed(): boolean;
  /** Index the most recent raise anchored. */
  anchor(): number;
  /** Offset the most recent raise targeted, or null while disarmed. */
  target(): number | null;
}

export const DEFAULT_ALIGNMENT_WINDOW_MS = 750;

export function createScrollAlignmentLock(
  options: ScrollAlignmentLockOptions = {},
): ScrollAlignmentLock {
  const windowMs = options.windowMs ?? DEFAULT_ALIGNMENT_WINDOW_MS;
  const tolerancePx = options.tolerancePx ?? 1;
  const clock = options.now ?? ((): number => Date.now());

  let armed = false;
  let armedAt = 0;
  let anchorIndex = 0;
  let targetOffset: number | null = null;

  function release(): void {
    armed = false;
    targetOffset = null;
  }

  return {
    raise(anchor, target) {
      armed = true;
      armedAt = clock();
      anchorIndex = anchor;
      targetOffset = target;
    },
    clear: release,
    isProgrammatic(index, scrollOffset) {
      if (!armed) return false;
      const arrived =
        index === anchorIndex ||
        (targetOffset !== null && Math.abs(scrollOffset - targetOffset) <= tolerancePx);
      if (arrived) {
        release();
        return true;
      }
      if (clock() - armedAt <= windowMs) return true;
      // The target was unreachable (clamped at the list edge, or the layout
      // moved under the move). Release so later scrolls adopt the dominant
      // page again.
      release();
      return false;
    },
    isArmed: () => armed,
    anchor: () => anchorIndex,
    target: () => targetOffset,
  };
}
