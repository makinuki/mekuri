// Chapter ingestion for the lab host. A reading session is a list of chapters,
// and a chapter is a list of image pages held directly inside one directory.
// Two sources produce that shape: a picked directory tree, and a CBZ archive
// whose entry paths carry the same meaning. Nothing here talks to the engine,
// to React, or to the DOM beyond object URLs.

import { unzipSync } from "fflate";

export interface PageSource {
  readonly name: string;
  readonly url: string;
}

export interface Chapter {
  readonly name: string;
  readonly pages: readonly PageSource[];
}

export interface IngestedSource {
  readonly label: string;
  readonly chapters: Chapter[];
}

export interface IngestEntry {
  /** Path below the picked root or the archive root, always using "/". */
  readonly path: string;
  readonly url: string;
}

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
};

/** Image extension of a name in lower case, or null when the host cannot
 * display it. */
export function imageExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  return MIME_TYPES[extension] === undefined ? null : extension;
}

export function isImageName(name: string): boolean {
  return imageExtension(name) !== null;
}

export function mimeTypeFor(name: string): string {
  const extension = imageExtension(name);
  if (extension === null) return "application/octet-stream";
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

/** True for entries that never belong to a chapter: archive bookkeeping
 * directories, resource fork files, and directory records, which are stored
 * with a trailing separator and therefore produce an empty last segment. */
export function isJunkEntry(path: string): boolean {
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "__MACOSX" || segment === ".DS_Store") return true;
    if (segment.startsWith("._")) return true;
  }
  return false;
}

/** Orders names the way a reader orders pages: digit runs compare as numbers,
 * so page 2 precedes page 10 whether or not the names are zero padded. Names
 * that differ only in padding fall back to a plain comparison, so the order is
 * always total and stable. */
export function naturalCompare(left: string, right: string): number {
  const leftParts = left.match(/\d+|\D+/g) ?? [];
  const rightParts = right.match(/\d+|\D+/g) ?? [];
  const shared = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < shared; index += 1) {
    const leftPart = leftParts[index] ?? "";
    const rightPart = rightParts[index] ?? "";
    if (leftPart === rightPart) continue;
    const numeric = /^\d/.test(leftPart) && /^\d/.test(rightPart);
    if (numeric) {
      const difference = Number(leftPart) - Number(rightPart);
      if (difference !== 0) return difference < 0 ? -1 : 1;
      continue;
    }
    return leftPart < rightPart ? -1 : 1;
  }
  if (leftParts.length !== rightParts.length) return leftParts.length - rightParts.length;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Code page 437, the code page a zip archive implies when an entry name has
 * no language encoding flag. Index i holds the character for byte 0x80 + i. */
const CP437_HIGH =
  "\u00C7\u00FC\u00E9\u00E2\u00E4\u00E0\u00E5\u00E7" +
  "\u00EA\u00EB\u00E8\u00EF\u00EE\u00EC\u00C4\u00C5" +
  "\u00C9\u00E6\u00C6\u00F4\u00F6\u00F2\u00FB\u00F9" +
  "\u00FF\u00D6\u00DC\u00A2\u00A3\u00A5\u20A7\u0192" +
  "\u00E1\u00ED\u00F3\u00FA\u00F1\u00D1\u00AA\u00BA" +
  "\u00BF\u2310\u00AC\u00BD\u00BC\u00A1\u00AB\u00BB" +
  "\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556" +
  "\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510" +
  "\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F" +
  "\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567" +
  "\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B" +
  "\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580" +
  "\u03B1\u00DF\u0393\u03C0\u03A3\u03C3\u00B5\u03C4" +
  "\u03A6\u0398\u03A9\u03B4\u221E\u03C6\u03B5\u2229" +
  "\u2261\u00B1\u2265\u2264\u2320\u2321\u00F7\u2248" +
  "\u00B0\u2219\u00B7\u221A\u207F\u00B2\u25A0\u00A0";

/** Length of the code page 437 upper half, which covers bytes 0x80 to 0xFF. */
export const CP437_HIGH_LENGTH = CP437_HIGH.length;

function decodeLegacyBytes(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    const character = byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
    text += character === undefined ? String.fromCharCode(byte) : character;
  }
  return text;
}

/** Normalizes an archive entry name. The zip reader decodes names as UTF-8
 * when an archive sets the language encoding flag and as latin1 otherwise, so
 * a name whose characters all sit below 0x100 still carries the original
 * bytes. Those bytes are read as UTF-8 when they are valid UTF-8, because
 * writers commonly emit UTF-8 while omitting the flag, and as code page 437
 * otherwise, which is the encoding the format assumes in that case. */
export function decodeArchiveName(name: string): string {
  for (const character of name) {
    if ((character.codePointAt(0) ?? 0) > 0xff) return name;
  }
  const bytes = Uint8Array.from(name, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return decodeLegacyBytes(bytes);
  }
}

/** Groups entries into chapters. Every directory holding image files directly
 * becomes one chapter, named after its last path segment; `rootName` names the
 * chapter formed by images at the root of the selection. Chapters are ordered
 * by directory path, so a root chapter sorts first. */
export function buildChapters(entries: readonly IngestEntry[], rootName: string): Chapter[] {
  const groups = new Map<string, IngestEntry[]>();
  for (const entry of entries) {
    if (isJunkEntry(entry.path) || !isImageName(entry.path)) continue;
    const { directory } = splitPath(entry.path);
    const group = groups.get(directory);
    if (group === undefined) groups.set(directory, [entry]);
    else group.push(entry);
  }
  const chapters: { directory: string; chapter: Chapter }[] = [];
  for (const [directory, group] of groups) {
    const pages = [...group]
      .sort((left, right) => naturalCompare(left.path, right.path))
      .map((entry) => ({ name: splitPath(entry.path).file, url: entry.url }));
    const segments = directory === "" ? [] : directory.split("/");
    const name = segments[segments.length - 1] ?? rootName;
    chapters.push({ directory, chapter: { name, pages } });
  }
  return chapters
    .sort((left, right) => naturalCompare(left.directory, right.directory))
    .map((group) => group.chapter);
}

function splitPath(path: string): { directory: string; file: string } {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const slash = normalized.lastIndexOf("/");
  if (slash === -1) return { directory: "", file: normalized };
  return { directory: normalized.slice(0, slash), file: normalized.slice(slash + 1) };
}

/** Leading path segment shared by every entry, when each entry sits inside a
 * directory. Null when the selection holds files at its own root. */
function sharedRoot(paths: readonly string[]): string | null {
  let root: string | null = null;
  for (const path of paths) {
    const slash = path.indexOf("/");
    if (slash === -1) return null;
    const head = path.slice(0, slash);
    if (root === null) root = head;
    else if (root !== head) return null;
  }
  return root;
}

/** Reads a picked file list. A directory pick reports each file path relative
 * to the selection, so the chapter layout survives; a multi-file selection
 * carries no paths and becomes a single chapter. */
export function readPickedFiles(files: readonly File[], fallbackName: string): IngestedSource {
  const picked = files.map((file) => {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
    return { file, path: relative === "" ? file.name : relative.replace(/\\/g, "/") };
  });
  const root = sharedRoot(picked.map((entry) => entry.path));
  const label = root ?? fallbackName;
  const entries: IngestEntry[] = [];
  for (const entry of picked) {
    const path = root === null ? entry.path : entry.path.slice(root.length + 1);
    if (!isImageName(path)) continue;
    entries.push({ path, url: URL.createObjectURL(entry.file) });
  }
  return { label, chapters: buildChapters(entries, label) };
}

/** Reads a CBZ archive into chapters. Entry names are normalized first,
 * because an archive may store them in either encoding. */
export function readCbz(bytes: Uint8Array, label: string): IngestedSource {
  const archive = unzipSync(bytes);
  const entries: IngestEntry[] = [];
  for (const [storedName, content] of Object.entries(archive)) {
    const path = decodeArchiveName(storedName);
    if (isJunkEntry(path) || !isImageName(path)) continue;
    const blob = new Blob([content as BlobPart], { type: mimeTypeFor(path) });
    entries.push({ path, url: URL.createObjectURL(blob) });
  }
  return { label, chapters: buildChapters(entries, label) };
}

export async function readCbzFile(file: File): Promise<IngestedSource> {
  const label = file.name.replace(/\.cbz$/i, "") || "Archive";
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readCbz(bytes, label);
}

/** Releases the object URLs an ingested source holds. Served URLs, such as the
 * built-in samples, are unaffected. */
export function releaseChapters(source: IngestedSource | null): void {
  if (source === null) return;
  for (const chapter of source.chapters) {
    for (const page of chapter.pages) URL.revokeObjectURL(page.url);
  }
}
