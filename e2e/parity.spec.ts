// Surface parity: the same engine state driven by the same actions, drawn once
// by the prebuilt views and once by the lab own elements over the headless
// contract.

import { expect, test, type Page } from "@playwright/test";
import { control, expectState, loadSample, openLab, readState, spreadIndices } from "./support/lab";

/** Same control sequence on either surface: two page turns and two zoom steps.
 * Each step is confirmed against the inspector before the next, because the
 * surface re-renders asynchronously after the engine adopts a key press. */
async function drive(page: Page): Promise<void> {
  for (const [key, expected] of [
    ["ArrowRight", { pageIndex: 1 }],
    ["ArrowRight", { pageIndex: 2 }],
    ["Equal", { zoomScale: 1.5 }],
    ["Equal", { zoomScale: 2.25 }],
  ] as const) {
    await page.keyboard.press(key);
    await expectState(page, expected);
  }
}

test.describe("surface parity", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series");
    // Single mode: one page per turn, so two turns land on page 2 regardless of
    // spread grouping.
    await control(page, "mode").selectOption("single");
  });

  test("reaches the same state through the same actions on both surfaces", async ({ page }) => {
    await drive(page);
    const prebuilt = await readState(page);

    await control(page, "surface").selectOption("host");
    await expect(page.locator("[data-host-surface]")).toBeVisible();
    await drive(page);

    await expect
      .poll(async () => await readState(page))
      .toMatchObject({
        pageIndex: prebuilt.pageIndex,
        zoomScale: prebuilt.zoomScale,
        mode: prebuilt.mode,
        direction: prebuilt.direction,
        activeSpreads: prebuilt.activeSpreads,
      });
  });

  test("draws the same spread with the lab own elements", async ({ page }) => {
    // Double mode, so the comparison covers a two-page spread rather than a
    // single page. Three turns land on the spread that pairs two pages.
    await control(page, "mode").selectOption("double");
    await expectState(page, { mode: "double", activeSpreads: [[0], [1], [2], [3, 4]] });
    for (let turn = 1; turn <= 3; turn += 1) {
      await page.keyboard.press("ArrowRight");
      await expectState(page, { pageIndex: turn });
    }
    // The lab mounts one surface at a time and remounts the stage when the
    // surface changes, so the prebuilt spread is read while it is on screen.
    const prebuilt = await spreadIndices(page);
    expect(prebuilt).toEqual([3, 4]);

    await control(page, "surface").selectOption("host");
    await expect(page.locator("[data-host-surface]")).toBeVisible();
    for (let turn = 1; turn <= 3; turn += 1) {
      await page.keyboard.press("ArrowRight");
      await expectState(page, { pageIndex: turn });
    }

    const drawn = await page
      .locator("[data-host-page]")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-host-page"))));
    expect(drawn).toEqual(prebuilt);
  });

  test("draws the active zone map on both surfaces", async ({ page }) => {
    await control(page, "zone-overlay").check();
    const zoneIds = (selector: string, attribute: string) => async (): Promise<(string | null)[]> =>
      await page
        .locator(selector)
        // The attribute name is passed in: an evaluateAll callback runs in
        // the browser and cannot read a captured variable.
        .evaluateAll((nodes, name) => nodes.map((node) => node.getAttribute(name)), attribute);

    await expect
      .poll(zoneIds("[data-mekuri-zone]", "data-mekuri-zone"))
      .toEqual(["prev", "hud", "next"]);

    await control(page, "surface").selectOption("host");
    await expect
      .poll(zoneIds("[data-host-zone]", "data-host-zone"))
      .toEqual(["prev", "hud", "next"]);
  });

  test("keeps a polite live region on the host surface", async ({ page }) => {
    await control(page, "surface").selectOption("host");
    const status = page.locator('[role="status"][aria-live="polite"]');
    await expect(status).toHaveText("Page 1 of 5");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(status).toHaveText("Page 3 of 5");
  });
});
