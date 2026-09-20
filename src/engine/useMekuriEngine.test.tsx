import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { useMekuriEngine } from "./useMekuriEngine";
import { IMAGE_LOAD_FAILED, RESOLVE_FAILED } from "./pipeline";
import { DEFAULT_SPREAD_CONFIG, type MekuriPage } from "./types";
import { customZoneMap } from "./zones";
import { mockRetryScheduler } from "../test-utils/retries";

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, i) => ({ id: i }));
}

describe("useMekuriEngine uncontrolled", () => {
  it("exposes engine state and applies actions", () => {
    const { result } = renderHook(() => useMekuriEngine({ pages: pages(5) }));
    expect(result.current.state.pageIndex).toBe(0);
    expect(result.current.state.totalPages).toBe(5);
    act(() => result.current.next());
    expect(result.current.state.pageIndex).toBe(1);
    act(() => result.current.goToIndex(3, 0.25));
    expect(result.current.getReadingPosition()).toEqual({
      pageIndex: 3,
      relativeOffset: 0.25,
    });
  });

  it("reports boundaries through the live callback", () => {
    const onBoundaryReached = vi.fn();
    const { result } = renderHook(() => useMekuriEngine({ pages: pages(2), onBoundaryReached }));
    act(() => result.current.prev());
    expect(onBoundaryReached).toHaveBeenCalledWith("start");
  });
});

describe("useMekuriEngine controlled", () => {
  it("forwards patches to the host and reconciles feedback", () => {
    const onStateChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }) => useMekuriEngine({ pages: pages(5), state, onStateChange }),
      {
        initialProps: {
          state: {
            pageIndex: 0,
            mode: "single" as const,
            direction: "ltr" as const,
            zoomScale: 1,
            spreadConfig: { ...DEFAULT_SPREAD_CONFIG },
          },
        },
      },
    );
    act(() => result.current.next());
    expect(onStateChange).toHaveBeenCalledWith({ pageIndex: 1 });
    // Host applies the patch and re-renders with reconciled state.
    rerender({
      state: {
        pageIndex: 1,
        mode: "single" as const,
        direction: "ltr" as const,
        zoomScale: 1,
        spreadConfig: { ...DEFAULT_SPREAD_CONFIG },
      },
    });
    expect(result.current.state.pageIndex).toBe(1);
  });

  it("keeps the snapshot referentially stable across unrelated renders", () => {
    const { result, rerender } = renderHook(() => useMekuriEngine({ pages: pages(5) }));
    const before = result.current.state;
    rerender();
    expect(result.current.state).toBe(before);
  });
});

describe("useMekuriEngine image pipeline", () => {
  it("exposes the zoom range and the tap zone map the gestures dispatch from", () => {
    const zoneMap = customZoneMap([
      { id: "next", action: "next", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    ]);
    const { result } = renderHook(() =>
      useMekuriEngine({ pages: pages(3), zoneMap, maxZoomScale: 2 }),
    );

    expect(result.current.state.activeZoneMap).toBe(zoneMap);
    expect(result.current.getZoomBounds()).toEqual({ min: 1, max: 2 });

    act(() => result.current.setZoomScale(5));
    expect(result.current.state.zoomScale).toBe(2);
    expect(result.current.state.isZoomLocked).toBe(true);
  });

  it("drives resolve, failure, and retry through React state", async () => {
    const retries = mockRetryScheduler();
    const attempts: number[] = [];
    const { result } = renderHook(() =>
      useMekuriEngine({
        pages: [{ id: "page-0" }],
        scheduleRetry: retries.schedule,
        resolveSrc: (_page, attempt) => {
          attempts.push(attempt);
          if (attempt < 2) throw new Error(`attempt ${attempt} failed`);
          return `https://example.test/0.jpg?retry=${attempt}`;
        },
      }),
    );

    await act(async () => {
      await result.current.resolvePageSrc("page-0");
    });

    expect(attempts).toEqual([1]);
    expect(result.current.state.failures["page-0"]).toEqual({
      attempt: 1,
      stage: "resolve",
      code: RESOLVE_FAILED,
      message: "attempt 1 failed",
    });
    expect(retries.scheduled.map((entry) => entry.delayMs)).toEqual([400]);

    act(() => retries.next().run());
    await act(async () => {
      await result.current.resolvePageSrc("page-0");
    });

    expect(attempts).toEqual([1, 2]);
    expect(result.current.state.failures).toEqual({});
    expect(result.current.getPageRequest("page-0")?.src).toBe("https://example.test/0.jpg?retry=2");

    // Host-side escalation: a load failure reported by the view lands in state
    // and is retried on demand for every failing page.
    act(() => result.current.reportPageLoadFailed("page-0", IMAGE_LOAD_FAILED, "broken"));
    expect(result.current.state.failures["page-0"]?.stage).toBe("load");

    act(() => result.current.retryAllFailures());
    expect(result.current.state.failures).toEqual({});
    expect(result.current.getPageRequest("page-0")?.attempt).toBe(3);
  });

  it("exposes zoom steps, the keyboard map, and the preload window", () => {
    const { result } = renderHook(() =>
      useMekuriEngine({
        pages: pages(6),
        keyboardMap: { nextPage: ["KeyN"] },
        preloadBuffer: { forward: 1, backward: 0 },
      }),
    );

    act(() => result.current.zoomIn());
    expect(result.current.state.zoomScale).toBe(1.5);
    act(() => result.current.zoomOut());
    expect(result.current.state.zoomScale).toBe(1);

    expect(result.current.getKeyboardMap().nextPage).toEqual(["KeyN"]);

    act(() => result.current.goToIndex(3));
    expect(result.current.getPreloadWindow()).toEqual([4]);
  });
});
