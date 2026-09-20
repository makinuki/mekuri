import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  CP437_HIGH_LENGTH,
  buildChapters,
  decodeArchiveName,
  isImageName,
  isJunkEntry,
  naturalCompare,
  readCbz,
  readPickedFiles,
  releaseChapters,
  type IngestEntry,
} from "./ingest";

// Object URLs are a browser service. The suite replaces them so chapter
// building can be asserted without a blob store.
let createdUrls: string[] = [];
let revokedUrls: string[] = [];
let urlCounter = 0;

beforeEach(() => {
  createdUrls = [];
  revokedUrls = [];
  urlCounter = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => {
      const url = "blob:lab-" + String(urlCounter);
      urlCounter += 1;
      createdUrls.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: (url: string) => revokedUrls.push(url),
  });
});

function entry(path: string): IngestEntry {
  return { path, url: "url:" + path };
}

function archive(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) entries[path] = strToU8(text);
  return zipSync(entries);
}

function pickedFile(name: string, relative?: string): File {
  const file = new File(["page"], name, { type: "image/png" });
  if (relative !== undefined)
    Object.defineProperty(file, "webkitRelativePath", { value: relative });
  return file;
}

function pageNames(pages: readonly { name: string }[]): string[] {
  return pages.map((page) => page.name);
}

describe("page ordering", () => {
  it("orders digit runs by value rather than by text", () => {
    const names = ["10.png", "2.png", "1.png", "02.png"];
    expect([...names].sort(naturalCompare)).toEqual(["1.png", "02.png", "2.png", "10.png"]);
  });

  it("orders chapter folders past nine", () => {
    const names = ["Ch 10", "Ch 9", "Ch 1"];
    expect([...names].sort(naturalCompare)).toEqual(["Ch 1", "Ch 9", "Ch 10"]);
  });

  it("stays a total order when names differ only in padding", () => {
    expect(naturalCompare("02.png", "2.png")).not.toBe(0);
    expect(naturalCompare("02.png", "02.png")).toBe(0);
  });
});

describe("entry filtering", () => {
  it("reads extensions case insensitively", () => {
    expect(isImageName("01.PNG")).toBe(true);
    expect(isImageName("01.jpeg")).toBe(true);
  });

  it("rejects entries the reader cannot display", () => {
    expect(isImageName("ComicInfo.xml")).toBe(false);
    expect(isImageName("01.png.txt")).toBe(false);
    expect(isImageName("cover")).toBe(false);
    expect(isImageName(".png")).toBe(false);
  });

  it("rejects archive and platform bookkeeping entries", () => {
    expect(isJunkEntry("__MACOSX/Ch 1/._01.png")).toBe(true);
    expect(isJunkEntry("Ch 1/")).toBe(true);
    expect(isJunkEntry(".DS_Store")).toBe(true);
    expect(isJunkEntry("Ch 1/01.png")).toBe(false);
  });
});

describe("chapter grouping", () => {
  it("treats images at the root as one chapter named after the source", () => {
    const chapters = buildChapters([entry("01.png"), entry("02.png")], "Ch 1");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.name).toBe("Ch 1");
    expect(pageNames(chapters[0]?.pages ?? [])).toEqual(["01.png", "02.png"]);
  });

  it("treats every directory of images as a chapter, ordered by path", () => {
    const chapters = buildChapters(
      [
        entry("Ch 10/01.png"),
        entry("Ch 2/02.png"),
        entry("Ch 2/01.png"),
        entry("Ch 2/10.png"),
        entry("Ch 10/02.png"),
      ],
      "Selection",
    );
    expect(chapters.map((chapter) => chapter.name)).toEqual(["Ch 2", "Ch 10"]);
    expect(pageNames(chapters[0]?.pages ?? [])).toEqual(["01.png", "02.png", "10.png"]);
  });

  it("names a nested chapter after its last path segment", () => {
    const chapters = buildChapters([entry("Series/Ch 1/01.png")], "Selection");
    expect(chapters.map((chapter) => chapter.name)).toEqual(["Ch 1"]);
  });

  it("drops junk and non-image entries before grouping", () => {
    const chapters = buildChapters(
      [
        entry("Ch 1/01.png"),
        entry("Ch 1/ComicInfo.xml"),
        entry("__MACOSX/Ch 1/._01.png"),
        entry("Thumbs.db"),
      ],
      "Selection",
    );
    expect(chapters).toHaveLength(1);
    expect(pageNames(chapters[0]?.pages ?? [])).toEqual(["01.png"]);
  });
});

describe("archive entry names", () => {
  it("keeps names the reader already decoded as UTF-8", () => {
    expect(decodeArchiveName("\u65E5\u672C\u8A9E")).toBe("\u65E5\u672C\u8A9E");
  });

  it("reads latin1 bytes as UTF-8 when they form valid UTF-8", () => {
    // A writer that emitted UTF-8 "e acute" while leaving the encoding flag
    // unset reaches the host as two latin1 characters.
    expect(decodeArchiveName("\u00C3\u00A9")).toBe("\u00E9");
  });

  it("falls back to code page 437 for bytes that are not valid UTF-8", () => {
    expect(decodeArchiveName("\u0081.png")).toBe("\u00FC.png");
  });

  it("covers every byte of the code page 437 upper half", () => {
    expect(CP437_HIGH_LENGTH).toBe(128);
  });
});

describe("cbz ingestion", () => {
  it("reads a chapter whose images sit at the archive root", () => {
    const source = readCbz(archive({ "01.png": "a", "02.png": "b" }), "sample-chapter");
    expect(source.label).toBe("sample-chapter");
    expect(source.chapters).toHaveLength(1);
    expect(pageNames(source.chapters[0]?.pages ?? [])).toEqual(["01.png", "02.png"]);
  });

  it("reads chapters stored in directories", () => {
    const source = readCbz(
      archive({ "Ch 1/01.png": "a", "Ch 2/01.png": "b", "Ch 2/02.png": "c" }),
      "sample-series",
    );
    expect(source.chapters.map((chapter) => chapter.name)).toEqual(["Ch 1", "Ch 2"]);
    expect(source.chapters.map((chapter) => chapter.pages.length)).toEqual([1, 2]);
  });

  it("orders archive pages numerically and drops everything else", () => {
    const source = readCbz(
      archive({ "10.png": "a", "9.png": "b", "ComicInfo.xml": "c", "__MACOSX/._x.png": "d" }),
      "roots",
    );
    expect(pageNames(source.chapters[0]?.pages ?? [])).toEqual(["9.png", "10.png"]);
  });
});

describe("folder ingestion", () => {
  it("strips the picked directory and keeps subdirectories as chapters", () => {
    const source = readPickedFiles(
      [
        pickedFile("01.png", "Series/Ch 1/01.png"),
        pickedFile("02.png", "Series/Ch 1/02.png"),
        pickedFile("01.png", "Series/Ch 2/01.png"),
      ],
      "Selection",
    );
    expect(source.label).toBe("Series");
    expect(source.chapters.map((chapter) => chapter.name)).toEqual(["Ch 1", "Ch 2"]);
  });

  it("names a single picked chapter folder after the folder", () => {
    const source = readPickedFiles([pickedFile("01.png", "Ch 1/01.png")], "Selection");
    expect(source.label).toBe("Ch 1");
    expect(source.chapters).toHaveLength(1);
    expect(pageNames(source.chapters[0]?.pages ?? [])).toEqual(["01.png"]);
  });

  it("treats a flat multi-file selection as one chapter", () => {
    const source = readPickedFiles(
      [pickedFile("02.png"), pickedFile("01.png"), pickedFile("notes.txt")],
      "Selection",
    );
    expect(source.label).toBe("Selection");
    expect(pageNames(source.chapters[0]?.pages ?? [])).toEqual(["01.png", "02.png"]);
    expect(createdUrls).toHaveLength(2);
  });

  it("releases every object url it handed out", () => {
    const source = readPickedFiles([pickedFile("01.png", "Ch 1/01.png")], "Selection");
    releaseChapters(source);
    expect(revokedUrls).toEqual(createdUrls);
    expect(revokedUrls).toHaveLength(1);
  });
});
