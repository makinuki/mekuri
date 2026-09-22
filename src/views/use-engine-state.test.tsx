// useEngineSelector tests subscribe to a real engine through small probe
// components: the selected field follows engine updates, while unrelated
// updates keep the selected identity.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createMekuriEngine } from "../engine/store";
import type { MekuriPage } from "../engine/types";
import { useEngineSelector } from "./use-engine-state";

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

afterEach(cleanup);

describe("useEngineSelector", () => {
  it("follows the selected field", () => {
    const engine = createMekuriEngine({ pages: pages(4) });
    const seen: number[] = [];
    function Probe(): null {
      seen.push(useEngineSelector(engine, (state) => state.pageIndex));
      return null;
    }
    render(<Probe />);

    act(() => {
      engine.goToIndex(2);
    });

    expect(seen[seen.length - 1]).toBe(2);
  });

  it("keeps the selected identity across unrelated updates", () => {
    const engine = createMekuriEngine({ pages: pages(4) });
    const seen: unknown[] = [];
    function Probe(): null {
      seen.push(useEngineSelector(engine, (state) => state.spreadConfig));
      return null;
    }
    render(<Probe />);

    act(() => {
      engine.toggleHUD();
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
