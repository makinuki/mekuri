// Paged geometry. Desktop only: the mobile layout reflows the stage, and the
// spread measurements these rows assert on are the desktop ones.

import { expect, test } from "@playwright/test";
import {
  boundaryStatus,
  control,
  expectState,
  leftEdges,
  loadSample,
  nextPage,
  openLab,
  spreadBoxes,
  spreadIndices,
  viewport,
} from "../support/lab";

test.describe("spread grouping", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series");
  });

  test("pairs pages under the cover and isolates the landscape page", async ({ page }) => {
    await expectState(page, {
      mode: "double",
      direction: "ltr",
      activeSpreads: [[0], [1], [2], [3, 4]],
    });
    expect(await spreadIndices(page)).toEqual([0]);

    await nextPage(page);
    await expectState(page, { pageIndex: 1 });
    expect(await spreadIndices(page)).toEqual([1]);

    // The third page is 900 by 600: above the 1.2 landscape threshold it takes
    // its own spread and breaks the pair around it.
    await nextPage(page);
    await expectState(page, { pageIndex: 2 });
    expect(await spreadIndices(page)).toEqual([2]);

    await nextPage(page);
    await expectState(page, { pageIndex: 3 });
    expect(await spreadIndices(page)).toEqual([3, 4]);
  });

  test("repaginates when the landscape threshold rises above the page ratio", async ({ page }) => {
    await control(page, "landscape").fill("2");
    await expectState(page, { activeSpreads: [[0], [1, 2], [3, 4]] });

    await control(page, "landscape").fill("1.2");
    await expectState(page, { activeSpreads: [[0], [1], [2], [3, 4]] });
  });

  test("pairs from the first page when the cover is released", async ({ page }) => {
    await control(page, "cover-alone").uncheck();
    await expectState(page, { activeSpreads: [[0, 1], [2], [3, 4]] });
    expect(await spreadIndices(page)).toEqual([0, 1]);
  });

  test("draws one page per spread outside double mode", async ({ page }) => {
    await control(page, "mode").selectOption("single");
    await expectState(page, { mode: "single", activeSpreads: [[0], [1], [2], [3], [4]] });

    expect(await spreadIndices(page)).toEqual([0]);
    await nextPage(page);
    await expectState(page, { pageIndex: 1, activeSpreads: [[0], [1], [2], [3], [4]] });
    expect(await spreadIndices(page)).toEqual([1]);
  });

  test("places the first page of a spread at the start edge in RTL", async ({ page }) => {
    await control(page, "cover-alone").uncheck();
    await expectState(page, { activeSpreads: [[0, 1], [2], [3, 4]] });

    const ltr = leftEdges(await spreadBoxes(page));
    expect(ltr).toHaveLength(2);
    expect(ltr[0]).toBeLessThan(ltr[1]);

    await control(page, "direction").selectOption("rtl");
    await expect(page.locator("[data-mekuri-paged]")).toHaveAttribute("dir", "rtl");
    const rtl = leftEdges(await spreadBoxes(page));
    expect(rtl).toHaveLength(2);
    expect(rtl[0]).toBeGreaterThan(rtl[1]);
  });

  test("holds the position at the chapter end and hands over the next chapter", async ({
    page,
  }) => {
    await nextPage(page);
    await nextPage(page);
    await nextPage(page);
    await expectState(page, { pageIndex: 3 });

    await nextPage(page);
    await expect(boundaryStatus(page)).toHaveText("end");
    await expect(page.locator("[data-mekuri-boundary]")).toBeVisible();
    await expectState(page, { pageIndex: 3 });

    await page.getByRole("button", { name: "next chapter" }).click();
    await expect(page.getByRole("button", { name: "Ch 2 (3)" })).toHaveClass(/active/);
    await expectState(page, { pageIndex: 0, totalPages: 3, activeSpreads: [[0], [1, 2]] });
  });

  test("holds the position at the chapter start", async ({ page }) => {
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(boundaryStatus(page)).toHaveText("start");
    await expectState(page, { pageIndex: 0 });

    await page.getByRole("button", { name: "dismiss" }).click();
    await expect(boundaryStatus(page)).toHaveText("none reached");
  });

  test("keeps the document still while the paged surface reads", async ({ page }) => {
    // The paged viewport clips instead of scrolling: page turns replace the
    // spread, so there is nothing to scroll to. The contract under test is
    // that reading a chapter never moves the document.
    const overflow = await viewport(page).evaluate((node) => getComputedStyle(node).overflowY);
    expect(overflow).toBe("hidden");
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
  });
});
