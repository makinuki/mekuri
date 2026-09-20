// Fullscreen container for the reading surface. enter() prefers the platform
// fullscreen API and falls back to an in-page pseudo container when the
// element cannot go natively fullscreen. The pseudo path pins the container to
// the viewport with dynamic viewport units, maps the OS safe area insets to
// custom properties, and locks host page scrolling with the offsets saved so
// exit restores them exactly. Leaving fullscreen never depends on browser
// chrome: the module binds Escape and renders an exit control.

export interface MekuriFullscreenOptions {
  /** Container promoted to fullscreen, typically the reading viewport. */
  element: HTMLElement;
  /** Document that owns the fullscreen state. Defaults to the element owner. */
  document?: Document;
  /** Skips the platform API and always uses the pseudo container. */
  forcePseudo?: boolean;
  /** Renders the pseudo path exit control. Defaults to true; the Escape
   * binding is installed either way. */
  exitAffordance?: boolean;
  /** Accessible name of the exit control. Defaults to "Exit fullscreen". */
  exitLabel?: string;
}

export interface MekuriFullscreenController {
  /** Enters fullscreen; resolves true when the container is active. */
  enter(): Promise<boolean>;
  /** Leaves fullscreen and restores scroll offsets and focus. Safe to call
   * while the container is already closed. */
  exit(): Promise<void>;
  /** True while the container occupies the viewport. */
  isActive(): boolean;
  /** True while the pseudo container is the active path. */
  isPseudo(): boolean;
  /** Leaves fullscreen and removes every listener and control. */
  detach(): void;
}

/** Safe area insets mapped to the custom properties HUD placement reads. */
const SAFE_AREA_PROPERTIES: ReadonlyArray<readonly [string, string]> = [
  ["--mekuri-safe-area-top", "env(safe-area-inset-top, 0px)"],
  ["--mekuri-safe-area-right", "env(safe-area-inset-right, 0px)"],
  ["--mekuri-safe-area-bottom", "env(safe-area-inset-bottom, 0px)"],
  ["--mekuri-safe-area-left", "env(safe-area-inset-left, 0px)"],
];

/** Exit control height in pixels, matching the minimum touch target. */
const EXIT_AFFORDANCE_HEIGHT_PX = 44;

/** True when the element can be promoted by the platform fullscreen API. */
export function supportsNativeFullscreen(element: HTMLElement, doc?: Document): boolean {
  const owner = doc ?? element.ownerDocument;
  return (
    typeof element.requestFullscreen === "function" &&
    typeof owner.exitFullscreen === "function" &&
    owner.fullscreenEnabled !== false
  );
}

/** Inline styles the pseudo path records so exit restores the host layout. */
interface PseudoState {
  style: string | null;
  fullscreenAttribute: string | null;
  bodyOverflow: string;
  bodyTouchAction: string;
  rootOverflow: string;
  scrollX: number;
  scrollY: number;
  focused: Element | null;
  affordance: HTMLButtonElement | null;
}

export function attachFullscreen(options: MekuriFullscreenOptions): MekuriFullscreenController {
  const element = options.element;
  const doc = options.document ?? element.ownerDocument;
  const body = doc.body;
  const root = doc.documentElement;
  const exitLabel = options.exitLabel ?? "Exit fullscreen";
  let pseudo: PseudoState | null = null;
  let detached = false;

  function isNativeActive(): boolean {
    return doc.fullscreenElement === element;
  }

  function isActive(): boolean {
    return pseudo !== null || isNativeActive();
  }

  function onEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // While the pseudo container is open it owns Escape, so the host reader
    // does not also treat the key as a shortcut of its own.
    event.preventDefault();
    event.stopPropagation();
    void exit();
  }

  function onAffordanceClick(event: MouseEvent): void {
    // A tap on the control must not reach the host tap zones underneath it.
    event.preventDefault();
    event.stopPropagation();
    void exit();
  }

  function mountAffordance(): HTMLButtonElement | null {
    if (options.exitAffordance === false) return null;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "mekuri-fullscreen-exit";
    button.setAttribute("data-mekuri-fullscreen-exit", "");
    button.textContent = exitLabel;
    button.style.position = "absolute";
    button.style.top = "calc(var(--mekuri-safe-area-top, 0px) + 8px)";
    button.style.right = "calc(var(--mekuri-safe-area-right, 0px) + 8px)";
    button.style.boxSizing = "border-box";
    button.style.minHeight = `${EXIT_AFFORDANCE_HEIGHT_PX}px`;
    button.style.minWidth = `${EXIT_AFFORDANCE_HEIGHT_PX}px`;
    button.style.padding = "0 12px";
    button.style.zIndex = "1";
    button.style.border = "1px solid rgba(255, 255, 255, 0.35)";
    button.style.borderRadius = "999px";
    button.style.background = "rgba(0, 0, 0, 0.55)";
    button.style.color = "#ffffff";
    button.style.font = "inherit";
    button.style.cursor = "pointer";
    button.addEventListener("click", onAffordanceClick);
    element.appendChild(button);
    return button;
  }

  function unmountAffordance(state: PseudoState): void {
    const button = state.affordance;
    if (button === null) return;
    button.removeEventListener("click", onAffordanceClick);
    button.remove();
  }

  function applyPseudo(): void {
    const state: PseudoState = {
      style: element.getAttribute("style"),
      fullscreenAttribute: element.getAttribute("data-mekuri-fullscreen"),
      bodyOverflow: body.style.overflow,
      bodyTouchAction: body.style.touchAction,
      rootOverflow: root.style.overflow,
      scrollX: doc.defaultView?.scrollX ?? 0,
      scrollY: doc.defaultView?.scrollY ?? 0,
      focused: doc.activeElement,
      affordance: null,
    };
    pseudo = state;

    element.style.position = "fixed";
    element.style.inset = "0px";
    element.style.width = "100%";
    element.style.height = "100dvh";
    element.style.zIndex = "var(--mekuri-z-fullscreen, 9999)";
    element.style.overflow = "hidden";
    element.style.overscrollBehavior = "contain";
    for (const [property, value] of SAFE_AREA_PROPERTIES) {
      element.style.setProperty(property, value);
    }
    element.setAttribute("data-mekuri-fullscreen", "pseudo");

    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    root.style.overflow = "hidden";

    doc.addEventListener("keydown", onEscape, true);
    state.affordance = mountAffordance();
  }

  function restorePseudo(): void {
    const state = pseudo;
    if (state === null) return;
    pseudo = null;

    doc.removeEventListener("keydown", onEscape, true);
    unmountAffordance(state);

    if (state.style === null) element.removeAttribute("style");
    else element.setAttribute("style", state.style);
    if (state.fullscreenAttribute === null) element.removeAttribute("data-mekuri-fullscreen");
    else element.setAttribute("data-mekuri-fullscreen", state.fullscreenAttribute);

    body.style.overflow = state.bodyOverflow;
    body.style.touchAction = state.bodyTouchAction;
    root.style.overflow = state.rootOverflow;

    // The offsets are applied after the scroll lock is lifted, so the host
    // page returns to the position it held when the container opened.
    doc.defaultView?.scrollTo(state.scrollX, state.scrollY);

    const focused = state.focused;
    if (
      focused !== null &&
      doc.contains(focused) &&
      typeof (focused as HTMLElement).focus === "function"
    ) {
      (focused as HTMLElement).focus();
    }
  }

  async function enter(): Promise<boolean> {
    if (detached || isActive()) return isActive();
    if (options.forcePseudo !== true && supportsNativeFullscreen(element, doc)) {
      try {
        await element.requestFullscreen();
        if (isNativeActive()) return true;
      } catch {
        // The platform refused the promotion, because of a gesture
        // requirement or an embedding policy, so the container is opened in
        // page instead.
      }
    }
    applyPseudo();
    return true;
  }

  async function exit(): Promise<void> {
    if (pseudo !== null) {
      restorePseudo();
      return;
    }
    if (!isNativeActive()) return;
    try {
      await doc.exitFullscreen();
    } catch {
      // The platform may close fullscreen on its own; the intent is satisfied
      // either way.
    }
  }

  return {
    enter,
    exit,
    isActive,
    isPseudo: () => pseudo !== null,
    detach: () => {
      detached = true;
      void exit();
    },
  };
}
