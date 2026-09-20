// Shared Mekuri engine types. It must never import React or reference DOM
// globals so the engine stays usable in non-browser environments.

export type MekuriMode = "continuous-webtoon" | "continuous-vertical" | "single" | "double";

export type MekuriDirection = "ltr" | "rtl";

export type ChapterBoundary = "start" | "end";

export interface MekuriPage {
  id: string | number;
  /** Intrinsic pixel width, when known. Enables zero-CLS layout. */
  width?: number;
  /** Intrinsic pixel height, when known. Enables zero-CLS layout. */
  height?: number;
  /** Precomputed width/height ratio, used when pixel dimensions are absent. */
  aspectRatio?: number;
  /** Opaque host-attached metadata. The engine never interprets it. */
  metadata?: Record<string, unknown>;
}

export interface MekuriSpreadConfig {
  /** When true, the first page renders alone and pairing starts at page 2. */
  firstPageIsCover: boolean;
  /** Pages with a known aspect ratio strictly above this value are isolated
   * onto their own spread. */
  landscapeThreshold: number;
}

export const DEFAULT_SPREAD_CONFIG: MekuriSpreadConfig = {
  firstPageIsCover: true,
  landscapeThreshold: 1.2,
};

export type MekuriZoneAction = "next" | "prev" | "toggleHUD" | "none";

export interface MekuriZone {
  id: string;
  action: MekuriZoneAction;
  /** Normalized bounding box within the viewport, each axis in [0, 1]. */
  bounds: { x: number; y: number; width: number; height: number };
}

export type MekuriZoneMapName = "default-manga" | "edge-only" | "l-shaped" | "disabled" | "custom";

export interface MekuriZoneMap {
  name: MekuriZoneMapName;
  /** Hit-tested in declaration order; the first matching zone wins. */
  zones: MekuriZone[];
}

/** Keyboard bindings as KeyboardEvent.code strings, exported as inspectable
 * data so hosts can render and rebind them. Dispatch applies RTL inversion. */
export interface MekuriKeyboardMap {
  nextPage: string[];
  prevPage: string[];
  toggleHUD: string[];
  zoomIn: string[];
  zoomOut: string[];
  resetZoom: string[];
}

export interface MekuriFailureRecord {
  /** Number of attempts made, including auto-retries, before escalation. */
  attempt: number;
  /** Pipeline stage that produced the failure. */
  stage: "resolve" | "load";
  /** Machine-readable error code, stable for host-side matching. */
  code: string;
  /** Human-readable detail. Diagnostic only; never parsed. */
  message: string;
}

/** The state subset a host may set in controlled mode. Everything else in
 * MekuriState is engine-derived and read-only. */
export interface MekuriControlledState {
  pageIndex: number;
  mode: MekuriMode;
  direction: MekuriDirection;
  zoomScale: number;
  spreadConfig: MekuriSpreadConfig;
}

/** Values the engine computes internally. Hosts consume them but never set
 * them; they are mirrored into MekuriState for convenience only. */
export interface MekuriDerivedState {
  totalPages: number;
  /** Grouped page indices, each inner array one spread, ascending and
   * contiguous with 0-based indices. */
  activeSpreads: number[][];
  /** True while zoom scale exceeds 1.0 and page navigation is locked. */
  isZoomLocked: boolean;
  isHUDVisible: boolean;
  activeZoneMap: MekuriZoneMap;
  failures: Record<string | number, MekuriFailureRecord>;
}

export type MekuriState = MekuriControlledState & MekuriDerivedState;
