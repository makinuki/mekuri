// HUD primitives. The HUD renders engine state as data attributes and controls
// that dispatch engine actions; it owns no reader logic of its own. Controls
// are at least 44 by 44 pixels, carry an accessible name, and take their focus
// outline from the shipped stylesheet. Hiding the HUD returns focus to the
// reading surface, so a keyboard user is never left with focus on a control
// that no longer exists.

import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import type { MekuriViewEngine } from "../engine/store";
import type { MekuriPage, MekuriZoneMap } from "../engine/types";
import { MekuriPageStatus, type MekuriAltLabeler } from "./a11y";
import { useEngineState } from "./use-engine-state";

/** Minimum touch target, in pixels, for every interactive control. */
export const MIN_TOUCH_TARGET_PX = 44;

export interface MekuriHudButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Control identifier, surfaced as the data-mekuri-control attribute so a
   * host stylesheet can address one control without relying on order. */
  control: string;
  /** Accessible name of the control, and its visible label unless icon
   * replaces the label. */
  label: string;
  /** Replaces the visible label. The accessible name stays the label. */
  icon?: ReactNode;
}

export function MekuriHudButton({
  control,
  label,
  icon,
  style,
  type,
  ...rest
}: MekuriHudButtonProps): ReactElement {
  return (
    <button
      {...rest}
      type={type ?? "button"}
      data-mekuri-control={control}
      aria-label={label}
      style={{ minWidth: MIN_TOUCH_TARGET_PX, minHeight: MIN_TOUCH_TARGET_PX, ...style }}
    >
      {icon ?? label}
    </button>
  );
}

export interface MekuriHUDProps {
  engine: MekuriViewEngine;
  pages: MekuriPage[];
  altLabeler?: MekuriAltLabeler;
  /** Formats the status announcement; see MekuriPageStatus. */
  formatStatus?: (label: string, index: number, total: number) => string;
  /** Renders the zoom controls. Defaults to true. */
  zoomControls?: boolean;
  /** Renders the page status region. Defaults to true. */
  status?: boolean;
  /** Receives focus when the HUD hides, so focus never lands on a control the
   * host has removed. */
  focusTargetRef?: RefObject<HTMLElement | null>;
  /** Rendered before the navigation controls, for a host title or progress
   * control. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const HUD_STYLE: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexWrap: "wrap",
  gap: "var(--mekuri-hud-gap, 8px)",
  padding: "var(--mekuri-hud-gap, 8px)",
  paddingBottom: "calc(var(--mekuri-safe-area-bottom, 0px) + var(--mekuri-hud-gap, 8px))",
  // The HUD sits over the reading surface, inside a layer that does not accept
  // pointer events; the controls opt back in.
  pointerEvents: "auto",
};

/** Inline counterpart of the hidden attribute. The toolbar is laid out with
 * inline styles, which outrank both the user-agent rule behind the attribute
 * and any host stylesheet, so the hidden state has to be inline too. */
const HIDDEN_STYLE: CSSProperties = { display: "none" };

/** Reader control bar. Attributes expose the reading mode to a host
 * stylesheet, and every control dispatches an engine action. */
export function MekuriHUD({
  engine,
  pages,
  altLabeler,
  formatStatus,
  zoomControls = true,
  status = true,
  focusTargetRef,
  children,
  className,
  style,
}: MekuriHUDProps): ReactElement {
  const state = useEngineState(engine);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const bounds = engine.getZoomBounds();
  const zoomEnabled = bounds.max > 1;
  const canReset = state.zoomScale > 1;

  useHudFocusReturn(state.isHUDVisible, hudRef, focusTargetRef);

  return (
    <div
      ref={hudRef}
      data-mekuri-hud=""
      data-visible={state.isHUDVisible ? "true" : "false"}
      data-mode={state.mode}
      data-direction={state.direction}
      data-zoomed={state.isZoomLocked ? "true" : "false"}
      role="toolbar"
      aria-label="Reader controls"
      aria-orientation="horizontal"
      hidden={!state.isHUDVisible}
      className={className}
      style={{ ...HUD_STYLE, ...(state.isHUDVisible ? null : HIDDEN_STYLE), ...style }}
    >
      {children}
      <MekuriHudButton control="prev" label="Previous page" onClick={() => engine.prev()} />
      <MekuriHudButton control="next" label="Next page" onClick={() => engine.next()} />
      {zoomControls && zoomEnabled ? (
        <>
          <MekuriHudButton
            control="zoom-out"
            label="Zoom out"
            disabled={!canReset}
            onClick={() => engine.zoomOut()}
          />
          <MekuriHudButton
            control="zoom-reset"
            label="Reset zoom"
            disabled={!canReset}
            onClick={() => engine.resetZoom()}
          />
          <MekuriHudButton
            control="zoom-in"
            label="Zoom in"
            disabled={state.zoomScale >= bounds.max}
            onClick={() => engine.zoomIn()}
          />
        </>
      ) : null}
      <MekuriHudButton
        control="hud"
        label="Hide controls"
        onClick={() => engine.toggleHUD(false)}
      />
      {status ? (
        <MekuriPageStatus
          engine={engine}
          pages={pages}
          altLabeler={altLabeler}
          formatStatus={formatStatus}
        />
      ) : null}
    </div>
  );
}

export interface MekuriZoneOverlayProps {
  engine: MekuriViewEngine;
  /** Zone map to draw. Defaults to the map the engine dispatches, so a host
   * settings dialog can preview a preset that is not active yet. */
  zoneMap?: MekuriZoneMap;
  className?: string;
  style?: CSSProperties;
}

/** Inspectable zone geometry drawn over the reading surface. Decorative: the
 * overlay is hidden from assistive technology and never receives pointer
 * events, because the gesture layer owns the hit-test. */
export function MekuriZoneOverlay({
  engine,
  zoneMap,
  className,
  style,
}: MekuriZoneOverlayProps): ReactElement {
  const state = useEngineState(engine);
  const map = zoneMap ?? state.activeZoneMap;
  return (
    <div
      data-mekuri-zone-overlay=""
      aria-hidden="true"
      className={className}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", ...style }}
    >
      {map.zones.map((zone) => (
        <div
          key={zone.id}
          data-mekuri-zone={zone.id}
          data-action={zone.action}
          style={{
            position: "absolute",
            left: `${zone.bounds.x * 100}%`,
            top: `${zone.bounds.y * 100}%`,
            width: `${zone.bounds.width * 100}%`,
            height: `${zone.bounds.height * 100}%`,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px dashed var(--mekuri-accent, #6ea8ff)",
          }}
        >
          {zone.id}
        </div>
      ))}
    </div>
  );
}

/** Returns focus to the reading surface when the HUD hides. Focus moves only
 * when the HUD itself owned it, or when the browser dropped it to the document
 * body as the controls disappeared; focus held by another host control is left
 * alone. */
function useHudFocusReturn(
  isVisible: boolean,
  hudRef: RefObject<HTMLElement | null>,
  focusTargetRef: RefObject<HTMLElement | null> | undefined,
): void {
  const wasVisibleRef = useRef(isVisible);

  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = isVisible;
    if (isVisible || !wasVisible) return;
    const hud = hudRef.current;
    const doc = hud?.ownerDocument ?? globalDocument();
    if (doc === null) return;
    const active = doc.activeElement;
    const hudOwned = hud !== null && active !== null && hud.contains(active);
    if (!hudOwned && active !== null && active !== doc.body) return;
    focusTargetRef?.current?.focus();
  }, [focusTargetRef, isVisible]);
}

function globalDocument(): Document | null {
  return typeof document === "undefined" ? null : document;
}
