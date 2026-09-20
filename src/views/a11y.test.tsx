// Accessibility audit for the view primitives. The checks mirror the audit a
// host would run against rendered markup: accessible names on every
// interactive element, image descriptions, minimum touch targets, no positive
// tab order, no focusable content inside a hidden subtree, one polite status
// region, and the focus and reduced-motion rules the shipped stylesheet
// carries. The audit is itself checked against a deliberately broken tree, so
// a clean result means something.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { MIN_TOUCH_TARGET_PX, MekuriHUD } from "./hud";
import { PagedView } from "./paged";
import { MEKURI_THEME_TOKENS, MEKURI_VIEW_CSS, MekuriViewStyles } from "./styles";
import { WebtoonView } from "./webtoon";
import { createMekuriEngine } from "../engine/store";
import type { MekuriPage } from "../engine/types";
import { mockResizeObserver, type MockResizeObserverHandle } from "../test-utils/observers";
import { mockScrollGeometry } from "../test-utils/viewport";

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

const PAGES = pages(6);
const FOCUSABLE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function accessibleName(element: Element): string {
  const label = element.getAttribute("aria-label");
  if (label !== null && label.trim() !== "") return label.trim();
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
      .join(" ")
      .trim();
    if (text !== "") return text;
  }
  const text = (element.textContent ?? "").trim();
  if (text !== "") return text;
  return (element.getAttribute("title") ?? "").trim();
}

function describeElement(element: Element): string {
  const control = element.getAttribute("data-mekuri-control");
  const suffix = control === null ? "" : ` data-mekuri-control="${control}"`;
  return `<${element.tagName.toLowerCase()}${suffix}>`;
}

function audit(root: HTMLElement): string[] {
  const problems: string[] = [];

  for (const button of root.querySelectorAll("button")) {
    if (button.getAttribute("aria-hidden") === "true") continue;
    if (accessibleName(button) === "") {
      problems.push(`unnamed control: ${describeElement(button)}`);
    }
  }

  for (const image of root.querySelectorAll("img")) {
    const alt = image.getAttribute("alt");
    if (alt === null || alt.trim() === "") {
      problems.push(`undescribed image: ${describeElement(image)}`);
    }
  }

  for (const control of root.querySelectorAll("[data-mekuri-control]")) {
    const element = control as HTMLElement;
    const height = Number.parseFloat(element.style.minHeight);
    const width = Number.parseFloat(element.style.minWidth);
    if (!(height >= MIN_TOUCH_TARGET_PX) || !(width >= MIN_TOUCH_TARGET_PX)) {
      problems.push(`touch target below 44px: ${describeElement(control)}`);
    }
  }

  for (const element of root.querySelectorAll("[tabindex]")) {
    const value = Number(element.getAttribute("tabindex"));
    if (Number.isFinite(value) && value > 0) {
      problems.push(`positive tab order: ${describeElement(element)} (${value})`);
    }
  }

  for (const hidden of root.querySelectorAll("[aria-hidden='true']")) {
    if (hidden.querySelectorAll(FOCUSABLE).length > 0) {
      problems.push(`focusable content in a hidden subtree: ${describeElement(hidden)}`);
    }
  }

  const toolbar = root.querySelector("[role='toolbar']");
  if (toolbar !== null && accessibleName(toolbar) === "") problems.push("unnamed toolbar");

  for (const region of root.querySelectorAll("[role='region'], [role='group']")) {
    if (accessibleName(region) === "") problems.push(`unnamed region: ${describeElement(region)}`);
  }

  for (const status of root.querySelectorAll("[data-mekuri-status]")) {
    if (status.getAttribute("role") !== "status") problems.push("page status is not a region");
    if (status.getAttribute("aria-live") !== "polite") {
      problems.push("page status is not a polite live region");
    }
    if (status.getAttribute("aria-atomic") !== "true") {
      problems.push("page status is not atomic");
    }
  }

  const seen = new Set<string>();
  for (const element of root.querySelectorAll("[id]")) {
    const id = element.getAttribute("id") as string;
    if (seen.has(id)) problems.push(`duplicate id: ${id}`);
    seen.add(id);
  }

  return problems;
}

let geometry: { restore(): void } | null = null;

afterEach(() => {
  cleanup();
  geometry?.restore();
  geometry = null;
});

describe("view accessibility audit", () => {
  it("finds no violations in the paged view", async () => {
    const engine = createMekuriEngine({
      pages: PAGES,
      resolveSrc: (page) => `https://example.test/pages/${page.id}.jpg`,
    });
    const { container } = render(<PagedView engine={engine} pages={PAGES} showZoneOverlay />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(audit(container)).toEqual([]);
  });

  it("finds no violations in the webtoon view", () => {
    const restoreGeometry = mockScrollGeometry({ viewportHeight: 600, pageHeight: 1000 });
    const resize: MockResizeObserverHandle = mockResizeObserver();
    geometry = {
      restore() {
        resize.restore();
        restoreGeometry();
      },
    };
    const engine = createMekuriEngine({
      pages: PAGES,
      initialState: { mode: "continuous-webtoon" },
    });
    const { container } = render(<WebtoonView engine={engine} pages={PAGES} />);
    act(() => resize.fireAll(() => 1000));

    expect(audit(container)).toEqual([]);
  });

  it("finds no violations in a standalone HUD", () => {
    const engine = createMekuriEngine({ pages: PAGES });
    const { container } = render(<MekuriHUD engine={engine} pages={PAGES} />);
    expect(audit(container)).toEqual([]);
  });

  it("catches a deliberately broken tree", () => {
    const { container } = render(
      <div>
        <button
          data-mekuri-control="next"
          style={{ minWidth: MIN_TOUCH_TARGET_PX - 24, minHeight: MIN_TOUCH_TARGET_PX - 24 }}
        />
        <img src="https://example.test/undescribed.jpg" />
        <div aria-hidden="true">
          <button aria-label="Hidden" />
        </div>
        <span tabIndex={3} />
      </div>,
    );

    const problems = audit(container);
    expect(problems.some((problem) => problem.startsWith("unnamed control"))).toBe(true);
    expect(problems.some((problem) => problem.startsWith("undescribed image"))).toBe(true);
    expect(problems.some((problem) => problem.startsWith("touch target below 44px"))).toBe(true);
    expect(problems.some((problem) => problem.startsWith("focusable content"))).toBe(true);
    expect(problems.some((problem) => problem.startsWith("positive tab order"))).toBe(true);
  });
});

describe("shipped stylesheet", () => {
  it("styles the focus ring and the reduced-motion preference", () => {
    expect(MEKURI_VIEW_CSS).toContain(":focus-visible");
    expect(MEKURI_VIEW_CSS).toContain("outline: 2px solid var(--mekuri-accent)");
    expect(MEKURI_VIEW_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(MEKURI_VIEW_CSS).toContain("transition-duration: 0.01ms !important");
    expect(MEKURI_VIEW_CSS).not.toContain("outline: none");
    expect(MEKURI_VIEW_CSS).not.toContain("outline: 0");
  });

  it("sizes the controls and keeps the status region out of sight", () => {
    expect(MEKURI_VIEW_CSS).toContain("min-width: 44px");
    expect(MEKURI_VIEW_CSS).toContain("min-height: 44px");
    expect(MEKURI_VIEW_CSS).toContain("[data-mekuri-status]");
    expect(MEKURI_VIEW_CSS).toContain("clip-path: inset(50%)");
  });

  it("declares the theme tokens it exposes", () => {
    for (const token of MEKURI_THEME_TOKENS) {
      expect(MEKURI_VIEW_CSS).toContain(`${token}:`);
    }
  });

  it("mounts through the styles component", () => {
    const { container } = render(<MekuriViewStyles />);
    const style = container.querySelector("style[data-mekuri-view-styles]");
    expect(style?.textContent).toContain("@media (prefers-reduced-motion: reduce)");
    expect(style?.textContent).toContain("[data-mekuri-hud]");
  });
});
