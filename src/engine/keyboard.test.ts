// Keyboard tests dispatch real keydown events against a document target, which
// is the scope a reader attaches to. The map is asserted as data, and the
// dispatcher is asserted through the engine state it produces.
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_KEYBOARD_MAP,
  KEYBOARD_ACTIONS,
  attachKeyboard,
  isEditableTarget,
  keyboardActionFor,
  mergeKeyboardMap,
  resolveKeyboardAction,
  type MekuriKeyboardController,
  type MekuriKeyboardOptions,
} from "./keyboard";
import { createMekuriEngine, type MekuriEngineOptions } from "./store";
import type { MekuriPage } from "./types";

interface Harness {
  engine: ReturnType<typeof createMekuriEngine>;
  controller: MekuriKeyboardController;
  element: HTMLElement;
  restore(): void;
}

let active: Harness | null = null;

function pages(count: number): MekuriPage[] {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

function harness(
  engineOptions: Partial<MekuriEngineOptions> = {},
  keyboardOptions: Partial<Omit<MekuriKeyboardOptions, "engine" | "element">> = {},
): Harness {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const engine = createMekuriEngine({ pages: pages(6), ...engineOptions });
  const controller = attachKeyboard({ engine, element, ...keyboardOptions });

  const instance: Harness = {
    engine,
    controller,
    element,
    restore() {
      controller.detach();
      element.remove();
    },
  };
  active = instance;
  return instance;
}

afterEach(() => {
  active?.restore();
  active = null;
});

function press(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    code,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
}

describe("keyboard map data", () => {
  it("binds every action in the registry", () => {
    expect(KEYBOARD_ACTIONS).toEqual([
      "nextPage",
      "prevPage",
      "toggleHUD",
      "zoomIn",
      "zoomOut",
      "resetZoom",
    ]);
    for (const action of KEYBOARD_ACTIONS) {
      expect(DEFAULT_KEYBOARD_MAP[action].length).toBeGreaterThan(0);
    }
    expect(DEFAULT_KEYBOARD_MAP.nextPage).toContain("Space");
  });

  it("round-trips through JSON", () => {
    const serialized = JSON.stringify(DEFAULT_KEYBOARD_MAP);
    expect(JSON.parse(serialized)).toEqual(DEFAULT_KEYBOARD_MAP);
    expect(JSON.parse(JSON.stringify(mergeKeyboardMap({ zoomIn: ["KeyI"] })))).toEqual(
      mergeKeyboardMap({ zoomIn: ["KeyI"] }),
    );
  });

  it("merges partial overrides over the defaults", () => {
    const map = mergeKeyboardMap({ nextPage: ["KeyN"], resetZoom: [] });
    expect(map.nextPage).toEqual(["KeyN"]);
    expect(map.resetZoom).toEqual([]);
    expect(map.prevPage).toEqual(DEFAULT_KEYBOARD_MAP.prevPage);
    expect(mergeKeyboardMap()).toEqual(DEFAULT_KEYBOARD_MAP);
  });

  it("returns lists that cannot reach the defaults or the dispatcher", () => {
    const map = mergeKeyboardMap();
    map.nextPage.push("KeyQ");
    expect(DEFAULT_KEYBOARD_MAP.nextPage).not.toContain("KeyQ");
  });

  it("resolves an action per code and per direction", () => {
    expect(keyboardActionFor("ArrowRight", DEFAULT_KEYBOARD_MAP)).toBe("nextPage");
    expect(keyboardActionFor("Escape", DEFAULT_KEYBOARD_MAP)).toBe("toggleHUD");
    expect(keyboardActionFor("KeyQ", DEFAULT_KEYBOARD_MAP)).toBeNull();

    expect(resolveKeyboardAction("nextPage", "ltr")).toBe("nextPage");
    expect(resolveKeyboardAction("nextPage", "rtl")).toBe("prevPage");
    expect(resolveKeyboardAction("prevPage", "rtl")).toBe("nextPage");
    expect(resolveKeyboardAction("toggleHUD", "rtl")).toBe("toggleHUD");
  });
});

describe("keyboard dispatch", () => {
  it("turns a page on a bound key and prevents its default action", () => {
    const { engine } = harness();
    const event = press("ArrowRight");
    expect(engine.getState().pageIndex).toBe(1);
    expect(event.defaultPrevented).toBe(true);

    press("Space");
    expect(engine.getState().pageIndex).toBe(2);
  });

  it("leaves unbound keys to the host", () => {
    const { engine } = harness();
    const event = press("KeyQ");
    expect(engine.getState().pageIndex).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores modified keys", () => {
    const { engine } = harness();
    press("ArrowRight", { ctrlKey: true });
    press("ArrowRight", { metaKey: true });
    press("ArrowRight", { altKey: true });
    expect(engine.getState().pageIndex).toBe(0);
  });

  it("repeats navigation but not toggles", () => {
    const { engine } = harness();
    press("ArrowRight", { repeat: true });
    expect(engine.getState().pageIndex).toBe(1);

    const hud = engine.getState().isHUDVisible;
    press("KeyM", { repeat: true });
    expect(engine.getState().isHUDVisible).toBe(hud);
  });

  it("inverts the page turns in RTL at dispatch, not in the map", () => {
    const { engine, controller } = harness();
    engine.setDirection("rtl");
    engine.goToIndex(0);

    press("ArrowRight");
    expect(engine.getState().pageIndex).toBe(0);

    press("ArrowLeft");
    expect(engine.getState().pageIndex).toBe(1);
    expect(controller.getMap().nextPage).toEqual(DEFAULT_KEYBOARD_MAP.nextPage);
  });

  it("dispatches zoom and reset actions", () => {
    const { engine } = harness();
    press("Equal");
    expect(engine.getState().zoomScale).toBe(1.5);
    press("Minus");
    expect(engine.getState().zoomScale).toBe(1);
    press("NumpadAdd");
    press("Digit0");
    expect(engine.getState().zoomScale).toBe(1);
  });

  it("honors a host override in place of a default list", () => {
    const { engine } = harness({}, { map: { nextPage: ["KeyN"] } });
    press("Space");
    expect(engine.getState().pageIndex).toBe(0);
    press("KeyN");
    expect(engine.getState().pageIndex).toBe(1);
  });

  it("stops listening after detach", () => {
    const { engine, controller } = harness();
    controller.detach();
    press("ArrowRight");
    expect(engine.getState().pageIndex).toBe(0);
  });

  it("serves the merged map to a help surface without leaking edits", () => {
    const { controller } = harness({}, { map: { nextPage: ["KeyN"] } });
    const map = controller.getMap();
    expect(map.nextPage).toEqual(["KeyN"]);
    map.nextPage.push("KeyQ");
    expect(controller.getMap().nextPage).toEqual(["KeyN"]);
  });
});

describe("keyboard suppression", () => {
  it("keeps shortcuts suppressed while a host modal is open", () => {
    let modalOpen = true;
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    document.body.appendChild(modal);
    const { engine } = harness({}, { isSuppressed: () => modalOpen });

    press("ArrowRight");
    expect(engine.getState().pageIndex).toBe(0);

    modalOpen = false;
    press("ArrowRight");
    expect(engine.getState().pageIndex).toBe(1);

    modal.remove();
  });

  it("suppresses on demand through the controller", () => {
    const { engine, controller } = harness();
    controller.setSuppressed(true);
    press("ArrowRight");
    expect(engine.getState().pageIndex).toBe(0);

    controller.setSuppressed(false);
    press("ArrowRight");
    expect(engine.getState().pageIndex).toBe(1);
  });

  it("follows the engine suppression option live", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const options: MekuriEngineOptions = { pages: pages(6), isKeyboardSuppressed: true };
    const engine = createMekuriEngine(options);
    const controller = attachKeyboard({ engine, element });

    press("ArrowRight");
    expect(engine.getState().pageIndex).toBe(0);

    options.isKeyboardSuppressed = false;
    press("ArrowRight");
    expect(engine.getState().pageIndex).toBe(1);

    controller.detach();
    element.remove();
  });

  it("yields to a host control that owns typing", () => {
    const { engine } = harness();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true, cancelable: true }),
    );
    expect(engine.getState().pageIndex).toBe(0);
    expect(input.isConnected).toBe(true);
    input.remove();
  });

  it("recognizes the element kinds that own typing", () => {
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { configurable: true, get: () => true });

    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
