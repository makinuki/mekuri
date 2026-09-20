// One lab stage owns one engine. The stage is remounted when the chapter or the
// surface changes, so a new chapter starts from a fresh engine at page zero.

import type { ReactElement, ReactNode } from "react";
import type {
  ChapterBoundary,
  MekuriDirection,
  MekuriMode,
  MekuriPage,
  MekuriSpreadConfig,
} from "@makinuki/mekuri/engine";
import { HostSurface } from "./HostSurface";
import { Inspector } from "./Inspector";
import { PrebuiltSurface } from "./PrebuiltSurface";
import { useLabEngine } from "./use-lab-engine";

export type LabSurface = "prebuilt" | "host";

export interface StageProps {
  surface: LabSurface;
  pages: MekuriPage[];
  mode: MekuriMode;
  direction: MekuriDirection;
  spreadConfig: MekuriSpreadConfig;
  hud: boolean;
  zoneOverlay: boolean;
  boundarySlot: ReactNode;
  onBoundaryReached: (boundary: ChapterBoundary) => void;
}

export function Stage(props: StageProps): ReactElement {
  const { surface, pages, mode, direction, spreadConfig, hud, zoneOverlay, boundarySlot } = props;
  const engine = useLabEngine({
    pages,
    mode,
    direction,
    spreadConfig,
    onBoundaryReached: props.onBoundaryReached,
  });
  const shared = { engine, pages, hud, boundarySlot, zoneOverlay };
  return (
    <div className="stage">
      <div className="reader">
        {pages.length === 0 ? (
          <p className="empty">No pages loaded.</p>
        ) : surface === "prebuilt" ? (
          <PrebuiltSurface {...shared} mode={mode} />
        ) : (
          <HostSurface {...shared} />
        )}
      </div>
      <Inspector engine={engine} />
    </div>
  );
}
