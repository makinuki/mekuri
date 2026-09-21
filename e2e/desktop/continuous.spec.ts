// Continuous layout. Desktop only: the rows measure the column against a
// desktop viewport, and the phone project reflows the stage around it.

import { expect, test, type Page } from "@playwright/test";
import { control, loadSample, openLab, readState, viewport, type Rect } from "../support/lab";

function pageBoxes(page: Page): Promise<Rect[]> {
  return page.locator("[data-mekuri-page]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
}

/** Vertical space between the first two pages of the column. */
function columnGap(boxes: Rect[]): number | null {
  const ordered = [...boxes].sort((left, right) => left.y - right.y);
  const [first, second] = ordered;
  if (first === undefined || second === undefined) return null;
  return Math.round(second.y - (first.y + first.height));
}

test.describe("continuous layout", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series");
  });

  test("keeps an eight pixel gap in vertical mode and none in webtoon mode", async ({ page }) => {
    await control(page, "mode").selectOption("continuous-vertical");
    await expect(page.locator('[data-mekuri-view="webtoon"]')).toBeVisible();
    await expect.poll(async () => columnGap(await pageBoxes(page))).toBe(8);

    await control(page, "mode").selectOption("continuous-webtoon");
    await expect.poll(async () => columnGap(await pageBoxes(page))).toBe(0);
  });

  test("places every page on integer pixels", async ({ page }) => {
    await control(page, "mode").selectOption("continuous-vertical");
    await expect.poll(async () => (await pageBoxes(page)).length).toBeGreaterThan(1);
    // The integer-pixel contract lives in the layout boxes: each page sits at
    // an integer offset inside the column and the column height is integer.
    // The absolute screen y also carries the lab chrome offset, which is
    // fractional, so it is not asserted here.
    const layout = await page.locator("[data-mekuri-page]").evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLElement;
        return { top: el.style.top, height: el.getBoundingClientRect().height };
      }),
    );
    for (const item of layout) {
      expect(item.top).toMatch(/^\d+px$/);
    }
    const columnHeight = await page
      .locator("[data-mekuri-column]")
      .evaluate((node) => (node as HTMLElement).getBoundingClientRect().height);
    expect(Math.round(columnHeight)).toBe(columnHeight);
  });

  test("detaches the sources of the pages outside the visible range", async ({ page }) => {
    await control(page, "mode").selectOption("continuous-webtoon");

    const detached = page.locator('[data-mekuri-page][data-mekuri-detached="true"]');
    await expect.poll(async () => await detached.count()).toBeGreaterThan(0);
    const withSource = await detached
      .locator("img")
      .evaluateAll((nodes) => nodes.filter((node) => node.hasAttribute("src")).length);
    expect(withSource).toBe(0);

    const active = page.locator('[data-mekuri-page][data-mekuri-active="true"]');
    await expect.poll(async () => await active.count()).toBeGreaterThan(0);
  });

  test("scrolls the reading viewport instead of the document", async ({ page }) => {
    await control(page, "mode").selectOption("continuous-vertical");
    // A real wheel over the viewport scrolls it; the document stays put.
    await viewport(page).hover();
    await page.mouse.wheel(0, 500);
    await expect
      .poll(async () => await viewport(page).evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);

    // The engine adopts the page the scroll lands on. The write repeats until
    // it is adopted: a freshly mounted continuous view holds its alignment
    // window for a moment, and a scroll landing inside it is treated as the
    // view's own settling rather than a user move.
    await expect
      .poll(async () => {
        await viewport(page).evaluate((node) => {
          node.scrollTop = 1000;
        });
        return (await readState(page)).pageIndex;
      })
      .toBeGreaterThan(0);
  });

  test("keeps native vertical panning instead of a gesture layer", async ({ page }) => {
    await control(page, "mode").selectOption("continuous-vertical");
    const touchAction = await viewport(page).evaluate((node) => getComputedStyle(node).touchAction);
    expect(touchAction).toBe("pan-y");

    await control(page, "mode").selectOption("double");
    await expect(viewport(page)).toHaveCount(1);
    const paged = await viewport(page).evaluate((node) => getComputedStyle(node).touchAction);
    expect(paged).toBe("none");
  });

  test("adopts the scroll position as the reading position", async ({ page }) => {
    await control(page, "mode").selectOption("continuous-vertical");
    // A scroll into the second page is reported as that page once the engine
    // adopts it. The write repeats until it is adopted, for the same reason as
    // in the row above: the mount alignment window swallows a scroll that
    // lands inside it.
    await expect
      .poll(async () => {
        await viewport(page).evaluate((node) => {
          node.scrollTop = 1000;
        });
        return (await readState(page)).pageIndex;
      })
      .toBe(1);
  });
});
