// The headless contract, checked from the host side. A reader built from
// useMekuriEngine and custom markup has to reach the same navigation and zoom
// surface the prebuilt views offer, and the engine layers have to attach to
// the hook output directly. Nothing in the host component below imports a view.
// A final case renders the shipped views from the hook output, proving the two
// entry points compose.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef, useEffect, useRef, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { PagedView } from "./paged";
import { attachKeyboard } from "../engine/keyboard";
import { createMekuriEngine } from "../engine/store";
import type { MekuriPage } from "../engine/types";
import { useMekuriEngine, type MekuriEngineOutput } from "../engine/useMekuriEngine";

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

const PAGES = pages(6);

const captured: { current: MekuriEngineOutput | null } = { current: null };

beforeEach(() => {
  captured.current = null;
});

afterEach(cleanup);

/** Minimal host reader: the hook output, host markup, and one engine layer. */
function CustomReader({
  surfaceRef,
}: {
  surfaceRef: RefObject<HTMLDivElement | null>;
}): React.ReactElement {
  const reader = useMekuriEngine({
    pages: PAGES,
    resolveSrc: (page) => `https://example.test/pages/${page.id}.jpg`,
  });
  captured.current = reader;

  // A host keeps the first output it receives: the actions are stable
  // references, and the layers read live state through getState.
  const firstOutputRef = useRef<MekuriEngineOutput | null>(null);
  firstOutputRef.current ??= reader;
  useEffect(() => {
    const element = surfaceRef.current;
    const engine = firstOutputRef.current;
    if (element === null || engine === null) return undefined;
    const keyboard = attachKeyboard({ engine, element });
    return () => keyboard.detach();
  }, [surfaceRef]);

  const pageIndex = reader.state.pageIndex;
  const page = PAGES[pageIndex];
  return (
    <div {...reader.getContainerProps()}>
      <div {...reader.getViewportProps()} ref={surfaceRef} tabIndex={-1}>
        <img alt={`Page ${pageIndex + 1}`} src={reader.getPageRequest(page.id)?.src} />
      </div>
      <div>
        <button type="button" aria-label="Back" onClick={reader.prev} />
        <button type="button" aria-label="Forward" onClick={reader.next} />
        <button type="button" aria-label="Zoom in" onClick={reader.zoomIn} />
        <button type="button" aria-label="Zoom out" onClick={reader.zoomOut} />
        <button type="button" aria-label="Reset zoom" onClick={reader.resetZoom} />
      </div>
    </div>
  );
}

/** Prebuilt views rendered from the hook output: the composition the
 * structural view engine enables. */
function HookComposedReader(): React.ReactElement {
  const reader = useMekuriEngine({
    pages: PAGES,
    resolveSrc: (page) => `https://example.test/pages/${page.id}.jpg`,
  });
  captured.current = reader;
  return <PagedView engine={reader} pages={PAGES} />;
}

function named(root: HTMLElement, label: string): HTMLElement {
  const element = root.querySelector(`[aria-label="${label}"]`);
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

function prebuiltControl(root: HTMLElement, name: string): HTMLElement {
  const element = root.querySelector(`[data-mekuri-control="${name}"]`);
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

describe("headless host parity", () => {
  it("navigates and zooms through the hook output alone", () => {
    const surfaceRef = createRef<HTMLDivElement>();
    const { container } = render(<CustomReader surfaceRef={surfaceRef} />);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("Page 1");

    act(() => fireEvent.click(named(container, "Forward")));
    expect(captured.current?.state.pageIndex).toBe(1);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("Page 2");
    expect(captured.current?.getReadingPosition()).toEqual({ pageIndex: 1, relativeOffset: 0 });

    act(() => fireEvent.click(named(container, "Zoom in")));
    expect(captured.current?.state.zoomScale).toBe(1.5);
    expect(captured.current?.state.isZoomLocked).toBe(true);
    act(() => fireEvent.click(named(container, "Reset zoom")));
    expect(captured.current?.state.zoomScale).toBe(1);
  });

  it("attaches the keyboard layer to the hook output", () => {
    const surfaceRef = createRef<HTMLDivElement>();
    render(<CustomReader surfaceRef={surfaceRef} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });

    expect(captured.current?.state.pageIndex).toBe(1);
  });

  it("keeps the dead-zone contract on the viewport bindings", () => {
    const surfaceRef = createRef<HTMLDivElement>();
    const { container } = render(<CustomReader surfaceRef={surfaceRef} />);
    const viewport = container.querySelector("[data-mekuri-viewport]") as HTMLElement;
    expect(viewport.getAttribute("data-mekuri-viewport")).toBe("single");
    expect(viewport.style.overscrollBehavior).toBe("contain");
    expect(viewport.style.touchAction).toBe("none");

    act(() => captured.current?.setMode("continuous-webtoon"));

    expect(viewport.getAttribute("data-mekuri-viewport")).toBe("continuous-webtoon");
    expect(viewport.style.touchAction).toBe("pan-y");
  });

  it("renders the prebuilt views from the hook output", () => {
    const { container } = render(<HookComposedReader />);
    expect(container.querySelector("[data-mekuri-paged-page]")?.getAttribute("data-index")).toBe(
      "0",
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(captured.current?.state.pageIndex).toBe(1);

    act(() => fireEvent.click(prebuiltControl(container, "next")));
    expect(captured.current?.state.pageIndex).toBe(2);
  });

  it("reaches the same state as the prebuilt views for the same control sequence", () => {
    const surfaceRef = createRef<HTMLDivElement>();
    const custom = render(<CustomReader surfaceRef={surfaceRef} />);
    const engine = createMekuriEngine({ pages: PAGES });
    const prebuilt = render(<PagedView engine={engine} pages={PAGES} />);

    for (let step = 0; step < 2; step += 1) {
      act(() => fireEvent.click(named(custom.container, "Forward")));
      act(() => fireEvent.click(prebuiltControl(prebuilt.container, "next")));
    }
    act(() => fireEvent.click(named(custom.container, "Zoom in")));
    act(() => fireEvent.click(prebuiltControl(prebuilt.container, "zoom-in")));

    const customState = captured.current?.state;
    expect([customState?.pageIndex, customState?.zoomScale]).toEqual([
      engine.getState().pageIndex,
      engine.getState().zoomScale,
    ]);
    expect(customState?.isZoomLocked).toBe(engine.getState().isZoomLocked);
  });
});
