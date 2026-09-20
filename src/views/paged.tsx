// PagedView: the single and double page surface, rendered from engine state.
// The view owns layout only; the reading position, spread grouping, zoom
// bounds, failure registry, and zone map all belong to the engine, and the
// surface wiring attaches the pointer and keyboard layers in the shape the
// default host consumes.
//
// Interface contract for this file:
// - The reading direction is expressed with the dir attribute, so a double
//   spread places the first page of the reading order at the start edge (the
//   right edge in RTL) while the DOM keeps reading order for assistive
//   technology.
// - The zoom matrix belongs to the gesture layer, which writes it onto the
//   transform target. The view re-applies the engine scale through the wiring
//   hook and never writes a transform of its own.
// - Page boxes carry their pipeline state in data-mekuri-src-state, matching
//   the continuous view: "ready", "pending", or "failed".
// - Host content for a held chapter boundary is rendered through
//   boundarySlot. The engine holds the position and reports the boundary
//   through onBoundaryReached; the view only provides the mount point.

import { useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { IMAGE_LOAD_FAILED } from "../engine/pipeline";
import { alignToSpread } from "../engine/spreads";
import type { MekuriEngine } from "../engine/store";
import type { MekuriPage, MekuriState } from "../engine/types";
import { defaultAltLabeler, type MekuriAltLabeler } from "./a11y";
import { MekuriHUD, MekuriZoneOverlay } from "./hud";
import { useMekuriSurface, type MekuriSurfaceOptions } from "./surface";
import { useEngineState } from "./use-engine-state";

export interface PagedViewProps {
  engine: MekuriEngine;
  pages: MekuriPage[];
  /** Renders one page body. Defaults to the source image of the page. */
  renderPage?: (page: MekuriPage, index: number) => ReactNode;
  /** Describes a page to assistive technology; also labels the status
   * announcement. Defaults to "Page {index + 1}". */
  altLabeler?: MekuriAltLabeler;
  /** Formats the status announcement. Defaults to "<label> of <total>". */
  formatStatus?: (label: string, index: number, total: number) => string;
  /** Renders the default HUD. Defaults to true. */
  hud?: boolean;
  /** Rendered over the surface while the host holds at a chapter boundary. */
  boundarySlot?: ReactNode;
  /** Draws the active zone geometry for host configuration previews.
   * Defaults to false. */
  showZoneOverlay?: boolean;
  className?: string;
  style?: CSSProperties;
  gestureOptions?: MekuriSurfaceOptions["gestureOptions"];
  keyboardOptions?: MekuriSurfaceOptions["keyboardOptions"];
}

/** Spread containing the reading position. */
function currentSpread(state: MekuriState): number[] {
  const spreads = state.activeSpreads;
  if (spreads.length === 0) return [];
  const start = alignToSpread(state.pageIndex, spreads);
  for (const spread of spreads) {
    if (spread[0] === start) return spread;
  }
  return [state.pageIndex];
}

export function PagedView({
  engine,
  pages,
  renderPage,
  altLabeler = defaultAltLabeler,
  formatStatus,
  hud = true,
  boundarySlot,
  showZoneOverlay = false,
  className,
  style,
  gestureOptions,
  keyboardOptions,
}: PagedViewProps): ReactElement | null {
  const state = useEngineState(engine);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<HTMLDivElement | null>(null);
  const requestedRef = useRef(new Map<string | number, number>());
  const containerBindings = engine.getContainerProps();
  const viewportBindings = engine.getViewportProps();
  const spread = currentSpread(state);

  useMekuriSurface({
    engine,
    surfaceRef,
    transformRef,
    zoomScale: state.zoomScale,
    gestureOptions,
    keyboardOptions,
  });

  // Resolves the sources the surface can reach: the pages of the current
  // spread and the preload window around it, so a page turn finds its source
  // already resolved. The effect runs after every render because the spread is
  // read during render; the recorded attempt is what stops a resolved page
  // from being requested again.
  useEffect(() => {
    if (renderPage !== undefined) return;
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
      data-mekuri-paged=""
      data-mode={state.mode}
      data-direction={state.direction}
      data-zoomed={state.isZoomLocked ? "true" : "false"}
      data-hud-visible={state.isHUDVisible ? "true" : "false"}
      dir={state.direction}
      className={className}
      style={{ ...containerBindings.style, overflow: "hidden", ...style }}
    >
      <div
        {...viewportBindings}
        ref={surfaceRef}
        role="region"
        aria-label="Reader viewport"
        tabIndex={-1}
        style={{
          ...viewportBindings.style,
          width: "100%",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <div
          ref={transformRef}
          data-mekuri-transform=""
          style={{ width: "100%", height: "100%", display: "flex", alignItems: "stretch" }}
        >
          {spread.map((index, position) => {
            const page = pages[index];
            if (page === undefined) return null;
            const request = renderPage === undefined ? engine.getPageRequest(page.id) : undefined;
            const src = request?.src;
            const srcState =
              request?.failure !== undefined ? "failed" : src === undefined ? "pending" : "ready";
            return (
              <div
                key={page.id}
                data-mekuri-paged-page=""
                data-mekuri-page=""
                data-index={index}
                data-mekuri-spread-position={position}
                data-mekuri-src-state={srcState}
                style={{
                  flex: spread.length > 1 ? "1 1 50%" : "1 1 100%",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {renderPage !== undefined ? (
                  renderPage(page, index)
                ) : (
                  <img
                    key={`${page.id}:${request?.attempt ?? 0}`}
                    src={src}
                    alt={altLabeler(page, index)}
                    decoding="async"
                    onLoad={() => {
                      engine.reportPageLoaded(page.id);
                    }}
                    onError={() => {
                      engine.reportPageLoadFailed(
                        page.id,
                        IMAGE_LOAD_FAILED,
                        `Page ${index + 1} reported a load error`,
                      );
                    }}
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      maxHeight: "100%",
                      objectFit: "contain",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        {showZoneOverlay ? <MekuriZoneOverlay engine={engine} /> : null}
      </div>
      {/* The mount point exists only while the host has content for it: an
          empty overlay would cover the surface and take every tap. */}
      {boundarySlot === undefined || boundarySlot === null ? null : (
        <div
          data-mekuri-boundary=""
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {boundarySlot}
        </div>
      )}
      {hud ? (
        <MekuriHUD
          engine={engine}
          pages={pages}
          altLabeler={altLabeler}
          formatStatus={formatStatus}
          focusTargetRef={surfaceRef}
        />
      ) : null}
    </div>
  );
}
