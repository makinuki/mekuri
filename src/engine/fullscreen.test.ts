// Fullscreen tests exercise both paths. jsdom implements neither half of the
// platform fullscreen API, so the native path runs against properties defined
// on the element and the document, and the pseudo path is asserted through the
// styles it applies and the scroll restore it issues on exit.
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  attachFullscreen,
  supportsNativeFullscreen,
  type MekuriFullscreenController,
  type MekuriFullscreenOptions,
} from "./fullscreen";

function defineOwn(target: object, name: string, descriptor: PropertyDescriptor): () => void {
  const record = target as Record<string, unknown>;
  const previous = Object.prototype.hasOwnProperty.call(target, name)
    ? Object.getOwnPropertyDescriptor(target, name)
    : undefined;
  Object.defineProperty(target, name, { configurable: true, ...descriptor });
  return () => {
    if (previous !== undefined) Object.defineProperty(target, name, previous);
    else delete record[name];
  };
}

interface Harness {
  element: HTMLElement;
  controller: MekuriFullscreenController;
  scrollCalls: Array<[number, number]>;
  restore(): void;
}

let active: Harness | null = null;
const restores: Array<() => void> = [];

function patch(target: object, name: string, descriptor: PropertyDescriptor): void {
  restores.push(defineOwn(target, name, descriptor));
}

function harness(options: Partial<MekuriFullscreenOptions> = {}): Harness {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const controller = attachFullscreen({ element, ...options });
  // jsdom reports its own scrollTo as not implemented, so the harness owns the
  // call and records it instead.
  const scrollCalls: Array<[number, number]> = [];
  patch(window, "scrollTo", {
    writable: true,
    value: (x: number, y: number) => {
      scrollCalls.push([x, y]);
    },
  });

  const instance: Harness = {
    element,
    controller,
    scrollCalls,
    restore() {
      controller.detach();
      element.remove();
      document.body.removeAttribute("style");
      document.documentElement.removeAttribute("style");
    },
  };
  active = instance;
  return instance;
}

afterEach(() => {
  active?.restore();
  active = null;
  while (restores.length > 0) restores.pop()?.();
});

function exitAffordance(element: HTMLElement): HTMLElement | null {
  return element.querySelector("[data-mekuri-fullscreen-exit]");
}

function nativeFullscreen(
  element: HTMLElement,
  promote = true,
): { calls: { request: number; exit: number } } {
  let current: Element | null = null;
  const calls = { request: 0, exit: 0 };
  patch(element, "requestFullscreen", {
    writable: true,
    value: () => {
      calls.request += 1;
      if (promote) current = element;
      return Promise.resolve();
    },
  });
  patch(document, "fullscreenElement", { get: () => current });
  patch(document, "fullscreenEnabled", { get: () => true });
  patch(document, "exitFullscreen", {
    writable: true,
    value: () => {
      calls.exit += 1;
      current = null;
      return Promise.resolve();
    },
  });
  return { calls };
}

describe("supportsNativeFullscreen", () => {
  it("reports support from the platform surface", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    expect(supportsNativeFullscreen(element)).toBe(false);

    nativeFullscreen(element);
    expect(supportsNativeFullscreen(element)).toBe(true);
    element.remove();
  });
});

describe("attachFullscreen pseudo container", () => {
  it("pins the container to the viewport", async () => {
    const { element, controller } = harness();

    await expect(controller.enter()).resolves.toBe(true);

    expect(controller.isActive()).toBe(true);
    expect(controller.isPseudo()).toBe(true);
    expect(element.style.position).toBe("fixed");
    expect(element.style.inset).toBe("0px");
    expect(element.style.width).toBe("100%");
    expect(element.style.height).toBe("100dvh");
    expect(element.style.zIndex).toBe("var(--mekuri-z-fullscreen, 9999)");
    expect(element.style.overflow).toBe("hidden");
    expect(element.getAttribute("data-mekuri-fullscreen")).toBe("pseudo");
  });

  it("maps the safe area insets to custom properties", async () => {
    const { element, controller } = harness();
    await controller.enter();

    expect(element.style.getPropertyValue("--mekuri-safe-area-top")).toBe(
      "env(safe-area-inset-top, 0px)",
    );
    expect(element.style.getPropertyValue("--mekuri-safe-area-right")).toBe(
      "env(safe-area-inset-right, 0px)",
    );
    expect(element.style.getPropertyValue("--mekuri-safe-area-bottom")).toBe(
      "env(safe-area-inset-bottom, 0px)",
    );
    expect(element.style.getPropertyValue("--mekuri-safe-area-left")).toBe(
      "env(safe-area-inset-left, 0px)",
    );
  });

  it("locks host page scrolling", async () => {
    const { controller } = harness();
    await controller.enter();

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.touchAction).toBe("none");
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  it("restores the host scroll position exactly on exit", async () => {
    patch(window, "scrollX", { get: () => 120 });
    patch(window, "scrollY", { get: () => 3400 });

    const { controller, scrollCalls } = harness();
    await controller.enter();
    expect(scrollCalls).toEqual([]);
    await controller.exit();

    expect(scrollCalls).toEqual([[120, 3400]]);
    expect(controller.isActive()).toBe(false);
  });

  it("restores the host layout, scroll lock, and markup on exit", async () => {
    document.body.setAttribute("style", "overflow: auto; touch-action: pan-y");
    document.documentElement.setAttribute("style", "overflow: scroll");
    const { element, controller } = harness();
    element.setAttribute("style", "background: red;");
    element.setAttribute("data-mekuri-fullscreen", "host-value");

    await controller.enter();
    await controller.exit();

    expect(element.getAttribute("style")).toBe("background: red;");
    expect(element.getAttribute("data-mekuri-fullscreen")).toBe("host-value");
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.touchAction).toBe("pan-y");
    expect(document.documentElement.style.overflow).toBe("scroll");
    expect(exitAffordance(element)).toBeNull();
  });

  it("renders a guaranteed exit affordance", async () => {
    const { element, controller } = harness();
    await controller.enter();

    const control = exitAffordance(element);
    expect(control).not.toBeNull();
    expect(control?.tagName).toBe("BUTTON");
    expect(control?.textContent).toBe("Exit fullscreen");
    expect(control?.style.minHeight).toBe("44px");

    control?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(controller.isActive()).toBe(false);
    expect(exitAffordance(element)).toBeNull();
  });

  it("names the exit affordance from the host label", async () => {
    const { element, controller } = harness({ exitLabel: "Close reader" });
    await controller.enter();
    expect(exitAffordance(element)?.textContent).toBe("Close reader");
  });

  it("leaves fullscreen on Escape without cancelling other keys", async () => {
    const { controller } = harness();
    await controller.enter();

    const other = new KeyboardEvent("keydown", { key: "KeyM", bubbles: true, cancelable: true });
    document.dispatchEvent(other);
    expect(controller.isActive()).toBe(true);
    expect(other.defaultPrevented).toBe(false);

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(controller.isActive()).toBe(false);
  });

  it("returns focus to the element that held it", async () => {
    const hostControl = document.createElement("button");
    document.body.appendChild(hostControl);
    hostControl.focus();
    const { controller } = harness();

    await controller.enter();
    await controller.exit();

    expect(document.activeElement).toBe(hostControl);
    hostControl.remove();
  });

  it("opens once when enter is called twice", async () => {
    const { element, controller } = harness();
    await controller.enter();
    await controller.enter();

    expect(element.querySelectorAll("[data-mekuri-fullscreen-exit]")).toHaveLength(1);
  });

  it("omits the control when the host opts out but keeps Escape", async () => {
    const { element, controller } = harness({ exitAffordance: false });
    await controller.enter();
    expect(exitAffordance(element)).toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(controller.isActive()).toBe(false);
  });

  it("leaves fullscreen on detach", async () => {
    const { element, controller } = harness();
    await controller.enter();

    controller.detach();

    expect(controller.isActive()).toBe(false);
    expect(element.getAttribute("style")).toBeNull();
    expect(exitAffordance(element)).toBeNull();
  });

  it("is idle when exit is called before enter", async () => {
    const { controller } = harness();
    await expect(controller.exit()).resolves.toBeUndefined();
    expect(controller.isActive()).toBe(false);
  });
});

describe("attachFullscreen native path", () => {
  it("uses the platform API and leaves the host layout alone", async () => {
    const { element, controller } = harness();
    const native = nativeFullscreen(element);

    await expect(controller.enter()).resolves.toBe(true);

    expect(native.calls.request).toBe(1);
    expect(controller.isActive()).toBe(true);
    expect(controller.isPseudo()).toBe(false);
    expect(element.getAttribute("style")).toBeNull();
    expect(exitAffordance(element)).toBeNull();
    expect(document.body.getAttribute("style")).toBeNull();
  });

  it("leaves through the platform API", async () => {
    const { element, controller } = harness();
    const native = nativeFullscreen(element);
    await controller.enter();

    await controller.exit();

    expect(native.calls.exit).toBe(1);
    expect(controller.isActive()).toBe(false);
  });

  it("falls back to the pseudo container when the platform refuses", async () => {
    const { element, controller } = harness();
    nativeFullscreen(element);
    patch(element, "requestFullscreen", {
      writable: true,
      value: () => Promise.reject(new Error("not allowed")),
    });

    await expect(controller.enter()).resolves.toBe(true);

    expect(controller.isPseudo()).toBe(true);
    expect(element.style.height).toBe("100dvh");
  });

  it("falls back to the pseudo container when the platform does not promote", async () => {
    const { element, controller } = harness();
    nativeFullscreen(element, false);

    await expect(controller.enter()).resolves.toBe(true);

    expect(controller.isPseudo()).toBe(true);
    expect(element.getAttribute("data-mekuri-fullscreen")).toBe("pseudo");
  });

  it("honors forcePseudo while the platform API is available", async () => {
    const { element, controller } = harness({ forcePseudo: true });
    const native = nativeFullscreen(element);

    await controller.enter();

    expect(controller.isPseudo()).toBe(true);
    expect(native.calls.request).toBe(0);
  });
});
