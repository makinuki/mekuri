// Wake lock tests drive the controller against a recording provider double.
// jsdom implements neither the Screen Wake Lock API nor visibility changes, so
// the provider and the document visibility state are both injected and every
// case asserts the request and release sequence.
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  attachWakeLock,
  type MekuriWakeLockController,
  type WakeLockProviderLike,
  type WakeLockSentinelLike,
} from "./wake-lock";

class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  releaseCalls = 0;
  private readonly listeners: Array<() => void> = [];

  async release(): Promise<void> {
    this.releaseCalls += 1;
    this.released = true;
    this.emit();
  }

  addEventListener(_type: "release", listener: () => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: "release", listener: () => void): void {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  get listenerCount(): number {
    return this.listeners.length;
  }

  /** Platform-side release: the browser drops the lock and fires the event. */
  releaseFromPlatform(): void {
    this.released = true;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners.slice()) listener();
  }
}

interface ProviderDouble {
  readonly provider: WakeLockProviderLike;
  readonly sentinels: FakeSentinel[];
  readonly types: string[];
  rejectNext: number;
}

function providerDouble(): ProviderDouble {
  const double: ProviderDouble = {
    sentinels: [],
    types: [],
    rejectNext: 0,
    provider: {
      request: (type: "screen") => {
        double.types.push(type);
        if (double.rejectNext > 0) {
          double.rejectNext -= 1;
          return Promise.reject(new Error("wake lock denied"));
        }
        const sentinel = new FakeSentinel();
        double.sentinels.push(sentinel);
        return Promise.resolve(sentinel);
      },
    },
  };
  return double;
}

interface VisibilityDouble {
  set(state: "visible" | "hidden"): void;
  fire(): void;
  restore(): void;
}

function visibilityDouble(): VisibilityDouble {
  const own = Object.getOwnPropertyDescriptor(document, "visibilityState");
  let state: "visible" | "hidden" = document.visibilityState === "hidden" ? "hidden" : "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  return {
    set(next) {
      state = next;
    },
    fire() {
      document.dispatchEvent(new Event("visibilitychange"));
    },
    restore() {
      if (own === undefined)
        delete (document as unknown as Record<string, unknown>).visibilityState;
      else Object.defineProperty(document, "visibilityState", own);
    },
  };
}

interface Harness {
  double: ProviderDouble;
  controller: MekuriWakeLockController;
  visibility: VisibilityDouble;
  restore(): void;
}

let active: Harness | null = null;

function harness(options: { enabled?: boolean } = {}): Harness {
  const double = providerDouble();
  const visibility = visibilityDouble();
  const controller = attachWakeLock({
    enabled: options.enabled,
    wakeLock: double.provider,
    document,
  });

  const instance: Harness = {
    double,
    controller,
    visibility,
    restore() {
      controller.detach();
      visibility.restore();
    },
  };
  active = instance;
  return instance;
}

afterEach(() => {
  active?.restore();
  active = null;
});

/** Lets the controller settle the acquire and release microtask chains. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("attachWakeLock", () => {
  it("holds nothing until the host opts in", async () => {
    const { double, controller } = harness();
    expect(controller.isEnabled()).toBe(false);
    expect(controller.isHeld()).toBe(false);
    expect(double.types).toEqual([]);

    await expect(controller.enable()).resolves.toBe(true);
    expect(controller.isEnabled()).toBe(true);
    expect(controller.isHeld()).toBe(true);
    expect(double.types).toEqual(["screen"]);
  });

  it("acquires at attach time when the host enables it up front", async () => {
    const { double, controller } = harness({ enabled: true });
    await flush();
    expect(controller.isEnabled()).toBe(true);
    expect(controller.isHeld()).toBe(true);
    expect(double.types).toEqual(["screen"]);
  });

  it("releases the lock while hidden and re-acquires it when the document returns", async () => {
    const { double, controller, visibility } = harness({ enabled: true });
    await flush();
    const first = double.sentinels[0];
    expect(controller.isHeld()).toBe(true);

    visibility.set("hidden");
    visibility.fire();
    await flush();

    expect(controller.isHeld()).toBe(false);
    expect(first.releaseCalls).toBe(1);

    visibility.set("visible");
    visibility.fire();
    await flush();

    expect(controller.isHeld()).toBe(true);
    expect(double.sentinels).toHaveLength(2);
    expect(double.types).toEqual(["screen", "screen"]);
  });

  it("releases on blur and re-acquires on focus", async () => {
    const { double, controller } = harness({ enabled: true });
    await flush();

    window.dispatchEvent(new Event("blur"));
    await flush();
    expect(controller.isHeld()).toBe(false);

    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(controller.isHeld()).toBe(true);
    expect(double.sentinels).toHaveLength(2);
  });

  it("releases on pagehide", async () => {
    const { controller } = harness({ enabled: true });
    await flush();

    window.dispatchEvent(new Event("pagehide"));
    await flush();
    expect(controller.isHeld()).toBe(false);
    expect(controller.isEnabled()).toBe(true);
  });

  it("treats a platform release as the lock being gone", async () => {
    const { double, controller, visibility } = harness({ enabled: true });
    await flush();

    double.sentinels[0].releaseFromPlatform();
    expect(controller.isHeld()).toBe(false);

    visibility.set("visible");
    visibility.fire();
    await flush();
    expect(controller.isHeld()).toBe(true);
  });

  it("re-acquires after an explicit release while staying enabled", async () => {
    const { double, controller, visibility } = harness({ enabled: true });
    await flush();

    await controller.release();
    expect(controller.isHeld()).toBe(false);
    expect(controller.isEnabled()).toBe(true);

    visibility.set("visible");
    visibility.fire();
    await flush();
    expect(double.sentinels).toHaveLength(2);
    expect(controller.isHeld()).toBe(true);
  });

  it("requests nothing while the document is already hidden", async () => {
    const { double, controller, visibility } = harness();
    visibility.set("hidden");

    await expect(controller.enable()).resolves.toBe(false);
    expect(controller.isHeld()).toBe(false);
    expect(double.types).toEqual([]);

    visibility.set("visible");
    visibility.fire();
    await flush();
    expect(controller.isHeld()).toBe(true);
  });

  it("stays off after disable across visibility changes", async () => {
    const { double, controller, visibility } = harness({ enabled: true });
    await flush();

    await controller.disable();
    expect(controller.isEnabled()).toBe(false);
    expect(controller.isHeld()).toBe(false);

    visibility.set("hidden");
    visibility.fire();
    visibility.set("visible");
    visibility.fire();
    await flush();

    expect(controller.isHeld()).toBe(false);
    expect(double.types).toEqual(["screen"]);
  });

  it("retries a denied request on the next foreground event", async () => {
    const { double, controller, visibility } = harness();
    double.rejectNext = 1;

    await expect(controller.enable()).resolves.toBe(false);
    expect(controller.isHeld()).toBe(false);

    visibility.set("visible");
    visibility.fire();
    await flush();

    expect(controller.isHeld()).toBe(true);
    expect(double.types).toEqual(["screen", "screen"]);
  });

  it("deduplicates overlapping requests", async () => {
    const { double, controller } = harness();
    const results = await Promise.all([controller.enable(), controller.enable()]);
    expect(results).toEqual([true, true]);
    expect(double.types).toEqual(["screen"]);
  });

  it("detaches the listeners and the sentinel", async () => {
    const { double, controller, visibility } = harness({ enabled: true });
    await flush();
    const sentinel = double.sentinels[0];

    controller.detach();
    await flush();

    expect(sentinel.releaseCalls).toBe(1);
    expect(sentinel.listenerCount).toBe(0);
    expect(controller.isHeld()).toBe(false);
    expect(controller.isEnabled()).toBe(false);

    visibility.set("visible");
    visibility.fire();
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(double.types).toEqual(["screen"]);
  });

  it("does nothing without a provider", async () => {
    const controller = attachWakeLock({ document });
    await expect(controller.enable()).resolves.toBe(false);
    expect(controller.isHeld()).toBe(false);
    controller.detach();
  });
});
