// The prebuilt surface: the shipped views rendered over the same engine every
// other lab surface uses.

import type { ReactElement, ReactNode } from "react";
import type { MekuriEngine, MekuriMode, MekuriPage } from "@makinuki/mekuri/engine";
import { PagedView, WebtoonView } from "@makinuki/mekuri/views";

export interface PrebuiltSurfaceProps {
  engine: MekuriEngine;
  pages: MekuriPage[];
  mode: MekuriMode;
  hud: boolean;
  zoneOverlay: boolean;
  boundarySlot: ReactNode;
}

export function PrebuiltSurface({
  engine,
  pages,
  mode,
  hud,
  zoneOverlay,
  boundarySlot,
}: PrebuiltSurfaceProps): ReactElement | null {
  if (pages.length === 0) return null;
  if (mode === "continuous-webtoon" || mode === "continuous-vertical") {
    return (
      <WebtoonView
        engine={engine}
        pages={pages}
        gap={mode === "continuous-vertical" ? 8 : 0}
        // The continuous column is capped at the fixture page width, so a
        // page of the sample series measures its natural height and the
        // browser suite can reach a later page with a fixed wheel delta.
        maxWidth={600}
        hud={hud}
        showZoneOverlay={zoneOverlay}
        boundarySlot={boundarySlot}
      />
    );
  }
  return (
    <PagedView
      engine={engine}
      pages={pages}
      hud={hud}
      showZoneOverlay={zoneOverlay}
      boundarySlot={boundarySlot}
    />
  );
}
