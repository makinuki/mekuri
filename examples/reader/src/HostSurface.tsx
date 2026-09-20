// The host-markup surface: the same engine state drawn by the lab's own
// elements, without the prebuilt views. It shows that the viewport prop
// bindings, the zone map, and the image pipeline are usable data, and it keeps
// the zoom matrix the same way the shipped views do.

import { useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { IMAGE_LOAD_FAILED, type MekuriEngine, type MekuriPage } from "@makinuki/mekuri/engine";
import { useEngineState, useMekuriSurface } from "@makinuki/mekuri/views";

export interface HostSurfaceProps {
  engine: MekuriEngine;
  pages: MekuriPage[];
  hud: boolean;
  zoneOverlay: boolean;
  boundarySlot: ReactNode;
}

export function HostSurface({
  engine,
  pages,
  hud,
  zoneOverlay,
  boundarySlot,
}: HostSurfaceProps): ReactElement | null {
  const state = useEngineState(engine);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<HTMLDivElement | null>(null);
  const requestedRef = useRef(new Map<string | number, number>());
  const containerBindings = engine.getContainerProps();
  const viewportBindings = engine.getViewportProps();
  const spread = state.activeSpreads.find((indices) => indices.includes(state.pageIndex)) ?? [
    state.pageIndex,
  ];

  useMekuriSurface({ engine, surfaceRef, transformRef, zoomScale: state.zoomScale });

  useEffect(() => {
    const requested = requestedRef.current;
    const wanted = new Set<number>([...spread, ...engine.getPreloadWindow()]);
    for (const index of wanted) {
      const page = pages[index];
      if (page === undefined) continue;
      const request = engine.getPageRequest(page.id);
      if (request === undefined || request.retryScheduled) continue;
      if (request.attempt === requested.get(page.id)) continue;
      void engine.resolvePageSrc(page.id);
      requested.set(page.id, engine.getPageRequest(page.id)?.attempt ?? request.attempt);
    }
  });

  if (pages.length === 0) return null;

  return (
    <div
      {...containerBindings}
      data-host-surface=""
      style={{ ...containerBindings.style, position: "relative", overflow: "hidden" }}
    >
      <div
        {...viewportBindings}
        ref={surfaceRef}
        role="region"
        aria-label="Reader viewport"
        tabIndex={-1}
        style={{ ...viewportBindings.style, width: "100%", height: "100%", overflow: "hidden" }}
      >
        <div
          ref={transformRef}
          style={{ width: "100%", height: "100%", display: "flex", transformOrigin: "0 0" }}
        >
          {spread.map((index) => {
            const page = pages[index];
            if (page === undefined) return null;
            const request = engine.getPageRequest(page.id);
            const label = typeof page.metadata?.["name"] === "string" ? page.metadata["name"] : "";
            return (
              <div
                key={page.id}
                data-host-page={index}
                style={{
                  flex: spread.length > 1 ? "1 1 50%" : "1 1 100%",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <img
                  src={request?.src}
                  alt={"Page " + String(index + 1) + (label === "" ? "" : " (" + label + ")")}
                  decoding="async"
                  onLoad={() => {
                    engine.reportPageLoaded(page.id);
                  }}
                  onError={() => {
                    engine.reportPageLoadFailed(
                      page.id,
                      IMAGE_LOAD_FAILED,
                      "Page " + String(index + 1) + " reported a load error",
                    );
                  }}
                  style={{
                    display: "block",
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      {zoneOverlay ? <HostZoneOverlay engine={engine} /> : null}
      {boundarySlot === undefined || boundarySlot === null ? null : (
        <div data-host-boundary="" style={BOUNDARY_STYLE}>
          {boundarySlot}
        </div>
      )}
      {hud ? <HostHud engine={engine} total={pages.length} /> : null}
      <div role="status" aria-live="polite" aria-atomic="true" style={VISUALLY_HIDDEN}>
        {"Page " + String(state.pageIndex + 1) + " of " + String(pages.length)}
      </div>
    </div>
  );
}

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

const BOUNDARY_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0, 0, 0, 0.72)",
};

/** Draws the active zone map straight from engine state, which is the shape a
 * host configuration dialog would read. */
function HostZoneOverlay({ engine }: { engine: MekuriEngine }): ReactElement {
  const state = useEngineState(engine);
  return (
    <div
      data-host-zone-overlay=""
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {state.activeZoneMap.zones.map((zone) => (
        <div
          key={zone.id}
          data-host-zone={zone.id}
          style={{
            position: "absolute",
            left: String(zone.bounds.x * 100) + "%",
            top: String(zone.bounds.y * 100) + "%",
            width: String(zone.bounds.width * 100) + "%",
            height: String(zone.bounds.height * 100) + "%",
            border: "1px dashed #d92b2b",
            color: "#d92b2b",
            fontSize: 11,
          }}
        >
          {zone.id}
        </div>
      ))}
    </div>
  );
}

function HostHud({ engine, total }: { engine: MekuriEngine; total: number }): ReactElement {
  const state = useEngineState(engine);
  const bounds = engine.getZoomBounds();
  return (
    <div className="host-hud" hidden={!state.isHUDVisible}>
      <button type="button" onClick={() => engine.prev()}>
        prev
      </button>
      <span className="host-hud-readout">
        {String(state.pageIndex + 1) + " / " + String(total)}
      </span>
      <button type="button" onClick={() => engine.next()}>
        next
      </button>
      <button
        type="button"
        disabled={state.zoomScale <= bounds.min}
        onClick={() => engine.zoomOut()}
      >
        zoom out
      </button>
      <button type="button" onClick={() => engine.resetZoom()}>
        {state.zoomScale.toFixed(2) + "x"}
      </button>
      <button
        type="button"
        disabled={state.zoomScale >= bounds.max}
        onClick={() => engine.zoomIn()}
      >
        zoom in
      </button>
    </div>
  );
}
