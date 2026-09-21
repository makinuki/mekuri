// Keyboard registry and focus handling on a desktop.

import { expect, test } from "@playwright/test";
import { control, expectState, hud, loadSample, openLab, reader, viewport } from "../support/lab";

// Focusable HUD controls at scale 1. The zoom-out and reset controls are
// disabled while the scale is 1, so they are not in the tab order.
const HUD_CONTROLS = ["Previous page", "Next page", "Zoom in", "Hide controls"];

test.describe("keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series");
  });

  test("turns pages with the arrow keys and Space", async ({ page }) => {
    await page.keyboard.press("ArrowRight");
    await expectState(page, { pageIndex: 1 });
    await page.keyboard.press("ArrowLeft");
    await expectState(page, { pageIndex: 0 });
    await page.keyboard.press("Space");
    await expectState(page, { pageIndex: 1 });
  });

  test("inverts the page-turn keys in RTL", async ({ page }) => {
    await control(page, "direction").selectOption("rtl");
    await page.keyboard.press("ArrowLeft");
    await expectState(page, { pageIndex: 1 });
    await page.keyboard.press("ArrowRight");
    await expectState(page, { pageIndex: 0 });
  });

  test("zooms, clamps, and resets from the keyboard", async ({ page }) => {
    for (let press = 0; press < 5; press += 1) await page.keyboard.press("Equal");
    await expectState(page, { zoomScale: 4, isZoomLocked: true });

    for (let press = 0; press < 5; press += 1) await page.keyboard.press("Minus");
    await expectState(page, { zoomScale: 1, isZoomLocked: false });

    await page.keyboard.press("Equal");
    await expectState(page, { zoomScale: 1.5 });
    await page.keyboard.press("Digit0");
    await expectState(page, { zoomScale: 1 });
  });

  test("toggles the HUD with M and Escape and returns focus to the surface", async ({ page }) => {
    await hud(page).getByRole("button", { name: "Next page" }).focus();
    await page.keyboard.press("Escape");
    await expect(hud(page)).toHaveAttribute("data-visible", "false");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("region");

    await page.keyboard.press("m");
    await expect(hud(page)).toHaveAttribute("data-visible", "true");

    await hud(page).getByRole("button", { name: "Hide controls" }).click();
    await expect(hud(page)).toHaveAttribute("data-visible", "false");
  });

  test("focuses every HUD control in order with a visible ring", async ({ page }) => {
    await viewport(page).focus();
    for (const name of HUD_CONTROLS) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(
        name,
      );
      const outline = await page.evaluate(() => {
        const node = document.activeElement;
        if (node === null) return "none";
        const style = getComputedStyle(node);
        return `${style.outlineStyle} ${style.outlineWidth}`;
      });
      expect(outline).not.toContain("none");
    }
  });

  test("keeps the reading surface focusable for a keyboard user", async ({ page }) => {
    await viewport(page).focus();
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-mekuri-viewport"),
    );
    expect(focused).toBe("double");
    await expect(reader(page)).toHaveAttribute("data-hud-visible", "true");
  });
});
