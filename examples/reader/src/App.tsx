// Lab shell. It owns source loading and the control surface; each mounted Stage
// owns one engine, so a chapter change starts the reader clean.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import type {
  ChapterBoundary,
  MekuriDirection,
  MekuriMode,
  MekuriPage,
  MekuriSpreadConfig,
} from "@makinuki/mekuri/engine";
import { MekuriViewStyles } from "@makinuki/mekuri/views";
import { readCbzFile, readPickedFiles, releaseChapters, type IngestedSource } from "./ingest";
import {
  SAMPLE_CHAPTER_ARCHIVE,
  SAMPLE_SERIES,
  SAMPLE_SERIES_ARCHIVE,
  SAMPLE_WEBTOON,
  loadSample,
  loadSampleArchive,
} from "./sample";
import { Stage, type LabSurface } from "./Stage";

const MODES: MekuriMode[] = ["single", "double", "continuous-vertical", "continuous-webtoon"];

interface PageSize {
  width: number;
  height: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App(): ReactElement {
  const [source, setSource] = useState<IngestedSource | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [status, setStatus] = useState(
    "Load a folder of images, a CBZ file, or one of the samples.",
  );
  const [surface, setSurface] = useState<LabSurface>("prebuilt");
  const [mode, setMode] = useState<MekuriMode>("double");
  const [direction, setDirection] = useState<MekuriDirection>("ltr");
  const [hud, setHud] = useState(true);
  const [zoneOverlay, setZoneOverlay] = useState(false);
  const [coverAlone, setCoverAlone] = useState(true);
  const [landscapeThreshold, setLandscapeThreshold] = useState(1.2);
  const [boundary, setBoundary] = useState<ChapterBoundary | null>(null);
  const [brokenPage, setBrokenPage] = useState(false);
  const [sizes, setSizes] = useState<Record<string, PageSize>>({});
  const [undecodable, setUndecodable] = useState<string[]>([]);

  const sourceRef = useRef<IngestedSource | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);
  const archiveRef = useRef<HTMLInputElement | null>(null);

  // Directory selection is a progressive enhancement over the multi-file
  // picker, so the attribute is set imperatively rather than in markup.
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  useEffect(() => () => releaseChapters(sourceRef.current), []);

  const chapter = source?.chapters[chapterIndex];

  // Measuring every page before the engine sees it keeps the layout exact from
  // the first paint, so spreads never repaginate under the reader. A page that
  // fails to decode is listed under the source status line afterwards, because
  // a source that resolves to something other than an image is otherwise
  // indistinguishable from a slow load.
  useEffect(() => {
    if (chapter === undefined) return undefined;
    let cancelled = false;
    const undecoded: string[] = [];
    setUndecodable([]);
    for (const page of chapter.pages) {
      const image = new Image();
      image.src = page.url;
      image.decode().then(
        () => {
          if (cancelled) return;
          setSizes((previous) => ({
            ...previous,
            [page.url]: { width: image.naturalWidth, height: image.naturalHeight },
          }));
        },
        () => {
          if (cancelled) return;
          undecoded.push(page.name);
          setUndecodable([...undecoded]);
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [chapter]);

  const pages = useMemo<MekuriPage[]>(() => {
    if (chapter === undefined) return [];
    const loaded = chapter.pages.map((page) => {
      const size = sizes[page.url];
      return {
        id: chapter.name + "/" + page.name,
        width: size?.width,
        height: size?.height,
        metadata: { src: page.url, name: page.name },
      };
    });
    if (!brokenPage) return loaded;
    // A page whose source never resolves, so the failure registry and the retry
    // policy can be exercised by hand.
    return [
      ...loaded,
      {
        id: chapter.name + "/broken.png",
        metadata: { src: "/fixtures/missing-page.png", name: "broken.png" },
      },
    ];
  }, [chapter, sizes, brokenPage]);

  const spreadConfig = useMemo<MekuriSpreadConfig>(
    () => ({ firstPageIsCover: coverAlone, landscapeThreshold }),
    [coverAlone, landscapeThreshold],
  );

  const applySource = (next: IngestedSource): void => {
    releaseChapters(sourceRef.current);
    sourceRef.current = next;
    setSource(next);
    setChapterIndex(0);
    setBoundary(null);
    setSizes({});
    // The appended failure page belongs to the session that enabled it, so a
    // fresh source never inherits a page that is not in the collection.
    setBrokenPage(false);
    const pageCount = next.chapters.reduce((total, item) => total + item.pages.length, 0);
    setStatus(
      next.label +
        ": " +
        String(next.chapters.length) +
        " chapter(s), " +
        String(pageCount) +
        " page(s)",
    );
  };

  const handleFolder = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    try {
      applySource(readPickedFiles(files, "Selection"));
    } catch (error) {
      setStatus("Could not read the selection: " + messageOf(error));
    }
  };

  const handleArchive = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = (event.target.files ?? [])[0];
    event.target.value = "";
    if (file === undefined) return;
    setStatus("Reading " + file.name + "...");
    try {
      applySource(await readCbzFile(file));
    } catch (error) {
      setStatus("Could not read " + file.name + ": " + messageOf(error));
    }
  };

  const handleSample = async (load: () => Promise<IngestedSource>): Promise<void> => {
    setStatus("Loading sample...");
    try {
      applySource(await load());
    } catch (error) {
      setStatus("Could not load the sample: " + messageOf(error));
    }
  };

  const goToChapter = (index: number): void => {
    setChapterIndex(index);
    setBoundary(null);
  };

  const chapterCount = source?.chapters.length ?? 0;
  const boundarySlot =
    boundary === null || chapter === undefined ? null : (
      <div className="boundary-card">
        <p>{(boundary === "end" ? "End of " : "Start of ") + chapter.name}</p>
        <div className="row">
          {boundary === "end" && chapterIndex < chapterCount - 1 ? (
            <button type="button" onClick={() => goToChapter(chapterIndex + 1)}>
              next chapter
            </button>
          ) : null}
          {boundary === "start" && chapterIndex > 0 ? (
            <button type="button" onClick={() => goToChapter(chapterIndex - 1)}>
              previous chapter
            </button>
          ) : null}
          <button type="button" onClick={() => setBoundary(null)}>
            dismiss
          </button>
        </div>
      </div>
    );

  const stageKey = [
    source?.label ?? "none",
    String(chapterIndex),
    surface,
    String(coverAlone),
    String(landscapeThreshold),
  ].join("|");

  return (
    <div className="lab">
      <MekuriViewStyles />
      <aside className="lab-controls">
        <h1>Mekuri lab</h1>
        <section>
          <h2>Source</h2>
          <div className="row">
            <button type="button" onClick={() => folderRef.current?.click()}>
              open folder
            </button>
            <button type="button" onClick={() => filesRef.current?.click()}>
              open images
            </button>
          </div>
          <div className="row">
            <button type="button" onClick={() => archiveRef.current?.click()}>
              open cbz
            </button>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => void handleSample(() => loadSample(SAMPLE_SERIES))}
            >
              sample series
            </button>
            <button
              type="button"
              onClick={() => void handleSample(() => loadSample(SAMPLE_WEBTOON))}
            >
              sample webtoon
            </button>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => void handleSample(() => loadSampleArchive(SAMPLE_CHAPTER_ARCHIVE))}
            >
              sample chapter cbz
            </button>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => void handleSample(() => loadSampleArchive(SAMPLE_SERIES_ARCHIVE))}
            >
              sample series cbz
            </button>
          </div>
          <p className="status">{status}</p>
          {undecodable.length === 0 ? null : (
            <p className="warn">{"No image decoded for: " + undecodable.join(", ")}</p>
          )}
          <input ref={folderRef} type="file" multiple hidden onChange={handleFolder} />
          <input
            ref={filesRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handleFolder}
          />
          <input
            ref={archiveRef}
            type="file"
            accept=".cbz,application/zip"
            hidden
            onChange={(event) => void handleArchive(event)}
          />
        </section>
        {source === null ? null : (
          <section>
            <h2>Chapter</h2>
            <ol className="chapters">
              {source.chapters.map((item, index) => (
                <li key={item.name + String(index)}>
                  <button
                    type="button"
                    className={index === chapterIndex ? "active" : undefined}
                    onClick={() => goToChapter(index)}
                  >
                    {item.name + " (" + String(item.pages.length) + ")"}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
        <section>
          <h2>Reader</h2>
          <label>
            surface
            <select
              value={surface}
              onChange={(event) => setSurface(event.target.value as LabSurface)}
            >
              <option value="prebuilt">prebuilt views</option>
              <option value="host">host markup</option>
            </select>
          </label>
          <label>
            mode
            <select value={mode} onChange={(event) => setMode(event.target.value as MekuriMode)}>
              {MODES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            direction
            <select
              value={direction}
              onChange={(event) => setDirection(event.target.value as MekuriDirection)}
            >
              <option value="ltr">ltr</option>
              <option value="rtl">rtl</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={hud}
              onChange={(event) => setHud(event.target.checked)}
            />
            HUD controls
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={zoneOverlay}
              onChange={(event) => setZoneOverlay(event.target.checked)}
            />
            zone overlay
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={coverAlone}
              onChange={(event) => setCoverAlone(event.target.checked)}
            />
            first page alone
          </label>
          <label>
            landscape above
            <input
              type="number"
              min="1"
              max="3"
              step="0.1"
              value={landscapeThreshold}
              onChange={(event) => setLandscapeThreshold(Number(event.target.value))}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={brokenPage}
              onChange={(event) => setBrokenPage(event.target.checked)}
            />
            append a broken page
          </label>
        </section>
        <section>
          <h2>Boundary</h2>
          <p className="status">{boundary === null ? "none reached" : boundary}</p>
          <button type="button" onClick={() => setBoundary(boundary === null ? "end" : null)}>
            toggle test interstitial
          </button>
        </section>
      </aside>
      <main className="lab-main">
        <p className="stage-caption">
          {source === null || chapter === undefined
            ? "no source loaded"
            : source.label +
              " / " +
              chapter.name +
              " / " +
              surface +
              (brokenPage ? " / plus one appended broken page" : "")}
        </p>
        <Stage
          key={stageKey}
          surface={surface}
          pages={pages}
          mode={mode}
          direction={direction}
          spreadConfig={spreadConfig}
          hud={hud}
          zoneOverlay={zoneOverlay}
          boundarySlot={boundarySlot}
          onBoundaryReached={setBoundary}
        />
      </main>
    </div>
  );
}
