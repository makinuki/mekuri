// Accessibility primitives shared by the prebuilt views. The page status is a
// polite live region announcing the reading position, and the alt labeler is
// the single place a host localizes both an image description and that
// announcement.

import type { CSSProperties, ReactElement } from "react";
import type { MekuriViewEngine } from "../engine/store";
import type { MekuriPage } from "../engine/types";
import { useEngineState } from "./use-engine-state";

/** Describes a page for assistive technology. */
export type MekuriAltLabeler = (page: MekuriPage, index: number) => string;

/** Default page description, per the view contract. */
export const defaultAltLabeler: MekuriAltLabeler = (_page, index) => `Page ${index + 1}`;

/** Style that keeps a node in the accessibility tree while rendering it off
 * screen. Views without a stylesheet keep announcing with this in place. */
export const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

export interface MekuriPageStatusProps {
  engine: MekuriViewEngine;
  pages: MekuriPage[];
  altLabeler?: MekuriAltLabeler;
  /** Formats the announcement. Defaults to the page description followed by
   * the page count, for example "Page 4 of 180". */
  formatStatus?: (label: string, index: number, total: number) => string;
}

/** Announcement for the current position. The region is always mounted once
 * the view has pages, because a live region only announces changes that happen
 * while it exists. */
export function MekuriPageStatus({
  engine,
  pages,
  altLabeler = defaultAltLabeler,
  formatStatus = defaultFormatStatus,
}: MekuriPageStatusProps): ReactElement {
  const state = useEngineState(engine);
  if (pages.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-mekuri-status=""
        style={VISUALLY_HIDDEN_STYLE}
      />
    );
  }
  const index = Math.max(0, Math.min(state.pageIndex, pages.length - 1));
  const page = pages[index];
  const label = page === undefined ? `Page ${index + 1}` : altLabeler(page, index);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-mekuri-status=""
      style={VISUALLY_HIDDEN_STYLE}
    >
      {formatStatus(label, index, state.totalPages)}
    </div>
  );
}

export function defaultFormatStatus(label: string, _index: number, total: number): string {
  return `${label} of ${total}`;
}
