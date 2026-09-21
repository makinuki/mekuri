# Mekuri

Headless-first reader engine and view library for manga, comics, and webtoons
on the web. Published as `@makinuki/mekuri`.

The library is split into three surfaces:

- `engine`: headless state machine, pure page math, keyboard and tap-zone
  registries, gesture state, and virtualization math. No DOM, no CSS.
- `views`: optional unstyled, themeable view implementations and HUD
  primitives driven by CSS custom properties.
- `test-utils`: gesture simulators, viewport mocks, and observer mocks for
  testing host integrations under JSDOM.

Persistence, authentication, image proxying, and settings storage are host
responsibilities. The library never fetches images and never stores reading
state.

## Status

Pre-release.
Peer dependencies: `react` and `react-dom` 18.2 or 19.
The only runtime dependency is `@tanstack/react-virtual`, and only the
continuous views load it.

## Install

```sh
npm install @makinuki/mekuri react react-dom
```

## Engine quickstart

The engine owns reading state and page math. The host owns the elements and
the images, and reads the engine through the hook or through the vanilla
store:

```tsx
import { useMekuriEngine } from "@makinuki/mekuri/engine";
import type { MekuriPage } from "@makinuki/mekuri/engine";

function Reader({ pages, onChapterEnd }: { pages: MekuriPage[]; onChapterEnd: () => void }) {
  const reader = useMekuriEngine({
    pages,
    // The host resolves every source: authentication, proxying, unscrambling,
    // and cache busting keyed on the attempt number all live here.
    resolveSrc: (page, attempt) => `/api/pages/${String(page.id)}?attempt=${String(attempt)}`,
    onPositionSample: (position) => {
      localStorage.setItem("reading-position", JSON.stringify(position));
    },
    onBoundaryReached: (boundary) => {
      if (boundary === "end") onChapterEnd();
    },
  });

  const page = pages[reader.state.pageIndex];
  if (page === undefined) return <p>No pages loaded.</p>;
  const request = reader.getPageRequest(page.id);

  return (
    <div {...reader.getContainerProps()}>
      <div {...reader.getViewportProps()}>
        <img
          src={request?.src}
          alt={`Page ${String(reader.state.pageIndex + 1)}`}
          onLoad={() => reader.reportPageLoaded(page.id)}
          onError={() => reader.reportPageLoadFailed(page.id, "IMAGE_LOAD_FAILED", "load error")}
        />
      </div>
    </div>
  );
}
```

Pure helpers (`calculateSpreads`, `alignToSpread`, `resolvePageFromScrollOffset`,
`retryDelayMs`) are exported beside the hook, so a host can compute layout
without mounting anything.

## Views quickstart

The prebuilt views render a vanilla engine store and stay replaceable: create
the engine once per page list, mount the default stylesheet, then a view per
mode. Hosts writing their own markup use the `useMekuriEngine` hook instead
(see the engine quickstart above).

```tsx
import { useMemo } from "react";
import { createMekuriEngine } from "@makinuki/mekuri/engine";
import type { MekuriPage } from "@makinuki/mekuri/engine";
import { MekuriViewStyles, PagedView, WebtoonView } from "@makinuki/mekuri/views";

function Reader({ pages }: { pages: MekuriPage[] }) {
  const engine = useMemo(
    () =>
      createMekuriEngine({
        pages,
        resolveSrc: (page) => String(page.metadata?.src ?? ""),
      }),
    [pages],
  );
  const mode = engine.getState().mode;
  const continuous = mode === "continuous-webtoon" || mode === "continuous-vertical";

  return (
    <div style={{ height: "100dvh" }}>
      <MekuriViewStyles />
      {continuous ? (
        <WebtoonView engine={engine} pages={pages} gap={mode === "continuous-vertical" ? 8 : 0} />
      ) : (
        <PagedView engine={engine} pages={pages} />
      )}
    </div>
  );
}
```

Theming goes through CSS custom properties (`--mekuri-bg`, `--mekuri-hud-bg`,
`--mekuri-accent`, `--mekuri-hud-gap`, `--mekuri-safe-area-*`). Every rendered
element carries a `data-mekuri-*` attribute, so a host stylesheet or test can
address state without relying on class names.

## Host ownership boundary

Mekuri renders reading state and nothing else. The table states what the
library never does, so a host knows which side of the boundary owns it.

| Concern                                                                | Owner         |
| ---------------------------------------------------------------------- | ------------- |
| Reading position, spreads, zoom bounds, boundary detection             | mekuri engine |
| Tap zones, gestures, keyboard map, HUD visibility                      | mekuri engine |
| Page markup, layout, and any DOM outside the reader container          | host          |
| Fetching images, authentication, proxying, unscrambling, cache busting | host          |
| Persisting the reading position and reader settings                    | host          |
| Chapter navigation and content loading                                 | host          |
| Analytics, telemetry, and crash reporting                              | host          |

Never, in any surface:

- No network requests of any kind, including image fetches and prefetches.
- No storage reads or writes: no cookies, `localStorage`, `IndexedDB`, or
  filesystem access.
- No global state: no provider, store, or module-level mutable singleton.
- No writes to the host document beyond the reader container, except the
  fullscreen module, which restores the scroll offsets and styles it changed.
- No analytics, telemetry, or logging.
- No page scrapers: the engine never parses markup it did not render.

## Development

```sh
pnpm run check          # lint and format
pnpm run typecheck      # strict TypeScript
pnpm run test:run       # unit and component tests
pnpm run build          # library build, one chunk per surface
pnpm run example:dev    # the reader lab against the library source
pnpm run test:e2e       # browser tier against the lab
pnpm run test:e2e:dist  # browser tier against the built entries
```

The example lab under `examples/reader` ingests a folder, a flat image
selection, or a CBZ archive, and renders the prebuilt views and a host-markup
surface over the same engine. Its committed fixtures under
`examples/reader/public/fixtures` let the browser tier run offline.
