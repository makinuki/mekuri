// HUD tests drive the control bar against a real engine. Every control is a
// button, so the tests use the same click and focus paths a host integration
// uses, and the engine state is asserted rather than the rendered markup alone.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { MekuriHUD, MekuriZoneOverlay, type MekuriHUDProps } from "./hud";
import { createMekuriEngine, type MekuriEngine, type MekuriEngineOptions } from "../engine/store";
import type { MekuriPage } from "../engine/types";
import { EDGE_ONLY_ZONE_MAP } from "../engine/zones";

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

const PAGES = pages(6);

interface Harness {
  engine: MekuriEngine;
  container: HTMLElement;
  surfaceRef: RefObject<HTMLDivElement | null>;
}

function renderHud(
  engineOptions: Partial<MekuriEngineOptions> = {},
  hudProps: Partial<MekuriHUDProps> = {},
): Harness {
  const hudPages = engineOptions.pages ?? PAGES;
  const engine = createMekuriEngine({ pages: hudPages, ...engineOptions });
  const surfaceRef = createRef<HTMLDivElement>();
  const { container } = render(
    <div>
      <div ref={surfaceRef} tabIndex={-1} data-mekuri-surface="" />
      <MekuriHUD engine={engine} pages={hudPages} focusTargetRef={surfaceRef} {...hudProps} />
    </div>,
  );
  return { engine, container, surfaceRef };
}

afterEach(cleanup);

function hud(container: HTMLElement): HTMLElement {
  const element = container.querySelector("[data-mekuri-hud]");
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

function control(container: HTMLElement, name: string): HTMLButtonElement | null {
  return container.querySelector(`[data-mekuri-control="${name}"]`);
}

function click(container: HTMLElement, name: string): void {
  const button = control(container, name);
  expect(button).not.toBeNull();
  fireEvent.click(button as HTMLButtonElement);
}

describe("MekuriHUD controls", () => {
  it("dispatches engine actions", () => {
    const { engine, container } = renderHud();

    act(() => click(container, "next"));
    expect(engine.getState().pageIndex).toBe(1);
    act(() => click(container, "prev"));
    expect(engine.getState().pageIndex).toBe(0);

    act(() => click(container, "zoom-in"));
    expect(engine.getState().zoomScale).toBe(1.5);
    act(() => click(container, "zoom-out"));
    expect(engine.getState().zoomScale).toBe(1);
    act(() => click(container, "zoom-in"));
    act(() => click(container, "zoom-reset"));
    expect(engine.getState().zoomScale).toBe(1);
  });

  it("hides the reader controls on request", () => {
    const { engine, container } = renderHud();
    act(() => click(container, "hud"));
    expect(engine.getState().isHUDVisible).toBe(false);
    expect(hud(container).getAttribute("data-visible")).toBe("false");
    expect(hud(container).hidden).toBe(true);
  });

  it("returns focus to the reading surface when it hides", () => {
    const { engine, container, surfaceRef } = renderHud();
    const nextButton = control(container, "next");
    nextButton?.focus();
    expect(document.activeElement).toBe(nextButton);

    act(() => engine.toggleHUD(false));

    expect(document.activeElement).toBe(surfaceRef.current);
  });

  it("leaves focus alone when another host control owns it", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { engine } = renderHud();

    act(() => engine.toggleHUD(false));

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("exposes the reading mode, direction, and zoom lock", () => {
    const { engine, container } = renderHud();
    const element = hud(container);
    expect(element.getAttribute("data-mode")).toBe("single");
    expect(element.getAttribute("data-direction")).toBe("ltr");
    expect(element.getAttribute("data-zoomed")).toBe("false");

    act(() => {
      engine.setMode("double");
      engine.setDirection("rtl");
      engine.setZoomScale(2);
    });

    expect(element.getAttribute("data-mode")).toBe("double");
    expect(element.getAttribute("data-direction")).toBe("rtl");
    expect(element.getAttribute("data-zoomed")).toBe("true");
  });

  it("sizes and names every control for touch and assistive technology", () => {
    const { container } = renderHud();
    const buttons = [...container.querySelectorAll("[data-mekuri-control]")];
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      const element = button as HTMLElement;
      expect(element.dataset.mekuriControl).toBeTruthy();
      expect(element.style.minWidth).toBe("44px");
      expect(element.style.minHeight).toBe("44px");
      expect(element.getAttribute("aria-label")).not.toBe(null);
    }
  });

  it("drops the zoom controls when zoom is unavailable and disables them at the limits", () => {
    const locked = renderHud({ maxZoomScale: 1 });
    expect(control(locked.container, "zoom-in")).toBeNull();
    expect(control(locked.container, "zoom-out")).toBeNull();

    const { engine, container } = renderHud();
    expect(control(container, "zoom-in")?.disabled).toBe(false);
    expect(control(container, "zoom-out")?.disabled).toBe(true);
    expect(control(container, "zoom-reset")?.disabled).toBe(true);

    act(() => engine.setZoomScale(4));
    expect(control(container, "zoom-in")?.disabled).toBe(true);
    expect(control(container, "zoom-out")?.disabled).toBe(false);
    expect(control(container, "zoom-reset")?.disabled).toBe(false);
  });

  it("renders host children before the controls", () => {
    const { container } = renderHud({}, { children: <span data-testid="title">Chapter 12</span> });
    const element = hud(container);
    expect(element.firstElementChild?.textContent).toBe("Chapter 12");
  });
});

describe("MekuriPageStatus announcements", () => {
  it("announces the position politely and follows it", () => {
    const { engine, container } = renderHud();
    const status = container.querySelector("[data-mekuri-status]");
    expect(status).not.toBeNull();
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(status?.textContent).toBe("Page 1 of 6");

    act(() => engine.goToIndex(3));
    expect(status?.textContent).toBe("Page 4 of 6");
  });

  it("uses the host labeler and formatter", () => {
    const { container } = renderHud(
      {},
      {
        altLabeler: (_page, index) => `Side ${index + 1}`,
        formatStatus: (label, _index, total) => `${label} (${total})`,
      },
    );
    expect(container.querySelector("[data-mekuri-status]")?.textContent).toBe("Side 1 (6)");
  });

  it("stays mounted and silent without pages", () => {
    const { container } = renderHud({ pages: [] }, { status: true });
    expect(container.querySelector("[data-mekuri-status]")).not.toBeNull();
    expect(container.querySelector("[data-mekuri-status]")?.textContent).toBe("");
  });

  it("can be dropped by the host", () => {
    const { container } = renderHud({}, { status: false });
    expect(container.querySelector("[data-mekuri-status]")).toBeNull();
  });
});

describe("MekuriZoneOverlay", () => {
  it("draws the active zone geometry as inspectable, decorative data", () => {
    const engine = createMekuriEngine({ pages: PAGES });
    const { container } = render(<MekuriZoneOverlay engine={engine} />);

    const overlay = container.querySelector("[data-mekuri-zone-overlay]");
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect((overlay as HTMLElement).style.pointerEvents).toBe("none");

    const zones = [...container.querySelectorAll("[data-mekuri-zone]")];
    expect(zones.map((zone) => zone.getAttribute("data-action"))).toEqual([
      "prev",
      "toggleHUD",
      "next",
    ]);
    expect((zones[2] as HTMLElement).style.left).toBe("70%");
    expect((zones[2] as HTMLElement).style.width).toBe("30%");
  });

  it("previews a preset that is not active", () => {
    const engine = createMekuriEngine({ pages: PAGES });
    const { container } = render(
      <MekuriZoneOverlay engine={engine} zoneMap={EDGE_ONLY_ZONE_MAP} />,
    );
    expect(container.querySelectorAll("[data-mekuri-zone]")).toHaveLength(2);
  });
});
