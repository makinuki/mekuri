// Failure pipeline: an appended broken page reaches the registry after the
// automatic retries, the retry control attempts it again, and a new source
// never inherits a page that is not in the collection.

import { expect, test, type Page } from "@playwright/test";
import {
  caption,
  control,
  expectState,
  loadSample,
  openLab,
  readState,
  viewport,
  type FailureRecord,
} from "./support/lab";

async function failures(page: Page): Promise<FailureRecord[]> {
  return Object.values((await readState(page)).failures);
}

test.describe("failure registry", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series");
  });

  test("records the appended page after the retries and retries it again", async ({ page }) => {
    await control(page, "broken-page").check();
    await expectState(page, { totalPages: 6 });
    await expect(caption(page)).toContainText("plus one appended broken page");

    // The reader leaves keys to a focused form control, and the checkbox that
    // appended the page keeps focus, so the reading surface takes it back
    // before the pages are turned.
    await viewport(page).focus();

    // The broken page is the last of the chapter, so the reading position has
    // to reach it before the pipeline requests it. The pages are turned one at
    // a time and the position is confirmed after each turn, because the
    // appended page rebuilds the spread list under the reader.
    for (let turn = 0; turn < 6 && (await readState(page)).pageIndex !== 5; turn += 1) {
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await readState(page)).pageIndex).toBeGreaterThan(turn);
    }
    await expectState(page, { pageIndex: 5 });

    // The record is written on the first failed attempt and carries the
    // attempt that failed; the automatic retries advance the counter after it.
    // Polling the attempt number waits the retries out instead of racing the
    // backoff.
    await expect
      .poll(async () => (await failures(page))[0]?.attempt ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(1);
    const [first] = await failures(page);
    expect(first?.stage).toBe("load");
    const attemptAfterRetries = first?.attempt ?? 0;
    await expect(
      page.locator('[data-mekuri-paged-page][data-mekuri-src-state="failed"]'),
    ).toHaveCount(1);

    // The retry control sits in the inspector, which starts collapsed.
    await page.locator(".inspector summary").click();
    await page.getByRole("button", { name: "retry failures" }).click();
    // The retry clears the record and resolves the page again. The new attempt
    // is recorded when it fails; polling the attempt number avoids racing the
    // window in which the registry is empty.
    await expect
      .poll(async () => (await failures(page))[0]?.attempt ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(attemptAfterRetries);
    await expect.poll(async () => await failures(page), { timeout: 15_000 }).toHaveLength(1);
  });

  test("clears the appended page when a new source loads", async ({ page }) => {
    await control(page, "broken-page").check();
    await expectState(page, { totalPages: 6 });

    await loadSample(page, "sample webtoon");
    await expect(control(page, "broken-page")).not.toBeChecked();
    await expect(caption(page)).not.toContainText("appended broken page");
    await expectState(page, { totalPages: 4 });
  });
});
