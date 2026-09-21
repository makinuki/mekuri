// Shared helpers for the browser tier. The lab renders its engine state into
// the inspector as JSON, so a spec asserts on that snapshot instead of
// inferring behavior from pixels. Everything else here is a selector or an
// input helper the specs share.

import { expect, type Locator, type Page } from "@playwright/test";

export interface FailureRecord {
  attempt: number;
  stage: "resolve" | "load";
  code: string;
  message: string;
}

/** The inspector snapshot, narrowed to the members the specs assert on. */
export interface LabState {
  pageIndex: number;
  totalPages: number;
  mode: string;
  direction: string;
  zoomScale: number;
  isZoomLocked: boolean;
  isHUDVisible: boolean;
  activeSpreads: number[][];
  zoneMap: string;
  preloadWindow: number[];
  failures: Record<string, FailureRecord>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageResponse {
  url: string;
  status: number;
  contentType: string;
}

/** Committed fixture root, relative to the directory Playwright starts in. */
export const FIXTURES = "examples/reader/public/fixtures";

export function control(page: Page, name: string): Locator {
  return page.locator(`[data-lab-control="${name}"]`);
}

export function sourceStatus(page: Page): Locator {
  return page.locator('[data-lab-status="source"]');
}

export function boundaryStatus(page: Page): Locator {
  return page.locator('[data-lab-status="boundary"]');
}

export function caption(page: Page): Locator {
  return page.locator("[data-lab-caption]");
}

/** The reading surface of whichever view is mounted. */
export function reader(page: Page): Locator {
  return page.locator("[data-mekuri-container]").first();
}

/** The scrolling viewport: the keyboard focus target, and the element that
 * carries the touch-action contract. */
export function viewport(page: Page): Locator {
  return page.locator("[data-mekuri-viewport]").first();
}

export function hud(page: Page): Locator {
  return page.locator("[data-mekuri-hud]").first();
}

export function pageStatus(page: Page): Locator {
  return page.locator("[data-mekuri-status]").first();
}

export async function openLab(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mekuri lab" })).toBeVisible();
}

/** Loads a committed sample through the lab control of the same name. */
export async function loadSample(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(sourceStatus(page)).toContainText("page(s)");
}

export async function readState(page: Page): Promise<LabState> {
  const text = await page.locator(".inspector pre").textContent();
  if (text === null) throw new Error("the inspector has not rendered");
  return JSON.parse(text) as LabState;
}

/** Waits until the inspector snapshot contains the expected members. The
 * timeout is generous because the desktop projects run in parallel with the
 * mobile project on the same machine, and a load spike must not expire the
 * poll before the page has applied the interaction. */
export async function expectState(page: Page, expected: Partial<LabState>): Promise<void> {
  await expect.poll(async () => await readState(page), { timeout: 10_000 }).toMatchObject(expected);
}

export async function setMode(page: Page, mode: string): Promise<void> {
  await control(page, "mode").selectOption(mode);
  await expectState(page, { mode });
}

export async function nextPage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Next page" }).click();
}

/** Indices of the pages the paged view draws, in spread position order. */
export async function spreadIndices(page: Page): Promise<number[]> {
  return await page
    .locator("[data-mekuri-paged-page]")
    .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-index"))));
}

export async function spreadBoxes(page: Page): Promise<Rect[]> {
  const pages = page.locator("[data-mekuri-paged-page]");
  const count = await pages.count();
  const boxes: Rect[] = [];
  for (let index = 0; index < count; index += 1) {
    const box = await pages.nth(index).boundingBox();
    if (box !== null) boxes.push(box);
  }
  return boxes;
}

/** Left edges of a spread in DOM order, which is spread position order. */
export function leftEdges(boxes: Rect[]): number[] {
  return boxes.map((box) => Math.round(box.x));
}

async function pointAt(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  // The phone layout scrolls the document past the reader while the controls
  // are used, so the surface is brought back on screen before its box is read:
  // a tap must land on the reading surface, not above the viewport.
  const target = viewport(page);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("the reading viewport has no box");
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

export async function clickFraction(page: Page, x: number, y = 0.5): Promise<void> {
  const point = await pointAt(page, x, y);
  await page.mouse.click(point.x, point.y);
}

/** Three clicks would be a triple click; two inside the double-tap window are
 * one double tap, which is what the gesture layer counts. */
export async function doubleClickFraction(page: Page, x: number, y = 0.5): Promise<void> {
  const point = await pointAt(page, x, y);
  await page.mouse.dblclick(point.x, point.y);
}

export async function tapFraction(page: Page, x: number, y = 0.5): Promise<void> {
  const point = await pointAt(page, x, y);
  await page.touchscreen.tap(point.x, point.y);
}

export async function doubleTapFraction(page: Page, x: number, y = 0.5): Promise<void> {
  await tapFraction(page, x, y);
  await tapFraction(page, x, y);
}

/** Collects image responses, so a spec can assert that every page the lab
 * requested came back as an image rather than as a single-page fallback. */
export function trackImageResponses(page: Page): ImageResponse[] {
  const responses: ImageResponse[] = [];
  page.on("response", (response) => {
    if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(response.url())) return;
    responses.push({
      url: response.url(),
      status: response.status(),
      contentType: response.headers()["content-type"] ?? "",
    });
  });
  return responses;
}
