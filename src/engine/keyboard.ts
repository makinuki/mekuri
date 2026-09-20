// Keyboard registry and dispatcher. The map is serializable data, so a host
// can render a shortcut help dialog from the same records the dispatcher
// resolves against, and a host override replaces one action's key list without
// touching the others. Reading direction is applied at dispatch: the map keeps
// physical keys, and RTL swaps the page-turn pair, so no RTL variant exists.

import type { MekuriDirection, MekuriKeyboardMap } from "./types";

export type MekuriKeyboardAction = keyof MekuriKeyboardMap;

export const DEFAULT_KEYBOARD_MAP: MekuriKeyboardMap = {
  nextPage: ["ArrowRight", "KeyD", "Space"],
  prevPage: ["ArrowLeft", "KeyA"],
  toggleHUD: ["KeyM", "Escape"],
  zoomIn: ["Equal", "NumpadAdd"],
  zoomOut: ["Minus", "NumpadSubtract"],
  resetZoom: ["Digit0", "Numpad0"],
};

/** The six actions in declaration order, so a help dialog can list them. */
export const KEYBOARD_ACTIONS: MekuriKeyboardAction[] = [
  "nextPage",
  "prevPage",
  "toggleHUD",
  "zoomIn",
  "zoomOut",
  "resetZoom",
];

/** Engine surface the dispatcher reads. Every member is stable for the life of
 * the engine, and the React binding output satisfies this shape, so a host
 * that renders its own markup can attach the dispatcher without reaching for
 * the vanilla store. */
export interface MekuriKeyboardEngine {
  getState(): { direction: MekuriDirection };
  next(): void;
  prev(): void;
  toggleHUD(force?: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  isKeyboardSuppressed(): boolean;
}

export interface MekuriKeyboardOptions {
  engine: MekuriKeyboardEngine;
  /** Reading surface. Used to resolve the document and to recognize focus that
   * belongs to a host control inside it. */
  element: HTMLElement;
  /** Node the keydown listener attaches to. Defaults to the element's
   * document, which is the scope a reader is expected to answer in. */
  target?: EventTarget;
  /** Host overrides merged over the defaults; each key replaces one list. */
  map?: Partial<MekuriKeyboardMap>;
  /** Imperative suppression. Returns true while a host modal, dialog, or
   * search field owns the keyboard. Read on every keydown, so it may follow
   * host state instead of being wired through the engine. */
  isSuppressed?: () => boolean;
  /** Calls preventDefault on a matched key. Defaults to true so Space and the
   * arrow keys do not scroll the host page. */
  preventDefault?: boolean;
}

export interface MekuriKeyboardController {
  detach(): void;
  /** Map currently in force, overrides included. */
  getMap(): MekuriKeyboardMap;
  /** Sets the imperative suppression flag outside the host callback. */
  setSuppressed(suppressed: boolean): void;
}

/** Host overrides merged over the defaults. An action keeps its default list
 * when the override omits it, and an empty list disables that action. Every
 * list is copied, so a caller that edits the returned map cannot reach the
 * defaults or the dispatcher. */
export function mergeKeyboardMap(overrides?: Partial<MekuriKeyboardMap>): MekuriKeyboardMap {
  return {
    nextPage: [...(overrides?.nextPage ?? DEFAULT_KEYBOARD_MAP.nextPage)],
    prevPage: [...(overrides?.prevPage ?? DEFAULT_KEYBOARD_MAP.prevPage)],
    toggleHUD: [...(overrides?.toggleHUD ?? DEFAULT_KEYBOARD_MAP.toggleHUD)],
    zoomIn: [...(overrides?.zoomIn ?? DEFAULT_KEYBOARD_MAP.zoomIn)],
    zoomOut: [...(overrides?.zoomOut ?? DEFAULT_KEYBOARD_MAP.zoomOut)],
    resetZoom: [...(overrides?.resetZoom ?? DEFAULT_KEYBOARD_MAP.resetZoom)],
  };
}

/** Action bound to a KeyboardEvent.code, or null when nothing is bound. */
export function keyboardActionFor(
  code: string,
  map: MekuriKeyboardMap,
): MekuriKeyboardAction | null {
  for (const action of KEYBOARD_ACTIONS) {
    if (map[action].includes(code)) return action;
  }
  return null;
}

/** Action to dispatch for a binding given the reading direction. RTL swaps the
 * page-turn pair; every other action is direction-independent. */
export function resolveKeyboardAction(
  action: MekuriKeyboardAction,
  direction: MekuriDirection,
): MekuriKeyboardAction {
  if (direction !== "rtl") return action;
  if (action === "nextPage") return "prevPage";
  if (action === "prevPage") return "nextPage";
  return action;
}

/** True when a key event belongs to a host control that owns typing, so the
 * reader must not steal it. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (element === null || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return element.isContentEditable === true;
}

/** Binds the keyboard map to a document. Reads the engine direction and the
 * suppression flags on every event, so nothing is captured at attach time. */
export function attachKeyboard(options: MekuriKeyboardOptions): MekuriKeyboardController {
  const { engine, element } = options;
  const doc = element.ownerDocument;
  const target = options.target ?? doc;
  const map = mergeKeyboardMap(options.map);
  const preventDefault = options.preventDefault ?? true;
  let suppressed = false;
  let detached = false;

  function isSuppressed(): boolean {
    if (suppressed) return true;
    if (options.isSuppressed?.() === true) return true;
    return engine.isKeyboardSuppressed();
  }

  function dispatch(action: MekuriKeyboardAction): void {
    if (action === "nextPage") engine.next();
    else if (action === "prevPage") engine.prev();
    else if (action === "toggleHUD") engine.toggleHUD();
    else if (action === "zoomIn") engine.zoomIn();
    else if (action === "zoomOut") engine.zoomOut();
    else engine.resetZoom();
  }

  function onKeyDown(event: Event): void {
    const key = event as KeyboardEvent;
    if (detached) return;
    if (isSuppressed() || isEditableTarget(key.target)) return;
    // Modified keys belong to the host and to the browser.
    if (key.ctrlKey || key.metaKey || key.altKey) return;
    const action = keyboardActionFor(key.code, map);
    if (action === null) return;
    // Repeats only steer navigation; repeating a toggle would flicker it.
    if (key.repeat === true && action !== "nextPage" && action !== "prevPage") return;
    if (preventDefault && event.cancelable) event.preventDefault();
    dispatch(resolveKeyboardAction(action, engine.getState().direction));
  }

  target.addEventListener("keydown", onKeyDown);

  return {
    detach: () => {
      detached = true;
      target.removeEventListener("keydown", onKeyDown);
    },
    getMap: () => mergeKeyboardMap(map),
    setSuppressed: (value: boolean) => {
      suppressed = value;
    },
  };
}
