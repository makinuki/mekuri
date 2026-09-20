// Creates the engine for one lab stage. The options object stays stable for the
// life of the engine and is refreshed on every render, so host callbacks and
// the page list stay live without recreating the store.

import { useEffect, useMemo, useRef } from "react";
import {
  createMekuriEngine,
  type ChapterBoundary,
  type MekuriDirection,
  type MekuriEngine,
  type MekuriEngineOptions,
  type MekuriMode,
  type MekuriPage,
  type MekuriSpreadConfig,
} from "@makinuki/mekuri/engine";

export interface UseLabEngineArgs {
  pages: MekuriPage[];
  mode: MekuriMode;
  direction: MekuriDirection;
  spreadConfig: MekuriSpreadConfig;
  onBoundaryReached: (boundary: ChapterBoundary) => void;
}

export function useLabEngine(args: UseLabEngineArgs): MekuriEngine {
  const optionsRef = useRef<MekuriEngineOptions | null>(null);
  let options = optionsRef.current;
  if (options === null) {
    options = {
      pages: args.pages,
      initialState: { mode: args.mode, direction: args.direction, spreadConfig: args.spreadConfig },
    };
    optionsRef.current = options;
  }
  const live = options;
  live.pages = args.pages;
  live.onBoundaryReached = args.onBoundaryReached;

  const engine = useMemo(() => createMekuriEngine(live), [live]);
  const { mode, direction } = args;

  useEffect(() => {
    engine.setMode(mode);
  }, [engine, mode]);

  useEffect(() => {
    engine.setDirection(direction);
  }, [engine, direction]);

  return engine;
}
