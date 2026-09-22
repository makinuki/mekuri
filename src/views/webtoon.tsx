// WebtoonView: the continuous surface with the chrome the paged view also
// carries. The virtualized column, source detachment, and scroll semantics
// belong to ContinuousView; this component adds the HUD, the page status, the
// boundary mount point, and the keyboard layer, and exposes the zone preview.
//
// Pointer gestures are not attached here. Continuous modes keep native
// vertical scrolling, and the zoom matrix is defined for the paged surface, so
// a pinch over a webtoon column would transform a column the virtualizer
// measures. A host that wants zoom over a continuous column attaches the
// gesture layer itself, with a transform target it owns. The keyboard
// dispatcher attaches by default and detaches on host request, and both
// option bags match the paged surface.

import { useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { MekuriEngine } from "../engine/store";
import type { MekuriPage } from "../engine/types";
import { defaultAltLabeler, type MekuriAltLabeler } from "./a11y";
import { ContinuousView } from "./continuous";
import { MekuriHUD, MekuriZoneOverlay } from "./hud";
import { useMekuriSurface, type MekuriSurfaceOptions } from "./surface";
import { useEngineState } from "./use-engine-state";

export interface WebtoonViewProps {
  engine: MekuriEngine;
  pages: MekuriPage[];
  /** Width cap for the reading column. Defaults to full width. */
  maxWidth?: number | string;
  /** Vertical gap in pixels. Forced to 0 in webtoon mode. */
  gap?: number;
  /** Rendered items above and below the visible range. Defaults to 4. */
  overscan?: number;
  /** Estimated page height in pixels before the first measurement. */
  estimateSize?: number;
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
  /** Attaches the keyboard dispatcher. Defaults to true. */
  keyboard?: boolean;
  /** Accepted for parity with the paged surface; applied when a gesture layer
   * is attached. The view itself attaches none. */
  gestureOptions?: MekuriSurfaceOptions["gestureOptions"];
  keyboardOptions?: MekuriSurfaceOptions["keyboardOptions"];
}

export function WebtoonView({
  engine,
  pages,
  maxWidth,
  gap,
  overscan,
  estimateSize,
  renderPage,
  altLabeler = defaultAltLabeler,
  formatStatus,
  hud = true,
  boundarySlot,
  showZoneOverlay = false,
  className,
  style,
  keyboard = true,
  gestureOptions,
  keyboardOptions,
}: WebtoonViewProps): ReactElement | null {
  const state = useEngineState(engine);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useMekuriSurface({
    engine,
    surfaceRef: rootRef,
    gestures: false,
    keyboard,
    gestureOptions,
    keyboardOptions,
  });

  if (pages.length === 0) return null;

  return (
    <div
      ref={rootRef}
      data-mekuri-view="webtoon"
      data-mode={state.mode}
      data-direction={state.direction}
      data-zoomed={state.isZoomLocked ? "true" : "false"}
      data-hud-visible={state.isHUDVisible ? "true" : "false"}
      dir={state.direction}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        ...style,
      }}
    >
      <ContinuousView
        engine={engine}
        pages={pages}
        maxWidth={maxWidth}
        gap={gap}
        overscan={overscan}
        estimateSize={estimateSize}
        renderPage={renderPage}
      />
      {showZoneOverlay ? (
        <MekuriZoneOverlay engine={engine} style={{ position: "absolute", inset: 0 }} />
      ) : null}
      {/* See PagedView: an empty mount point would cover the reading surface
          and take every tap meant for the zone map. */}
      {boundarySlot === undefined || boundarySlot === null ? null : (
        <div
          data-mekuri-boundary=""
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // See PagedView: the container takes no pointer events, so taps
            // on empty areas reach the zone map.
            pointerEvents: "none",
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
          focusTargetRef={rootRef}
        />
      ) : null}
    </div>
  );
}
