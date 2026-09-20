// Fixture loading tests. The manifests carry page paths relative to the
// fixture directory, so the loader must never invent a chapter folder: a root
// level page and a page inside a chapter folder are both spelled out in the
// manifest, exactly as an archive or a picked folder spells them out.

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { fixturePageName, fixturePageUrl, loadSample } from "./sample";

function serving(body: unknown, ok = true): void {
  vi.stubGlobal("fetch", () =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 404,
      json: () => Promise.resolve(body),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fixturePageUrl", () => {
  it("joins the fixture directory and a root level page", () => {
    expect(fixturePageUrl("fixtures/sample-webtoon", "01.png")).toBe(
      "/fixtures/sample-webtoon/01.png",
    );
  });

  it("keeps a chapter folder segment and encodes it", () => {
    expect(fixturePageUrl("fixtures/sample-series", "Ch 1/03.png")).toBe(
      "/fixtures/sample-series/Ch%201/03.png",
    );
  });

  it("tolerates a leading slash and empty segments", () => {
    expect(fixturePageUrl("fixtures/sample-webtoon", "/04-tall.png")).toBe(
      "/fixtures/sample-webtoon/04-tall.png",
    );
  });
});

describe("fixturePageName", () => {
  it("returns the file name of a page path", () => {
    expect(fixturePageName("Ch 1/03.png")).toBe("03.png");
    expect(fixturePageName("01.png")).toBe("01.png");
  });
});

describe("loadSample", () => {
  it("resolves both fixture layouts from the manifest", async () => {
    serving({
      name: "Sample",
      chapters: [
        { name: "Strip", pages: ["01.png", "02.png"] },
        { name: "Ch 1", pages: ["Ch 1/01.png"] },
      ],
    });

    const source = await loadSample("sample-webtoon");

    expect(source.label).toBe("Sample");
    expect(source.chapters.map((chapter) => chapter.name)).toEqual(["Strip", "Ch 1"]);
    expect(source.chapters[0].pages).toEqual([
      { name: "01.png", url: "/fixtures/sample-webtoon/01.png" },
      { name: "02.png", url: "/fixtures/sample-webtoon/02.png" },
    ]);
    expect(source.chapters[1].pages).toEqual([
      { name: "01.png", url: "/fixtures/sample-webtoon/Ch%201/01.png" },
    ]);
  });

  it("reports a manifest that cannot be read", async () => {
    serving(null, false);
    await expect(loadSample("missing")).rejects.toThrow("fixture manifest returned 404");
  });
});
