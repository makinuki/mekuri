// Source loading, on every project. The lab is the ingest path a host has to
// reproduce, so these rows cover the samples, a picked folder, a flat
// selection, and a picked archive.

import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  FIXTURES,
  control,
  expectState,
  loadSample,
  openLab,
  sourceStatus,
  trackImageResponses,
} from "./support/lab";

test.describe("source loading", () => {
  test("loads the sample series with both chapters", async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series");

    await expect(sourceStatus(page)).toHaveText("Sample series: 2 chapter(s), 8 page(s)");
    await expect(page.getByRole("button", { name: "Ch 1 (5)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ch 2 (3)" })).toBeVisible();
    // The engine is mounted per chapter, so the reader counts the pages of the
    // displayed chapter while the status line counts the whole source.
    await expectState(page, { totalPages: 5, pageIndex: 0 });
    await expect(page.locator(".warn")).toHaveCount(0);
  });

  test("requests every webtoon strip as an image", async ({ page }) => {
    const responses = trackImageResponses(page);
    await openLab(page);
    await loadSample(page, "sample webtoon");

    await expect(sourceStatus(page)).toHaveText("Sample webtoon: 1 chapter(s), 4 page(s)");
    // A page whose source resolves to something other than an image is listed
    // in the decode report, which is the guard for a fixture path that joins
    // to a directory instead of to a file.
    await expect(page.locator(".warn")).toHaveCount(0);
    await expect.poll(() => responses.length).toBeGreaterThanOrEqual(4);
    for (const response of responses) {
      expect(response.status, response.url).toBe(200);
      expect(response.contentType, response.url).toContain("image/");
    }
  });

  test("loads a chapter archive whose images sit at the root", async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample chapter cbz");

    await expect(sourceStatus(page)).toHaveText("sample-chapter: 1 chapter(s), 5 page(s)");
    await expect(page.getByRole("button", { name: "sample-chapter (5)" })).toBeVisible();
    await expect(page.locator(".warn")).toHaveCount(0);
  });

  test("loads a series archive whose chapters are directories", async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series cbz");

    await expect(sourceStatus(page)).toHaveText("sample-series: 2 chapter(s), 8 page(s)");
    await expect(page.getByRole("button", { name: "Ch 1 (5)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ch 2 (3)" })).toBeVisible();
  });

  test("reads a picked series folder as one chapter per subfolder", async ({ page }) => {
    await openLab(page);
    await control(page, "folder").setInputFiles(path.join(FIXTURES, "sample-series"));

    await expect(sourceStatus(page)).toHaveText("sample-series: 2 chapter(s), 8 page(s)");
    await expect(page.getByRole("button", { name: "Ch 1 (5)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ch 2 (3)" })).toBeVisible();
    await expect(page.locator(".warn")).toHaveCount(0);
  });

  test("reads a picked chapter folder as a single chapter", async ({ page }) => {
    await openLab(page);
    await control(page, "folder").setInputFiles(path.join(FIXTURES, "sample-series", "Ch 1"));

    await expect(sourceStatus(page)).toHaveText("Ch 1: 1 chapter(s), 5 page(s)");
    await expect(page.getByRole("button", { name: "Ch 1 (5)" })).toBeVisible();
  });

  test("reads a flat image selection as one chapter", async ({ page }) => {
    await openLab(page);
    const chapter = path.join(FIXTURES, "sample-series", "Ch 1");
    await control(page, "images").setInputFiles([
      path.join(chapter, "01.png"),
      path.join(chapter, "02.png"),
      path.join(chapter, "03.png"),
    ]);

    await expect(sourceStatus(page)).toHaveText("Selection: 1 chapter(s), 3 page(s)");
    await expect(page.getByRole("button", { name: "Selection (3)" })).toBeVisible();
    await expectState(page, { totalPages: 3 });
  });

  test("reads a picked archive", async ({ page }) => {
    await openLab(page);
    await control(page, "archive").setInputFiles(path.join(FIXTURES, "sample-series.cbz"));

    await expect(sourceStatus(page)).toHaveText("sample-series: 2 chapter(s), 8 page(s)");
    await expect(page.getByRole("button", { name: "Ch 2 (3)" })).toBeVisible();
  });

  test("names the loaded source in the stage caption", async ({ page }) => {
    await openLab(page);
    await loadSample(page, "sample series");
    await expect(page.locator("[data-lab-caption]")).toHaveText("Sample series / Ch 1 / prebuilt");
  });
});
