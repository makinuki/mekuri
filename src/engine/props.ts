// Typed DOM prop bindings for host containers and scroll viewports. The
// builders are DOM-free and dependency-free: they return plain attribute
// records that the React binding and the prebuilt views spread onto their
// elements, so attribute and dead-zone ownership stays in one place.

import type { MekuriMode } from "./types";

export type MekuriTouchAction = "auto" | "none" | "pan-y";

/** Attributes for the element hosting the reading surface. The container is
 * the positioning context for the viewport; it never scrolls by itself. */
export interface MekuriContainerProps {
  readonly "data-mekuri-container": "true";
  readonly style: {
    readonly position: "relative";
    readonly width: "100%";
    readonly height: "100%";
  };
}

/** Attributes for the scrolling viewport. Edge dead-zones are enforced here:
 * overscroll chaining is contained and the refused axes never reach the host
 * page or the operating system navigation gestures. */
export interface MekuriViewportProps {
  readonly "data-mekuri-viewport": MekuriMode;
  readonly style: {
    readonly position: "relative";
    readonly overflowX: "hidden";
    readonly overflowY: "auto";
    readonly overscrollBehavior: "contain";
    readonly touchAction: MekuriTouchAction;
  };
}

export function containerProps(): MekuriContainerProps {
  return {
    "data-mekuri-container": "true",
    style: { position: "relative", width: "100%", height: "100%" },
  };
}

/** Continuous modes keep native vertical panning and refuse the horizontal
 * axis; paged modes and any active zoom refuse both axes, because the gesture
 * layer owns the pointer stream and constrains movement to the transform
 * matrix there. */
export function viewportProps(mode: MekuriMode, isZoomLocked: boolean): MekuriViewportProps {
  const isContinuous = mode === "continuous-webtoon" || mode === "continuous-vertical";
  return {
    "data-mekuri-viewport": mode,
    style: {
      position: "relative",
      overflowX: "hidden",
      overflowY: "auto",
      overscrollBehavior: "contain",
      touchAction: !isZoomLocked && isContinuous ? "pan-y" : "none",
    },
  };
}
