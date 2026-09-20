// Viewport geometry doubles for the continuous reading path. jsdom has no
// layout engine: element rects and the offset and client metrics layout code
// reads are all zero, which collapses every virtualizer range. These doubles
// own the geometry contract the view reads and return their own restore
// functions, so tests drive every measurement explicitly.

export interface MockDimensions {
  width: number;
  height: number;
}

export interface MockScrollGeometry {
  /** Height reported for the scroll surface, the element that carries the
   * data-mekuri-viewport attribute. */
  viewportHeight: number;
  /** Height reported for every other measured element: page layout boxes. */
  pageHeight: number;
  /** Width reported for every element. Defaults to 400. */
  width?: number;
}

function rectOf(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Defines an own property on a target and returns a function that removes it
 * again, or restores the descriptor it replaced. */
function patchOwn(target: object, name: string, descriptor: PropertyDescriptor): () => void {
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

/** Mocks layout dimensions for one element: getBoundingClientRect plus the
 * offset and client metrics layout code reads. Returns a restore function. */
export function mockViewportDimensions(
  element: HTMLElement,
  dimensions: MockDimensions,
): () => void {
  const restores = [
    patchOwn(element, "getBoundingClientRect", {
      writable: true,
      value: () => rectOf(dimensions.width, dimensions.height),
    }),
    patchOwn(element, "offsetWidth", { get: () => dimensions.width }),
    patchOwn(element, "offsetHeight", { get: () => dimensions.height }),
    patchOwn(element, "clientWidth", { get: () => dimensions.width }),
    patchOwn(element, "clientHeight", { get: () => dimensions.height }),
  ];
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

/** Mocks the geometry of a scroll surface as a whole. The element carrying
 * the data-mekuri-viewport attribute reads viewportHeight, every other
 * element reads pageHeight. The patches sit on the DOM prototypes, so
 * elements created after the call are covered too. Returns a restore
 * function. */
export function mockScrollGeometry(geometry: MockScrollGeometry): () => void {
  const width = geometry.width ?? 400;
  const heightFor = (element: HTMLElement): number =>
    element.hasAttribute("data-mekuri-viewport") ? geometry.viewportHeight : geometry.pageHeight;
  // A scroll surface reports the height of the column it wraps, which is what
  // a layout engine would measure. Without it every programmatic scroll in
  // jsdom is clamped to zero.
  const contentHeightFor = (element: HTMLElement): number => {
    if (!element.hasAttribute("data-mekuri-viewport")) return geometry.pageHeight;
    const column = element.firstElementChild;
    const declared = column instanceof HTMLElement ? Number.parseFloat(column.style.height) : NaN;
    return Number.isFinite(declared) ? declared : geometry.viewportHeight;
  };

  const restores = [
    patchOwn(HTMLElement.prototype, "getBoundingClientRect", {
      writable: true,
      value: function (this: HTMLElement): DOMRect {
        return rectOf(width, heightFor(this));
      },
    }),
    patchOwn(HTMLElement.prototype, "offsetWidth", { get: () => width }),
    patchOwn(HTMLElement.prototype, "clientWidth", { get: () => width }),
    patchOwn(HTMLElement.prototype, "offsetHeight", {
      get: function (this: HTMLElement): number {
        return heightFor(this);
      },
    }),
    patchOwn(HTMLElement.prototype, "clientHeight", {
      get: function (this: HTMLElement): number {
        return heightFor(this);
      },
    }),
    patchOwn(HTMLElement.prototype, "scrollHeight", {
      get: function (this: HTMLElement): number {
        return contentHeightFor(this);
      },
    }),
  ];
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}
