// Observer doubles for the continuous reading path and for host integrations.
// jsdom implements neither ResizeObserver nor IntersectionObserver, and the
// virtualizer measures items only through ResizeObserver entries: these
// doubles install hand-driven classes on the window and fire entries only
// when a test asks for them, with no asynchronous layout involved.

export interface MockObserverBoxSize {
  blockSize: number;
  inlineSize: number;
}

export interface MockObserverEntry {
  target: Element;
  contentRect: { width: number; height: number };
  borderBoxSize: MockObserverBoxSize[];
  contentBoxSize: MockObserverBoxSize[];
  devicePixelContentBoxSize: MockObserverBoxSize[];
}

export interface MockIntersectionObserverEntry {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
  boundingClientRect: DOMRect;
  intersectionRect: DOMRect;
  rootBounds: DOMRect | null;
  time: number;
}

export interface MockIntersectionObserverInit {
  root?: Element | Document | null;
  rootMargin?: string;
  threshold?: number | number[];
}

/** Hand-driven ResizeObserver double. Instances record what their consumer
 * observes; entries fire only when a test asks for them. */
export class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  observed: Element[] = [];
  disconnected = false;

  private readonly callback: (entries: MockObserverEntry[], observer: MockResizeObserver) => void;

  constructor(callback: (entries: MockObserverEntry[], observer: MockResizeObserver) => void) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(target: Element, _options?: unknown): void {
    if (!this.observed.includes(target)) this.observed.push(target);
  }

  unobserve(target: Element): void {
    this.observed = this.observed.filter((node) => node !== target);
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed = [];
  }

  /** Fires one measure entry for an observed node. Nodes that were never
   * observed are ignored, mirroring the platform. */
  fire(target: Element, height: number, width = 400): void {
    if (!this.observed.includes(target)) return;
    this.callback([mockEntry(target, width, height)], this);
  }

  /** Fires one measure entry per observed node, with per-node heights. */
  fireAll(heights: (target: Element) => number, width = 400): void {
    // Consumers may unobserve nodes while an entry is delivered, so the node
    // list is copied before it is walked.
    for (const target of this.observed.slice()) {
      this.callback([mockEntry(target, width, heights(target))], this);
    }
  }
}

/** Hand-driven IntersectionObserver double with the full consumer surface:
 * observe, unobserve, disconnect, and takeRecords. */
export class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  observed: Element[] = [];
  disconnected = false;
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];

  private readonly callback: (
    entries: MockIntersectionObserverEntry[],
    observer: MockIntersectionObserver,
  ) => void;
  private readonly pending: MockIntersectionObserverEntry[] = [];

  constructor(
    callback: (
      entries: MockIntersectionObserverEntry[],
      observer: MockIntersectionObserver,
    ) => void,
    options: MockIntersectionObserverInit = {},
  ) {
    this.callback = callback;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    if (!this.observed.includes(target)) this.observed.push(target);
  }

  unobserve(target: Element): void {
    this.observed = this.observed.filter((node) => node !== target);
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed = [];
    this.pending.length = 0;
  }

  takeRecords(): MockIntersectionObserverEntry[] {
    return this.pending.splice(0);
  }

  /** Fires one intersection entry for an observed node. Unobserved nodes are
   * ignored, mirroring the platform. */
  intersect(target: Element, isIntersecting = true): void {
    if (!this.observed.includes(target)) return;
    const rect = target.getBoundingClientRect();
    this.callback(
      [
        {
          target,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          boundingClientRect: rect,
          intersectionRect: isIntersecting ? rect : rectOf(0, 0),
          rootBounds: null,
          time: 0,
        },
      ],
      this,
    );
  }
}

export interface MockResizeObserverHandle {
  readonly instances: MockResizeObserver[];
  /** Most recently constructed instance. Consumers construct their observers
   * while mounting, so handles resolve instances lazily instead of capturing
   * one at install time. */
  latest(): MockResizeObserver;
  /** Fires one entry for the node on every instance that observes it. */
  fire(target: Element, height: number, width?: number): void;
  /** Fires one entry per observed node, on every instance. */
  fireAll(heights: (target: Element) => number, width?: number): void;
  restore(): void;
}

export interface MockIntersectionObserverHandle {
  readonly instances: MockIntersectionObserver[];
  latest(): MockIntersectionObserver;
  intersect(target: Element, isIntersecting?: boolean): void;
  restore(): void;
}

/** Installs the ResizeObserver double on the window. Returns a handle with
 * the constructed instances and the restore function. */
export function mockResizeObserver(): MockResizeObserverHandle {
  MockResizeObserver.instances = [];
  const restoreWindow = patchWindow("ResizeObserver", MockResizeObserver);

  const latest = (): MockResizeObserver => {
    const instance = MockResizeObserver.instances.at(-1);
    if (instance === undefined) {
      throw new Error("mockResizeObserver: no observer has been constructed");
    }
    return instance;
  };

  const observing = (target: Element): MockResizeObserver[] =>
    MockResizeObserver.instances.filter((instance) => instance.observed.includes(target));

  return {
    instances: MockResizeObserver.instances,
    latest,
    fire: (target, height, width) => {
      if (MockResizeObserver.instances.length === 0) latest();
      for (const instance of observing(target)) instance.fire(target, height, width);
    },
    fireAll: (heights, width) => {
      if (MockResizeObserver.instances.length === 0) latest();
      // A callback may construct further observers, so the list is copied
      // before it is walked.
      for (const instance of MockResizeObserver.instances.slice()) {
        instance.fireAll(heights, width);
      }
    },
    restore: () => {
      restoreWindow();
      MockResizeObserver.instances = [];
    },
  };
}

/** Installs the IntersectionObserver double on the window. Returns a handle
 * with the constructed instances and the restore function. */
export function mockIntersectionObserver(): MockIntersectionObserverHandle {
  MockIntersectionObserver.instances = [];
  const restoreWindow = patchWindow("IntersectionObserver", MockIntersectionObserver);

  const latest = (): MockIntersectionObserver => {
    const instance = MockIntersectionObserver.instances.at(-1);
    if (instance === undefined) {
      throw new Error("mockIntersectionObserver: no observer has been constructed");
    }
    return instance;
  };

  return {
    instances: MockIntersectionObserver.instances,
    latest,
    intersect: (target, isIntersecting) => latest().intersect(target, isIntersecting),
    restore: () => {
      restoreWindow();
      MockIntersectionObserver.instances = [];
    },
  };
}

function mockEntry(target: Element, width: number, height: number): MockObserverEntry {
  const box: MockObserverBoxSize = { blockSize: height, inlineSize: width };
  return {
    target,
    contentRect: { width, height },
    borderBoxSize: [box],
    contentBoxSize: [box],
    devicePixelContentBoxSize: [box],
  };
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

function patchWindow(name: string, value: unknown): () => void {
  const record = window as unknown as Record<string, unknown>;
  const previous = Object.prototype.hasOwnProperty.call(window, name)
    ? Object.getOwnPropertyDescriptor(window, name)
    : undefined;
  Object.defineProperty(window, name, { configurable: true, writable: true, value });
  return () => {
    if (previous !== undefined) Object.defineProperty(window, name, previous);
    else delete record[name];
  };
}
