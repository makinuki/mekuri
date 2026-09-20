// React subscription shared by the prebuilt view primitives. Each primitive
// subscribes on its own, so a host may render a single HUD or status region
// without a wrapper view, and the snapshot stays referentially stable because
// the store caches the state object it builds.

import { useSyncExternalStore } from "react";
import type { MekuriEngine } from "../engine/store";
import type { MekuriState } from "../engine/types";

export function useEngineState(engine: MekuriEngine): MekuriState {
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}
