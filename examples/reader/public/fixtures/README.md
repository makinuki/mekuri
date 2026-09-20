# Lab fixtures

Deterministic sample material for the reader lab and for the browser test
suite. Nothing here belongs to the library; it exists so that every contributor
can exercise the reader without owning a chapter collection.

## sample-series

Two chapters. Every page carries a large numeral, a red corner marker in the
top left, and a caption naming its own path, so page order and placement are
readable at a glance.

| Chapter | Pages            | Notes                                                                                                                                                                    |
| ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ch 1    | 01.png to 05.png | Portrait 600x900, except 03.png at 900x600. The landscape page is wider than the default isolation threshold, so it takes a spread of its own. Page 05 ends the chapter. |
| Ch 2    | 01.png to 03.png | Portrait 600x900. Page 03 ends the chapter.                                                                                                                              |

`manifest.json` lists the chapters the lab loads by default. A page entry is a
path relative to the fixture directory, so `Ch 1/03.png` names a page inside a
chapter folder while `01.png` names a page at the fixture root. The chapter name
is a label for the chapter list and is never part of the path.

## sample-webtoon

Three strips at 800x2400, plus 04-tall.png at 800x6000, which is tall enough to
exercise measuring a single very large item.

`manifest.json` lists its single chapter, with the pages at the fixture root,
the way a chapter folder holds its images directly.

## Archives

`sample-chapter.cbz` holds one chapter with its images at the archive root,
which is how single chapter releases are normally packed. `sample-series.cbz`
holds the same two chapter folders as sample-series.

The archives are committed rather than generated, because rebuilding them needs
a zip writer that emits forward slash entry names. To rebuild them after
editing the images, run `node examples/reader/tools/make-fixture-archives.mjs`
from the repository root.
