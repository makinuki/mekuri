// Tap zone presets, hit-testing, and direction resolution. Zones are pure
// geometry and action declarations, so hosts can render configuration dialogs
// and preview overlays from the same data the reader dispatches. Hit-testing is
// deterministic: zones are evaluated in declaration order and the first match
// wins, which is what makes overlapping presets such as the L-shaped map
// well-defined.

import type {
  MekuriDirection,
  MekuriPoint,
  MekuriZone,
  MekuriZoneAction,
  MekuriZoneMap,
} from "./types";

export interface MekuriNormalizeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Default preset: left 30% previous, center 40% HUD toggle, right 30% next,
 * per the normalized bounds contract. */
export const DEFAULT_MANGA_ZONE_MAP: MekuriZoneMap = {
  name: "default-manga",
  zones: [
    { id: "prev", action: "prev", bounds: { x: 0, y: 0, width: 0.3, height: 1 } },
    {
      id: "hud",
      action: "toggleHUD",
      bounds: { x: 0.3, y: 0, width: 0.4, height: 1 },
    },
    {
      id: "next",
      action: "next",
      bounds: { x: 0.7, y: 0, width: 0.3, height: 1 },
    },
  ],
};

/** Narrow edge bands only: a reader that reserves the middle of the surface
 * for host content, with no HUD zone of its own. */
export const EDGE_ONLY_ZONE_MAP: MekuriZoneMap = {
  name: "edge-only",
  zones: [
    { id: "prev-edge", action: "prev", bounds: { x: 0, y: 0, width: 0.2, height: 1 } },
    { id: "next-edge", action: "next", bounds: { x: 0.8, y: 0, width: 0.2, height: 1 } },
  ],
};

/** Corner-free L-shaped preset: the side bands carry the page turns, the top
 * and bottom strips between them extend that same action along one edge so the
 * region reads as an L, and the center rectangle toggles the HUD. Declaration
 * order resolves the corners in favor of the side bands. */
export const L_SHAPED_ZONE_MAP: MekuriZoneMap = {
  name: "l-shaped",
  zones: [
    { id: "prev-side", action: "prev", bounds: { x: 0, y: 0, width: 0.25, height: 1 } },
    { id: "prev-strip", action: "prev", bounds: { x: 0.25, y: 0, width: 0.5, height: 0.25 } },
    { id: "next-side", action: "next", bounds: { x: 0.75, y: 0, width: 0.25, height: 1 } },
    { id: "next-strip", action: "next", bounds: { x: 0.25, y: 0.75, width: 0.5, height: 0.25 } },
    { id: "hud", action: "toggleHUD", bounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
  ],
};

/** Maps every interaction to nothing: taps reach no zone and never navigate. */
export const DISABLED_ZONE_MAP: MekuriZoneMap = { name: "disabled", zones: [] };

/** Presets by name, exported as inspectable data so a host settings dialog can
 * list and preview them without re-declaring the geometry. */
export const ZONE_MAP_PRESETS: Record<string, MekuriZoneMap> = {
  "default-manga": DEFAULT_MANGA_ZONE_MAP,
  "edge-only": EDGE_ONLY_ZONE_MAP,
  "l-shaped": L_SHAPED_ZONE_MAP,
  disabled: DISABLED_ZONE_MAP,
};

export function customZoneMap(zones: MekuriZone[]): MekuriZoneMap {
  return { name: "custom", zones };
}

/** Normalizes a viewport coordinate into the unit square of a box. Coordinates
 * are clamped to the box, so a touch that lands on or just past an edge still
 * resolves to the zone that covers that edge instead of falling through. */
export function normalizePoint(point: MekuriPoint, box: MekuriNormalizeBox): MekuriPoint {
  return {
    x: box.width > 0 ? clampUnit((point.x - box.left) / box.width) : 0,
    y: box.height > 0 ? clampUnit((point.y - box.top) / box.height) : 0,
  };
}

/** First zone in declaration order whose bounds contain the normalized point,
 * or undefined when the point falls in a gap between zones. */
export function hitTestZone(zoneMap: MekuriZoneMap, point: MekuriPoint): MekuriZone | undefined {
  for (const zone of zoneMap.zones) {
    const { x, y, width, height } = zone.bounds;
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) {
      return zone;
    }
  }
  return undefined;
}

/** Action to dispatch for a zone given the reading direction. A map declares
 * its actions in reading order, so RTL swaps the next/prev pair at dispatch
 * rather than requiring an RTL variant of every preset. */
export function resolveZoneAction(
  action: MekuriZoneAction,
  direction: MekuriDirection,
): MekuriZoneAction {
  if (direction !== "rtl") return action;
  if (action === "next") return "prev";
  if (action === "prev") return "next";
  return action;
}

/** Page turn a horizontal drag maps to, or null when the drag does not clear
 * the threshold. Dragging toward lower x advances in LTR and goes back in RTL,
 * matching the reading order the zone actions use. */
export function swipePageAction(
  deltaX: number,
  direction: MekuriDirection,
  thresholdPx: number,
): "next" | "prev" | null {
  if (Math.abs(deltaX) < thresholdPx) return null;
  const advances = direction === "rtl" ? deltaX > 0 : deltaX < 0;
  return advances ? "next" : "prev";
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
