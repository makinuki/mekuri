// Default stylesheet for the prebuilt views. It ships as a string rather than
// an imported file, so the package keeps a single JavaScript entry per surface
// and a host that styles the views itself never loads it. Mount
// MekuriViewStyles once, or pass MEKURI_VIEW_CSS through the host build
// pipeline. Every value reads a --mekuri-* custom property first, with a
// fallback, so overriding the theme needs no rule rewrite.
//
// The stylesheet carries the two contracts inline styles cannot express on
// their own: the :focus-visible outline on interactive controls, and the
// prefers-reduced-motion override that removes transitions and animations
// inside a reader container.

import type { ReactElement } from "react";

/** Theme tokens a host may override on any ancestor of a reader container. */
export const MEKURI_THEME_TOKENS = [
  "--mekuri-bg",
  "--mekuri-fg",
  "--mekuri-hud-bg",
  "--mekuri-accent",
  "--mekuri-hud-gap",
  "--mekuri-hud-radius",
] as const;

export const MEKURI_VIEW_CSS = `[data-mekuri-container],
[data-mekuri-view] {
  --mekuri-bg: #101014;
  --mekuri-fg: #f5f5f7;
  --mekuri-hud-bg: rgba(16, 16, 20, 0.72);
  --mekuri-accent: #6ea8ff;
  --mekuri-hud-gap: 8px;
  --mekuri-hud-radius: 8px;
  background: var(--mekuri-bg);
  color: var(--mekuri-fg);
  padding-top: var(--mekuri-safe-area-top, 0px);
  padding-bottom: var(--mekuri-safe-area-bottom, 0px);
}

[data-mekuri-hud] {
  display: flex;
  align-items: center;
  gap: var(--mekuri-hud-gap);
  background: var(--mekuri-hud-bg);
  border-radius: var(--mekuri-hud-radius);
}

[data-mekuri-control] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--mekuri-hud-radius);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}

[data-mekuri-control]:focus-visible {
  outline: 2px solid var(--mekuri-accent);
  outline-offset: 2px;
}

[data-mekuri-status] {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

[data-mekuri-zone-overlay] {
  pointer-events: none;
}

[data-mekuri-boundary] {
  padding: calc(var(--mekuri-safe-area-top, 0px) + 16px) 16px
    calc(var(--mekuri-safe-area-bottom, 0px) + 16px);
}

[data-mekuri-paged-page] {
  display: flex;
  align-items: center;
  justify-content: center;
}

[data-mekuri-paged-page] img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

@media (prefers-reduced-motion: reduce) {
  [data-mekuri-container],
  [data-mekuri-container] *,
  [data-mekuri-container] *::before,
  [data-mekuri-container] *::after,
  [data-mekuri-view],
  [data-mekuri-view] *,
  [data-mekuri-view] *::before,
  [data-mekuri-view] *::after {
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
}
`;

/** Mounts the default stylesheet. Render once per document, above the reader.
 * Views keep their structural inline styles when this is absent, so the
 * default look is opt-in and a host stylesheet can replace it. */
export function MekuriViewStyles(): ReactElement {
  return <style data-mekuri-view-styles="">{MEKURI_VIEW_CSS}</style>;
}
