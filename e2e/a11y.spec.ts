// Accessibility primitives, asserted against the rendered reader rather than
// against component internals.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  expectState,
  hud,
  loadSample,
  nextPage,
  openLab,
  pageStatus,
  viewport,
} from "./support/lab";

test.describe("accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series");
  });

  test("has no axe violations on the lab page", async ({ page }) => {
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test("announces the reading position politely and only on a page turn", async ({ page }) => {
    const status = pageStatus(page);
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toHaveText("Page 1 of 5");

    await nextPage(page);
    await expect(status).toHaveText("Page 2 of 5");

    // A zoom change is not a page turn, so the announcement text holds.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expectState(page, { zoomScale: 1.5 });
    await expect(status).toHaveText("Page 2 of 5");
  });

  test("describes each page for assistive technology", async ({ page }) => {
    await expect(page.locator("[data-mekuri-paged-page] img").first()).toHaveAttribute(
      "alt",
      "Page 1",
    );
    await nextPage(page);
    await expect(page.locator("[data-mekuri-paged-page] img").first()).toHaveAttribute(
      "alt",
      "Page 2",
    );
  });

  test("names the toolbar and every control", async ({ page }) => {
    await expect(hud(page)).toHaveAttribute("role", "toolbar");
    await expect(hud(page)).toHaveAttribute("aria-label", "Reader controls");
    const names = await page
      .locator("[data-mekuri-control]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
    expect(names).toEqual([
      "Previous page",
      "Next page",
      "Zoom out",
      "Reset zoom",
      "Zoom in",
      "Hide controls",
    ]);
  });

  test("keeps every control at least 44 by 44 pixels", async ({ page }) => {
    const boxes = await page.locator("[data-mekuri-control]").evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return {
          control: node.getAttribute("data-mekuri-control") ?? "",
          width: box.width,
          height: box.height,
        };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.width, `${box.control} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${box.control} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test("neutralizes transitions and animations under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const duration = await viewport(page).evaluate(
      (node) => getComputedStyle(node).transitionDuration,
    );
    expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
  });
});
