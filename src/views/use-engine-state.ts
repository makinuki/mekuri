// React subscription shared by the prebuilt view primitives. Each primitive
// subscribes on its own, so a host may render a single HUD or status region
// without a wrapper view, and the snapshot stays referentially stable because
// the store caches the state object it builds.

import { useRef, useSyncExternalStore } from "react";
import type { MekuriEngine } from "../engine/store";
import type { MekuriState } from "../engine/types";

export function useEngineState(engine: MekuriEngine): MekuriState {
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}

/** Subscribes to one field of the engine state. The selected value is
 * memoized against the state snapshot, so an object field keeps its identity
 * across unrelated updates; prefer primitive fields where the shape allows.
 * Hosts reaching for `useSyncExternalStore` over the engine directly can use
 * this instead. */
export function useEngineSelector<T>(engine: MekuriEngine, select: (state: MekuriState) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const cacheRef = useRef<{ state: MekuriState; selected: T } | null>(null);
  if (cacheRef.current === null || cacheRef.current.state !== state) {
    cacheRef.current = { state, selected: selectRef.current(state) };
  }
  return cacheRef.current.selected;
}
