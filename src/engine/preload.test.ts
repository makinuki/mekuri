// @vitest-environment node
// Preload tests run in plain Node: the window is index math and the throttle
// is clock-driven, so neither depends on a DOM.
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_PRELOAD_BUFFER,
  createPreloadThrottle,
  preloadWindow,
  type MekuriPreloadBuffer,
  type MekuriPreloadThrottleOptions,
} from "./preload";

describe("preloadWindow", () => {
  it("returns the default window around the reading position", () => {
    expect(DEFAULT_PRELOAD_BUFFER).toEqual({ forward: 3, backward: 1 });
    expect(preloadWindow({ pageIndex: 4, totalPages: 10 })).toEqual([3, 5, 6, 7]);
  });

  it("excludes the page on screen", () => {
    expect(
      preloadWindow({ pageIndex: 4, totalPages: 10, buffer: { forward: 2, backward: 2 } }),
    ).toEqual([2, 3, 5, 6]);
  });

  it("clamps the window to the chapter edges", () => {
    expect(preloadWindow({ pageIndex: 0, totalPages: 10 })).toEqual([1, 2, 3]);
    expect(preloadWindow({ pageIndex: 9, totalPages: 10 })).toEqual([8]);
    expect(
      preloadWindow({ pageIndex: 9, totalPages: 10, buffer: { forward: 0, backward: 3 } }),
    ).toEqual([6, 7, 8]);
  });

  it("returns nothing for an empty chapter", () => {
    expect(preloadWindow({ pageIndex: 0, totalPages: 0 })).toEqual([]);
  });

  it("clamps an out-of-range page index to the chapter", () => {
    expect(
      preloadWindow({ pageIndex: 40, totalPages: 4, buffer: { forward: 1, backward: 1 } }),
    ).toEqual([2]);
    expect(
      preloadWindow({ pageIndex: -5, totalPages: 4, buffer: { forward: 1, backward: 1 } }),
    ).toEqual([1]);
  });

  it("normalizes a fractional or negative buffer", () => {
    const buffer = { forward: 2.9, backward: -1 } as MekuriPreloadBuffer;
    expect(preloadWindow({ pageIndex: 3, totalPages: 8, buffer })).toEqual([4, 5]);
  });

  it("returns an empty window when both directions are zero", () => {
    expect(
      preloadWindow({ pageIndex: 2, totalPages: 8, buffer: { forward: 0, backward: 0 } }),
    ).toEqual([]);
  });
});

function clockedThrottle(options: Omit<MekuriPreloadThrottleOptions, "now"> = {}) {
  let time = 0;
  const throttle = createPreloadThrottle({ ...options, now: () => time });
  return {
    throttle,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe("createPreloadThrottle", () => {
  it("starts at the configured buffer", () => {
    const { throttle } = clockedThrottle({ buffer: { forward: 8, backward: 4 } });
    expect(throttle.getBuffer()).toEqual({ forward: 8, backward: 4 });
  });

  it("halves the buffer when a sample exceeds the tolerance", () => {
    const { throttle } = clockedThrottle({ buffer: { forward: 8, backward: 4 } });
    throttle.noteLatency(2000);
    expect(throttle.getBuffer()).toEqual({ forward: 4, backward: 2 });
  });

  it("ignores a sample within the tolerance", () => {
    const { throttle } = clockedThrottle({ buffer: { forward: 8, backward: 4 } });
    throttle.noteLatency(1500);
    throttle.noteLatency(400);
    expect(throttle.getBuffer()).toEqual({ forward: 8, backward: 4 });
  });

  it("ignores a sample that is not a finite number", () => {
    const { throttle } = clockedThrottle({ buffer: { forward: 8, backward: 4 } });
    throttle.noteLatency(Number.NaN);
    throttle.noteLatency(Number.POSITIVE_INFINITY);
    expect(throttle.getBuffer()).toEqual({ forward: 8, backward: 4 });
  });

  it("floors at the minimum buffer under repeated slow samples", () => {
    const { throttle } = clockedThrottle({
      buffer: { forward: 8, backward: 4 },
      minBuffer: { forward: 1, backward: 0 },
    });
    for (let sample = 0; sample < 6; sample += 1) throttle.noteLatency(3000);
    expect(throttle.getBuffer()).toEqual({ forward: 1, backward: 0 });
  });

  it("recovers one step at a time after a quiet interval", () => {
    const { throttle, advance } = clockedThrottle({
      buffer: { forward: 8, backward: 4 },
      recoveryMs: 10000,
    });
    throttle.noteLatency(2000);
    expect(throttle.getBuffer()).toEqual({ forward: 4, backward: 2 });

    advance(9999);
    expect(throttle.getBuffer()).toEqual({ forward: 4, backward: 2 });

    advance(1);
    expect(throttle.getBuffer()).toEqual({ forward: 5, backward: 3 });

    // The step that grew the buffer restarts the quiet interval.
    advance(10000);
    expect(throttle.getBuffer()).toEqual({ forward: 6, backward: 4 });
  });

  it("returns to the starting buffer once the connection stays quiet", () => {
    const { throttle, advance } = clockedThrottle({
      buffer: { forward: 4, backward: 2 },
      minBuffer: { forward: 1, backward: 0 },
      recoveryMs: 1000,
    });
    throttle.noteLatency(9000);
    expect(throttle.getBuffer()).toEqual({ forward: 2, backward: 1 });

    for (let interval = 0; interval < 4; interval += 1) {
      advance(1000);
      throttle.getBuffer();
    }
    expect(throttle.getBuffer()).toEqual({ forward: 4, backward: 2 });
  });

  it("does not exceed the starting buffer while recovering", () => {
    const { throttle, advance } = clockedThrottle({
      buffer: { forward: 2, backward: 1 },
      recoveryMs: 1000,
    });
    throttle.noteLatency(9000);
    for (let interval = 0; interval < 6; interval += 1) {
      advance(1000);
      expect(throttle.getBuffer()).toEqual({ forward: 2, backward: 1 });
    }
  });

  it("returns to its starting size on reset", () => {
    const { throttle } = clockedThrottle({ buffer: { forward: 8, backward: 4 } });
    throttle.noteLatency(9000);
    throttle.noteLatency(9000);
    expect(throttle.getBuffer().forward).toBeLessThan(8);

    throttle.reset();
    expect(throttle.getBuffer()).toEqual({ forward: 8, backward: 4 });

    // A reset also clears the throttle history, so the next slow sample
    // halves the starting buffer again.
    throttle.noteLatency(9000);
    expect(throttle.getBuffer()).toEqual({ forward: 4, backward: 2 });
  });

  it("returns a buffer that cannot mutate the throttle", () => {
    const { throttle } = clockedThrottle({ buffer: { forward: 8, backward: 4 } });
    const buffer = throttle.getBuffer();
    buffer.forward = 0;
    expect(throttle.getBuffer()).toEqual({ forward: 8, backward: 4 });
  });
});
