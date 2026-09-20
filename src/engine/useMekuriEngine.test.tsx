import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { useMekuriEngine } from "./useMekuriEngine";
import { DEFAULT_SPREAD_CONFIG, type MekuriPage } from "./types";

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
