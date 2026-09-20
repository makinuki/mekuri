// Screen Wake Lock helper. The lock is opt-in: nothing is held until the host
// enables the controller. While enabled the lock is held only in the
// foreground, so a hidden tab never keeps the device awake, and it is
// requested again when the document returns to the foreground. Requests are
// best effort: an absent provider, a denied request, or a platform release
// leaves the controller inactive instead of throwing into host code.

/** Minimal surface of the Screen Wake Lock API this helper depends on. */
export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener?(type: "release", listener: () => void): void;
  removeEventListener?(type: "release", listener: () => void): void;
}

export interface WakeLockProviderLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

export interface MekuriWakeLockOptions {
  /** Enables the controller at attach time, acquiring immediately when the
   * document is visible. Defaults to false, so the host opts in through
   * enable(). */
  enabled?: boolean;
  /** Wake lock provider. Defaults to the global navigator wake lock. */
  wakeLock?: WakeLockProviderLike;
  /** Document whose visibility gates the lock. Defaults to the global one. */
  document?: Document;
}

export interface MekuriWakeLockController {
  /** Opts in and requests the lock. Resolves true when it is held. */
  enable(): Promise<boolean>;
  /** Opts out and releases the lock. */
  disable(): Promise<void>;
  /** Releases the lock while staying opted in, so the next foreground event
   * acquires it again. */
  release(): Promise<void>;
  /** True while a sentinel is held. */
  isHeld(): boolean;
  /** True while opted in, whether or not a sentinel is held. */
  isEnabled(): boolean;
  /** Releases the lock and removes every listener. */
  detach(): void;
}

const WAKE_LOCK_TYPE = "screen";

export function attachWakeLock(options: MekuriWakeLockOptions = {}): MekuriWakeLockController {
  const doc = options.document ?? globalDocument();
  const win = doc?.defaultView ?? null;
  const provider = options.wakeLock ?? globalWakeLock();
  let enabled = options.enabled === true;
  let sentinel: WakeLockSentinelLike | null = null;
  let pending: Promise<boolean> | null = null;
  let detached = false;

  /** Sentinel currently held, dropping one the platform already released. */
  function heldSentinel(): WakeLockSentinelLike | null {
    if (sentinel !== null && sentinel.released) sentinel = null;
    return sentinel;
  }

  function isHidden(): boolean {
    return doc !== undefined && doc.visibilityState === "hidden";
  }

  function onSentinelRelease(): void {
    sentinel = null;
  }

  async function releaseSentinel(target: WakeLockSentinelLike): Promise<void> {
    try {
      await target.release();
    } catch {
      // The platform may have released the sentinel already; the lock is not
      // held either way.
    }
  }

  async function acquire(): Promise<boolean> {
    if (!enabled || detached || isHidden()) return false;
    if (heldSentinel() !== null) return true;
    if (pending !== null) return pending;
    if (provider === undefined) return false;
    let request: Promise<WakeLockSentinelLike>;
    try {
      request = provider.request(WAKE_LOCK_TYPE);
    } catch {
      return false;
    }
    const inFlight = Promise.resolve(request).then(
      async (result) => {
        pending = null;
        if (!enabled || detached) {
          await releaseSentinel(result);
          return false;
        }
        sentinel = result;
        result.addEventListener?.("release", onSentinelRelease);
        return true;
      },
      () => {
        pending = null;
        return false;
      },
    );
    pending = inFlight;
    return inFlight;
  }

  async function release(): Promise<void> {
    const held = heldSentinel();
    sentinel = null;
    if (held === null) return;
    held.removeEventListener?.("release", onSentinelRelease);
    await releaseSentinel(held);
  }

  function onVisibilityChange(): void {
    if (isHidden()) void release();
    else void acquire();
  }

  function onForeground(): void {
    void acquire();
  }

  function onBackground(): void {
    void release();
  }

  doc?.addEventListener("visibilitychange", onVisibilityChange);
  win?.addEventListener("blur", onBackground);
  win?.addEventListener("pagehide", onBackground);
  win?.addEventListener("focus", onForeground);
  win?.addEventListener("pageshow", onForeground);

  if (enabled) void acquire();

  return {
    enable: async () => {
      enabled = true;
      return acquire();
    },
    disable: async () => {
      enabled = false;
      await release();
    },
    release,
    isHeld: () => heldSentinel() !== null,
    isEnabled: () => enabled,
    detach: () => {
      detached = true;
      enabled = false;
      doc?.removeEventListener("visibilitychange", onVisibilityChange);
      win?.removeEventListener("blur", onBackground);
      win?.removeEventListener("pagehide", onBackground);
      win?.removeEventListener("focus", onForeground);
      win?.removeEventListener("pageshow", onForeground);
      void release();
    },
  };
}

function globalDocument(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}

function globalWakeLock(): WakeLockProviderLike | undefined {
  const navigatorLike: unknown = typeof navigator === "undefined" ? undefined : navigator;
  const wakeLock = (navigatorLike as { wakeLock?: WakeLockProviderLike } | undefined)?.wakeLock;
  return typeof wakeLock?.request === "function" ? wakeLock : undefined;
}
