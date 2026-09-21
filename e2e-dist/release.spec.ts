// Release leg: the lab built against the package output, served from the
// production build rather than from the dev server.

import { expect, test } from "@playwright/test";
import {
  expectState,
  loadSample,
  nextPage,
  openLab,
  pageStatus,
  sourceStatus,
} from "../e2e/support/lab";

test("renders the lab from the built entries", async ({ page }) => {
  await openLab(page);
  await loadSample(page, "sample series");

  await expect(sourceStatus(page)).toHaveText("Sample series: 2 chapter(s), 8 page(s)");
  await expectState(page, { totalPages: 5, activeSpreads: [[0], [1], [2], [3, 4]] });

  await nextPage(page);
  await expectState(page, { pageIndex: 1 });
  await expect(pageStatus(page)).toHaveText("Page 2 of 5");
});
