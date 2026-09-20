// Bounded preload window and its device-safe throttle. WebKit exposes no
// Network Information API, so the buffer is never sized from a connection
// type: it starts conservative, shrinks when an observed image latency exceeds
// the tolerance, and grows back one step after a quiet interval. The window
// itself is pure index math over the chapter the engine already holds.

export interface MekuriPreloadBuffer {
  /** Pages warmed ahead of the reading position. */
  forward: number;
  /** Pages warmed behind the reading position. */
  backward: number;
}

export const DEFAULT_PRELOAD_BUFFER: MekuriPreloadBuffer = { forward: 3, backward: 1 };

export interface MekuriPreloadWindowRequest {
  pageIndex: number;
  totalPages: number;
  buffer?: MekuriPreloadBuffer;
}

/** Page indices to warm, ascending, excluding the page on screen. Indices are
 * clamped to the chapter, so a request near either edge returns a shorter
 * window instead of out-of-range pages. */
export function preloadWindow(request: MekuriPreloadWindowRequest): number[] {
  const total = Math.max(0, Math.floor(request.totalPages));
  if (total === 0) return [];
  const buffer = request.buffer ?? DEFAULT_PRELOAD_BUFFER;
  const current = Math.min(Math.max(0, Math.floor(request.pageIndex)), total - 1);
  const forward = Math.max(0, Math.floor(buffer.forward));
  const backward = Math.max(0, Math.floor(buffer.backward));
  const indices = new Set<number>();
  for (let index = current - backward; index <= current + forward; index += 1) {
    if (index >= 0 && index < total && index !== current) indices.add(index);
  }
  return [...indices].sort((left, right) => left - right);
}

export interface MekuriPreloadThrottleOptions {
  /** Buffer the throttle starts from. Defaults to DEFAULT_PRELOAD_BUFFER. */
  buffer?: MekuriPreloadBuffer;
  /** Smallest buffer the throttle may shrink to. Defaults to one page ahead
   * and none behind, which keeps the next page warm on a slow connection. */
  minBuffer?: MekuriPreloadBuffer;
  /** Latency, in ms, above which the buffer is halved. Defaults to 1500. */
  latencyThresholdMs?: number;
  /** Quiet interval, in ms, before the buffer grows one step back. Defaults to
   * 15000. */
  recoveryMs?: number;
  /** Monotonic clock. Defaults to Date.now; injectable for tests. */
  now?: () => number;
}

export interface MekuriPreloadThrottle {
  /** Buffer in force. Pass it to the engine preloadBuffer option. Recovery is
   * applied lazily here, so the value is always current. */
  getBuffer(): MekuriPreloadBuffer;
  /** Records one image latency sample, in ms. */
  noteLatency(latencyMs: number): void;
  /** Returns the buffer to its configured starting size. */
  reset(): void;
}

const DEFAULT_PRELOAD_MIN_BUFFER: MekuriPreloadBuffer = { forward: 1, backward: 0 };
const DEFAULT_LATENCY_THRESHOLD_MS = 1500;
const DEFAULT_RECOVERY_MS = 15000;

export function createPreloadThrottle(
  options: MekuriPreloadThrottleOptions = {},
): MekuriPreloadThrottle {
  const start = normalizeBuffer(options.buffer ?? DEFAULT_PRELOAD_BUFFER);
  const min = normalizeBuffer(options.minBuffer ?? DEFAULT_PRELOAD_MIN_BUFFER);
  const latencyThresholdMs = options.latencyThresholdMs ?? DEFAULT_LATENCY_THRESHOLD_MS;
  const recoveryMs = options.recoveryMs ?? DEFAULT_RECOVERY_MS;
  const clock = options.now ?? ((): number => Date.now());

  let buffer = { ...start };
  let lastSlowAt = Number.NEGATIVE_INFINITY;

  function shrink(): void {
    buffer = {
      forward: Math.max(min.forward, Math.floor(buffer.forward / 2)),
      backward: Math.max(min.backward, Math.floor(buffer.backward / 2)),
    };
    lastSlowAt = clock();
  }

  function recoverIfQuiet(): void {
    if (buffer.forward >= start.forward && buffer.backward >= start.backward) return;
    if (clock() - lastSlowAt < recoveryMs) return;
    buffer = {
      forward: Math.min(start.forward, buffer.forward + 1),
      backward: Math.min(start.backward, buffer.backward + 1),
    };
    if (buffer.forward < start.forward || buffer.backward < start.backward) lastSlowAt = clock();
  }

  return {
    getBuffer: () => {
      recoverIfQuiet();
      return { ...buffer };
    },
    noteLatency: (latencyMs: number) => {
      if (Number.isFinite(latencyMs) && latencyMs > latencyThresholdMs) {
        shrink();
        return;
      }
      recoverIfQuiet();
    },
    reset: () => {
      buffer = { ...start };
      lastSlowAt = Number.NEGATIVE_INFINITY;
    },
  };
}

function normalizeBuffer(buffer: MekuriPreloadBuffer): MekuriPreloadBuffer {
  return {
    forward: Math.max(0, Math.floor(buffer.forward)),
    backward: Math.max(0, Math.floor(buffer.backward)),
  };
}
