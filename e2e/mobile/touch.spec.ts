// Touch and phone layout. This directory runs on the emulated Android project
// only: the rows assert taps, the one-viewport-height stage, and the coarse
// pointer sizing the phone layout provides.
//
// The pinch row uses the Chromium input domain to send a real two-finger
// gesture, because Playwright has no pinch API of its own.

import { expect, test, type Page } from "@playwright/test";
import {
  control,
  doubleTapFraction,
  expectState,
  hud,
  loadSample,
  openLab,
  reader,
  tapFraction,
  viewport,
} from "../support/lab";

async function pinchOpen(page: Page, from: number, to: number): Promise<void> {
  const session = await page.context().newCDPSession(page);
  const box = await viewport(page).boundingBox();
  if (box === null) throw new Error("the reading viewport has no box");
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const points = (spread: number) => [
    { x: centerX - spread / 2, y: centerY, radiusX: 5, radiusY: 5, force: 1, id: 1 },
    { x: centerX + spread / 2, y: centerY, radiusX: 5, radiusY: 5, force: 1, id: 2 },
  ];

  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
  for (const step of [0.34, 0.67, 1]) {
    const spread = from + (to - from) * step;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(spread),
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

test.describe("phone layout", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series");
  });

  test("gives the reader a full viewport height above the controls", async ({ page }) => {
    const viewportSize = page.viewportSize();
    const box = await reader(page).boundingBox();
    if (viewportSize === null || box === null) throw new Error("the reader has no box");

    // A dynamic viewport unit can resolve a few pixels below the emulated
    // device viewport, so the reader is measured against it with that margin.
    expect(box.height).toBeGreaterThanOrEqual(viewportSize.height - 8);

    const controls = await page.locator(".lab-controls").boundingBox();
    if (controls === null) throw new Error("the control column has no box");
    expect(controls.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
  });

  test("turns the page from the side thirds with a tap", async ({ page }) => {
    await tapFraction(page, 0.85);
    await expectState(page, { pageIndex: 1 });
    await tapFraction(page, 0.15);
    await expectState(page, { pageIndex: 0 });
  });

  test("toggles the HUD from the middle third with a tap", async ({ page }) => {
    await expect(hud(page)).toHaveAttribute("data-visible", "true");
    await tapFraction(page, 0.5);
    await expect(hud(page)).toHaveAttribute("data-visible", "false");

    // Two taps inside the double-tap window are one double tap, which zooms
    // instead of toggling. The second tap waits the window out so this stays
    // two single taps.
    await page.waitForTimeout(400);
    await tapFraction(page, 0.5);
    await expect(hud(page)).toHaveAttribute("data-visible", "true");
  });

  test("zooms on a double tap and ignores taps while zoomed", async ({ page }) => {
    await doubleTapFraction(page, 0.5);
    await expectState(page, { zoomScale: 2, isZoomLocked: true });

    await tapFraction(page, 0.85);
    await expectState(page, { pageIndex: 0 });

    await doubleTapFraction(page, 0.5);
    await expectState(page, { zoomScale: 1, isZoomLocked: false });
  });

  test("keeps a pinching gesture from reaching the reader in continuous mode", async ({ page }) => {
    await control(page, "mode").selectOption("continuous-vertical");
    expect(await viewport(page).evaluate((node) => getComputedStyle(node).touchAction)).toBe(
      "pan-y",
    );

    await pinchOpen(page, 120, 280);
    await expectState(page, { zoomScale: 1, isZoomLocked: false });
  });

  test("sizes the reader controls for a coarse pointer", async ({ page }) => {
    const boxes = await page.locator("[data-mekuri-control]").evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { control: node.getAttribute("data-mekuri-control") ?? "", height: box.height };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.height, `${box.control} height`).toBeGreaterThanOrEqual(44);
    }
  });
});
