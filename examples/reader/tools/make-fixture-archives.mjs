// Rebuilds the CBZ fixtures from the sample series. Run it from the repository
// root after editing the fixture images:
//
//   node examples/reader/tools/make-fixture-archives.mjs
//
// The archives are committed so the lab and the browser tests need no build
// step. Entry names use forward slashes, which archive readers expect.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { zipSync } from "fflate";

const base = "examples/reader/public/fixtures";
const series = base + "/sample-series";
const all = {};
const chapterOne = {};

for (const folder of readdirSync(series).sort()) {
  if (folder === "manifest.json") continue;
  for (const file of readdirSync(series + "/" + folder).sort()) {
    if (!file.endsWith(".png")) continue;
    const bytes = readFileSync(series + "/" + folder + "/" + file);
    all[folder + "/" + file] = bytes;
    if (folder === "Ch 1") chapterOne[file] = bytes;
  }
}

writeFileSync(base + "/sample-series.cbz", zipSync(all, { level: 9 }));
writeFileSync(base + "/sample-chapter.cbz", zipSync(chapterOne, { level: 9 }));

console.log(
  "wrote sample-series.cbz (" +
    String(Object.keys(all).length) +
    " entries) and sample-chapter.cbz (" +
    String(Object.keys(chapterOne).length) +
    " entries)",
);
