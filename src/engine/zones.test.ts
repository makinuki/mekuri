import { describe, expect, it } from "vite-plus/test";
import {
  customZoneMap,
  DEFAULT_MANGA_ZONE_MAP,
  DISABLED_ZONE_MAP,
  EDGE_ONLY_ZONE_MAP,
  hitTestZone,
  L_SHAPED_ZONE_MAP,
  normalizePoint,
  resolveZoneAction,
  swipePageAction,
  ZONE_MAP_PRESETS,
} from "./zones";
import type { MekuriZoneMap } from "./types";

describe("zone map presets", () => {
  it("exposes each preset as serializable inspectable data", () => {
    for (const [name, preset] of Object.entries(ZONE_MAP_PRESETS)) {
      expect(preset.name).toBe(name);
      expect(preset).toEqual(JSON.parse(JSON.stringify(preset)) as MekuriZoneMap);
      for (const zone of preset.zones) {
        const { x, y, width, height } = zone.bounds;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + width).toBeLessThanOrEqual(1);
        expect(y + height).toBeLessThanOrEqual(1);
      }
    }
  });

  it("splits the default preset into thirds around a HUD center", () => {
    expect(DEFAULT_MANGA_ZONE_MAP.zones.map((zone) => zone.action)).toEqual([
      "prev",
      "toggleHUD",
      "next",
    ]);
  });

  it("keeps the edge-only preset narrow and HUD-free", () => {
    expect(EDGE_ONLY_ZONE_MAP.zones.map((zone) => zone.action)).toEqual(["prev", "next"]);
    expect(EDGE_ONLY_ZONE_MAP.zones[0]?.bounds.width).toBe(0.2);
    expect(hitTestZone(EDGE_ONLY_ZONE_MAP, { x: 0.5, y: 0.5 })).toBeUndefined();
  });

  it("labels a custom map without touching the preset registry", () => {
    const map = customZoneMap([]);
    expect(map.name).toBe("custom");
    expect(ZONE_MAP_PRESETS["custom"]).toBeUndefined();
  });
});

describe("zone hit-testing", () => {
  it("returns the first declared zone when bounds overlap", () => {
    const map = customZoneMap([
      { id: "wide", action: "prev", bounds: { x: 0, y: 0, width: 0.6, height: 1 } },
      { id: "overlay", action: "toggleHUD", bounds: { x: 0.4, y: 0, width: 0.4, height: 1 } },
    ]);
    expect(hitTestZone(map, { x: 0.5, y: 0.5 })?.id).toBe("wide");
    expect(hitTestZone(map, { x: 0.7, y: 0.5 })?.id).toBe("overlay");
    expect(hitTestZone(map, { x: 0.9, y: 0.5 })).toBeUndefined();
  });

  it("resolves the L-shaped preset by declaration order", () => {
    expect(hitTestZone(L_SHAPED_ZONE_MAP, { x: 0.9, y: 0.05 })?.action).toBe("next");
    expect(hitTestZone(L_SHAPED_ZONE_MAP, { x: 0.5, y: 0.9 })?.action).toBe("next");
    expect(hitTestZone(L_SHAPED_ZONE_MAP, { x: 0.05, y: 0.5 })?.action).toBe("prev");
    expect(hitTestZone(L_SHAPED_ZONE_MAP, { x: 0.5, y: 0.1 })?.action).toBe("prev");
    expect(hitTestZone(L_SHAPED_ZONE_MAP, { x: 0.5, y: 0.5 })?.action).toBe("toggleHUD");
    expect(hitTestZone(L_SHAPED_ZONE_MAP, { x: 0.1, y: 0.95 })?.action).toBe("prev");
  });

  it("keeps the disabled preset inert everywhere", () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]) {
      expect(hitTestZone(DISABLED_ZONE_MAP, point)).toBeUndefined();
    }
  });

  it("resolves shared and outer edges deterministically", () => {
    // Adjacent zones share an edge, and the zone declared first takes it.
    expect(hitTestZone(DEFAULT_MANGA_ZONE_MAP, { x: 0.3, y: 0.5 })?.id).toBe("prev");
    expect(hitTestZone(DEFAULT_MANGA_ZONE_MAP, { x: 0.7, y: 0.5 })?.id).toBe("hud");
    // The outer edges of the surface belong to the outermost zones.
    expect(hitTestZone(DEFAULT_MANGA_ZONE_MAP, { x: 0, y: 0 })?.id).toBe("prev");
    expect(hitTestZone(DEFAULT_MANGA_ZONE_MAP, { x: 1, y: 1 })?.id).toBe("next");
  });
});

describe("point normalization", () => {
  it("maps a viewport coordinate into the unit square", () => {
    expect(
      normalizePoint({ x: 250, y: 150 }, { left: 0, top: 0, width: 1000, height: 300 }),
    ).toEqual({ x: 0.25, y: 0.5 });
    expect(
      normalizePoint({ x: 60, y: 60 }, { left: 40, top: 20, width: 200, height: 400 }),
    ).toEqual({ x: 0.1, y: 0.1 });
  });

  it("clamps a point on or past an edge so edge zones stay reachable", () => {
    const box = { left: 0, top: 0, width: 400, height: 600 };
    expect(normalizePoint({ x: 1400, y: -20 }, box)).toEqual({ x: 1, y: 0 });
    expect(normalizePoint({ x: -20, y: 700 }, box)).toEqual({ x: 0, y: 1 });
  });

  it("falls back to the origin for a box with no area", () => {
    expect(normalizePoint({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("direction resolution", () => {
  it("inverts the page-turn pair in RTL and leaves other actions alone", () => {
    expect(resolveZoneAction("next", "ltr")).toBe("next");
    expect(resolveZoneAction("prev", "ltr")).toBe("prev");
    expect(resolveZoneAction("next", "rtl")).toBe("prev");
    expect(resolveZoneAction("prev", "rtl")).toBe("next");
    expect(resolveZoneAction("toggleHUD", "rtl")).toBe("toggleHUD");
    expect(resolveZoneAction("none", "rtl")).toBe("none");
  });

  it("maps a horizontal drag past the threshold to one page turn", () => {
    expect(swipePageAction(-60, "ltr", 40)).toBe("next");
    expect(swipePageAction(60, "ltr", 40)).toBe("prev");
    expect(swipePageAction(60, "rtl", 40)).toBe("next");
    expect(swipePageAction(-60, "rtl", 40)).toBe("prev");
  });

  it("ignores a drag that does not clear the threshold", () => {
    expect(swipePageAction(-39, "ltr", 40)).toBeNull();
    expect(swipePageAction(0, "ltr", 40)).toBeNull();
  });
});
