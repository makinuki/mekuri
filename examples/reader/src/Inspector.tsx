// Raw engine state for the operator. Everything the reader does is visible
// here, which is what makes manual checks observational rather than a guess.

import type { ReactElement } from "react";
import type { MekuriEngine } from "@makinuki/mekuri/engine";
import { useEngineState } from "@makinuki/mekuri/views";

export function Inspector({ engine }: { engine: MekuriEngine }): ReactElement {
  const state = useEngineState(engine);
  const snapshot = {
    pageIndex: state.pageIndex,
    totalPages: state.totalPages,
    mode: state.mode,
    direction: state.direction,
    zoomScale: state.zoomScale,
    isZoomLocked: state.isZoomLocked,
    isHUDVisible: state.isHUDVisible,
    spreadConfig: state.spreadConfig,
    activeSpreads: state.activeSpreads,
    zoneMap: state.activeZoneMap.name,
    preloadWindow: engine.getPreloadWindow(),
    readingPosition: engine.getReadingPosition(),
    failures: state.failures,
  };
  return (
    <details className="inspector">
      <summary>Engine state</summary>
      <div className="row">
        <button type="button" onClick={() => engine.retryAllFailures()}>
          retry failures
        </button>
        <span className="status">{String(Object.keys(state.failures).length) + " failure(s)"}</span>
      </div>
      <pre>{JSON.stringify(snapshot, null, 2)}</pre>
    </details>
  );
}
