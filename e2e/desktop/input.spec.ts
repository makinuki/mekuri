// Pointer input on a desktop: mouse taps reach the zone map, and the zoom
// matrix locks navigation while it is active.

import { expect, test } from "@playwright/test";
import {
  clickFraction,
  doubleClickFraction,
  expectState,
  hud,
  loadSample,
  openLab,
} from "../support/lab";

test.describe("pointer input", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series");
  });

  test("turns the page from the side thirds", async ({ page }) => {
    await clickFraction(page, 0.85);
    await expectState(page, { pageIndex: 1 });

    await clickFraction(page, 0.15);
    await expectState(page, { pageIndex: 0 });
  });

  test("toggles the HUD from the middle third", async ({ page }) => {
    await expect(hud(page)).toHaveAttribute("data-visible", "true");
    await clickFraction(page, 0.5);
    await expect(hud(page)).toHaveAttribute("data-visible", "false");
    await expectState(page, { isHUDVisible: false });

    // Two taps inside the double-tap window are one double tap, which zooms
    // instead of toggling. The second tap waits the window out so this stays
    // two single taps.
    await page.waitForTimeout(400);
    await clickFraction(page, 0.5);
    await expect(hud(page)).toHaveAttribute("data-visible", "true");
  });

  test("zooms on a double click and restores on the next one", async ({ page }) => {
    await doubleClickFraction(page, 0.5);
    await expectState(page, { zoomScale: 2, isZoomLocked: true });
    await expect(page.locator("[data-mekuri-paged]")).toHaveAttribute("data-zoomed", "true");

    // Taps reach no zone while the surface is zoomed.
    await clickFraction(page, 0.85);
    await expectState(page, { pageIndex: 0 });

    await doubleClickFraction(page, 0.5);
    await expectState(page, { zoomScale: 1, isZoomLocked: false });
  });

  test("zooms from the HUD controls", async ({ page }) => {
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expectState(page, { zoomScale: 1.5 });
    await page.getByRole("button", { name: "Reset zoom" }).click();
    await expectState(page, { zoomScale: 1 });
  });

  test("paints the zone map when the overlay is on", async ({ page }) => {
    await expect(page.locator("[data-mekuri-zone]")).toHaveCount(0);
    await page.locator('[data-lab-control="zone-overlay"]').check();
    await expect
      .poll(
        async () =>
          await page
            .locator("[data-mekuri-zone]")
            .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-mekuri-zone"))),
      )
      .toEqual(["prev", "hud", "next"]);
  });
});
