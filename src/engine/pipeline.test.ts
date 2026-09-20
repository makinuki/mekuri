// @vitest-environment node
// Pipeline tests run in plain Node: attempt counting, retry scheduling, and the
// failure registry are engine concerns and must not depend on a DOM.
import { describe, expect, it, vi } from "vite-plus/test";
import {
  IMAGE_LOAD_FAILED,
  RESOLVE_FAILED,
  retryDelayMs,
  type MekuriPageRequest,
} from "./pipeline";
import { createMekuriEngine, type MekuriEngineOptions } from "./store";
import type { MekuriPage } from "./types";
import { mockRetryScheduler } from "../test-utils/retries";

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, index) => ({ id: `page-${index}` }));
}

function harness(overrides: Partial<MekuriEngineOptions> = {}) {
  const retries = mockRetryScheduler();
  const options: MekuriEngineOptions = {
    pages: pages(3),
    scheduleRetry: retries.schedule,
    ...overrides,
  };
  const engine = createMekuriEngine(options);
  return { engine, options, retries };
}

function requestOf(engine: { getPageRequest(id: string | number): MekuriPageRequest | undefined }) {
  const request = engine.getPageRequest("page-0");
  if (request === undefined) throw new Error("page request missing");
  return request;
}

describe("retryDelayMs", () => {
  it("doubles the delay per attempt", () => {
    expect(retryDelayMs(1, 400)).toBe(400);
    expect(retryDelayMs(2, 400)).toBe(800);
    expect(retryDelayMs(3, 400)).toBe(1600);
  });
});

describe("engine image pipeline", () => {
  it("resolves the first attempt through the host resolver", async () => {
    const resolveSrc = vi.fn(() => "https://cdn.test/0.jpg");
    const { engine } = harness({ resolveSrc });

    await expect(engine.resolvePageSrc("page-0")).resolves.toBe("https://cdn.test/0.jpg");

    expect(resolveSrc).toHaveBeenCalledTimes(1);
    expect(resolveSrc).toHaveBeenCalledWith({ id: "page-0" }, 1, undefined);
    expect(requestOf(engine)).toEqual({
      attempt: 1,
      src: "https://cdn.test/0.jpg",
      retryScheduled: false,
    });
    expect(engine.getState().failures).toEqual({});
  });

  it("falls back to the page metadata source when no resolver is configured", async () => {
    const { engine } = harness({
      pages: [{ id: "page-0", metadata: { src: "https://cdn.test/meta.jpg" } }],
    });

    await expect(engine.resolvePageSrc("page-0")).resolves.toBe("https://cdn.test/meta.jpg");
  });

  it("passes decode constraints through when configured", async () => {
    const resolveSrc = vi.fn(() => "src");
    const { engine } = harness({
      resolveSrc,
      maxDecodeDimensions: { maxWidth: 1600, maxHeight: 2400 },
    });

    await engine.resolvePageSrc("page-0");

    expect(resolveSrc).toHaveBeenCalledWith({ id: "page-0" }, 1, {
      maxWidth: 1600,
      maxHeight: 2400,
    });
  });

  it("records a resolve-stage failure without retaining the thrown value", async () => {
    const { engine } = harness({
      resolveSrc: () => {
        throw new Error("token expired");
      },
    });

    await expect(engine.resolvePageSrc("page-0")).resolves.toBeNull();

    const failure = engine.getState().failures["page-0"];
    expect(failure).toEqual({
      attempt: 1,
      stage: "resolve",
      code: RESOLVE_FAILED,
      message: "token expired",
    });
    expect(failure).not.toBeInstanceOf(Error);
    expect(requestOf(engine).retryScheduled).toBe(true);
    expect(JSON.parse(JSON.stringify(engine.getState().failures))).toEqual(
      engine.getState().failures,
    );
  });

  it("stops after maxAutoRetries attempts", async () => {
    const attempts: number[] = [];
    const { engine, retries } = harness({
      resolveSrc: (_page, attempt) => {
        attempts.push(attempt);
        throw new Error(`attempt ${attempt} failed`);
      },
    });

    await engine.resolvePageSrc("page-0");
    expect(retries.next().delayMs).toBe(400);

    retries.next().run();
    await engine.resolvePageSrc("page-0");
    expect(retries.next().delayMs).toBe(800);

    retries.next().run();
    await engine.resolvePageSrc("page-0");

    // Default budget: the first attempt plus two auto-retries.
    expect(attempts).toEqual([1, 2, 3]);
    expect(retries.scheduled).toHaveLength(2);
    expect(requestOf(engine).retryScheduled).toBe(false);
    expect(engine.getState().failures["page-0"]?.attempt).toBe(3);
  });

  it("recovers when a flaky resolver succeeds", async () => {
    let failures = 2;
    const { engine, retries } = harness({
      resolveSrc: () => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("flaky");
        }
        return "https://cdn.test/recovered.jpg";
      },
    });

    await expect(engine.resolvePageSrc("page-0")).resolves.toBeNull();
    retries.next().run();
    await expect(engine.resolvePageSrc("page-0")).resolves.toBeNull();
    retries.next().run();
    await expect(engine.resolvePageSrc("page-0")).resolves.toBe("https://cdn.test/recovered.jpg");

    expect(requestOf(engine)).toEqual({
      attempt: 3,
      src: "https://cdn.test/recovered.jpg",
      retryScheduled: false,
    });
    expect(engine.getState().failures).toEqual({});
  });

  it("honors a host retry budget of zero", async () => {
    const resolveSrc = vi.fn(() => {
      throw new Error("no budget");
    });
    const { engine, retries } = harness({ resolveSrc, maxAutoRetries: 0 });

    await engine.resolvePageSrc("page-0");

    expect(resolveSrc).toHaveBeenCalledTimes(1);
    expect(retries.scheduled).toHaveLength(0);
    expect(requestOf(engine).retryScheduled).toBe(false);
  });

  it("records load failures and clears them on a successful load", () => {
    const { engine, retries } = harness();

    engine.reportPageLoadFailed("page-1", IMAGE_LOAD_FAILED, "Page 2 reported a load error");

    expect(engine.getState().failures["page-1"]).toEqual({
      attempt: 0,
      stage: "load",
      code: IMAGE_LOAD_FAILED,
      message: "Page 2 reported a load error",
    });
    expect(retries.scheduled).toHaveLength(1);

    engine.reportPageLoaded("page-1");

    expect(engine.getState().failures).toEqual({});
    expect(retries.pending()).toEqual([]);
    expect(engine.getPageRequest("page-1")?.retryScheduled).toBe(false);
  });

  it("re-resolves immediately on retryPage, bypassing the backoff", () => {
    const { engine, retries } = harness();
    engine.reportPageLoadFailed("page-1", IMAGE_LOAD_FAILED, "broken");

    engine.retryPage("page-1");

    const request = engine.getPageRequest("page-1");
    expect(request?.attempt).toBe(1);
    expect(request?.failure).toBeUndefined();
    expect(request?.retryScheduled).toBe(false);
    expect(retries.pending()).toEqual([]);
  });

  it("retries every failed page", () => {
    const { engine } = harness();
    engine.reportPageLoadFailed("page-0", IMAGE_LOAD_FAILED, "broken");
    engine.reportPageLoadFailed("page-2", IMAGE_LOAD_FAILED, "broken");

    engine.retryAllFailures();

    expect(engine.getState().failures).toEqual({});
    expect(engine.getPageRequest("page-0")?.attempt).toBe(1);
    expect(engine.getPageRequest("page-2")?.attempt).toBe(1);
    expect(engine.getPageRequest("page-1")?.attempt).toBe(0);
  });

  it("keeps attempt counters when the host replaces the page list", () => {
    const { engine, options } = harness();
    engine.reportPageLoadFailed("page-0", IMAGE_LOAD_FAILED, "broken");
    engine.retryPage("page-0");
    expect(engine.getPageRequest("page-0")?.attempt).toBe(1);

    options.pages = pages(3);
    engine.getState();

    expect(engine.getPageRequest("page-0")?.attempt).toBe(1);
  });

  it("drops pipeline state for pages the chapter no longer carries", () => {
    const { engine, options, retries } = harness();
    engine.reportPageLoadFailed("page-2", IMAGE_LOAD_FAILED, "broken");

    options.pages = pages(2);
    engine.getState();

    expect(engine.getPageRequest("page-2")).toBeUndefined();
    expect(engine.getState().failures).toEqual({});
    expect(retries.pending()).toEqual([]);
  });
});
