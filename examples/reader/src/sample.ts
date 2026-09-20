// Served fixture material. The lab ships a small sample so the reader can be
// exercised without a local collection, and the browser test suite loads the
// same files.

import { readCbz, type IngestedSource } from "./ingest";

export const SAMPLE_SERIES = "sample-series";
export const SAMPLE_WEBTOON = "sample-webtoon";
export const SAMPLE_CHAPTER_ARCHIVE = "/fixtures/sample-chapter.cbz";
export const SAMPLE_SERIES_ARCHIVE = "/fixtures/sample-series.cbz";

interface SampleManifest {
  name: string;
  chapters: { name: string; pages: string[] }[];
}

/** Root-relative URL of one fixture page. A manifest page entry is a path
 * relative to the fixture directory and may point into a chapter folder, so
 * every segment of the directory and of the page path is encoded separately. */
export function fixturePageUrl(directory: string, path: string): string {
  const segments = [...directory.split("/"), ...path.split("/")]
    .filter((segment) => segment !== "")
    .map((segment) => encodeURIComponent(segment));
  return "/" + segments.join("/");
}

/** File name of a manifest page entry, used as the page label. */
export function fixturePageName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + " returned " + String(response.status));
  return new Uint8Array(await response.arrayBuffer());
}

/** Loads one fixture directory through its manifest. */
export async function loadSample(directory: string): Promise<IngestedSource> {
  const response = await fetch("/fixtures/" + directory + "/manifest.json");
  if (!response.ok) throw new Error("fixture manifest returned " + String(response.status));
  const manifest = (await response.json()) as SampleManifest;
  return {
    label: manifest.name,
    chapters: manifest.chapters.map((chapter) => ({
      name: chapter.name,
      pages: chapter.pages.map((page) => ({
        name: fixturePageName(page),
        url: fixturePageUrl("fixtures/" + directory, page),
      })),
    })),
  };
}

/** Loads one fixture archive along the same path a picked CBZ takes. */
export async function loadSampleArchive(url: string): Promise<IngestedSource> {
  const name = url.slice(url.lastIndexOf("/") + 1).replace(/\.cbz$/i, "");
  return readCbz(await fetchBytes(url), name);
}
