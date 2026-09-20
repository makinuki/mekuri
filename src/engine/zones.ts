// Tap zone preset data. Zones are pure geometry and action declarations;
// hit-testing and direction-aware dispatch live in the gesture layer.
import type { MekuriZoneMap } from "./types";

/** Default preset: left 30% previous, center 40% HUD toggle, right 30%
 * next, per the normalized bounds contract. */
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
