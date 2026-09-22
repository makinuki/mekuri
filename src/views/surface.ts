// Gesture and keyboard wiring for the prebuilt views, in the shape the default
// host consumes: the gesture layer attaches to the pointer surface and writes
// its matrix to the transform target, and the keyboard dispatcher attaches to
// the owner document so a shortcut reaches the reader wherever focus sits. The
// engine scale is re-applied whenever it changes, because the pan held by the
// gesture layer only belongs to the layer that measured the geometry.

import { useLayoutEffect, useRef, type RefObject } from "react";
import {
  attachGestures,
  type MekuriGestureController,
  type MekuriGestureOptions,
} from "../engine/gestures";
import {
  attachKeyboard,
  type MekuriKeyboardController,
  type MekuriKeyboardOptions,
} from "../engine/keyboard";
import type { MekuriViewEngine } from "../engine/store";

export interface MekuriSurfaceOptions {
  engine: MekuriViewEngine;
  /** Element that receives the pointer stream: the reading surface. */
  surfaceRef: RefObject<HTMLElement | null>;
  /** Element the zoom matrix is applied to. Defaults to the surface. */
  transformRef?: RefObject<HTMLElement | null>;
  /** Attaches the gesture layer. Defaults to true. */
  gestures?: boolean;
  /** Attaches the keyboard dispatcher. Defaults to true. */
  keyboard?: boolean;
  /** Engine scale the view is rendering. A change re-applies the matrix, so
   * keyboard and HUD zoom land on the transform target too. Omit to leave the
   * matrix to the gesture layer alone. */
  zoomScale?: number;
  gestureOptions?: Omit<MekuriGestureOptions, "engine" | "element" | "transformTarget">;
  keyboardOptions?: Omit<MekuriKeyboardOptions, "engine" | "element" | "target">;
}

export interface MekuriSurfaceController {
  getGestures(): MekuriGestureController | null;
  getKeyboard(): MekuriKeyboardController | null;
}

/** Attaches the pointer and keyboard layers to a reader surface for the
 * lifetime of the component that calls it. */
export function useMekuriSurface(options: MekuriSurfaceOptions): MekuriSurfaceController {
  const { engine, surfaceRef, transformRef, gestures = true, keyboard = true, zoomScale } = options;
  const gestureRef = useRef<MekuriGestureController | null>(null);
  const keyboardRef = useRef<MekuriKeyboardController | null>(null);

  // Options are read at attach time. A host that rebinds a map re-attaches by
  // changing one of the flags or remounting the view.
  const gestureOptionsRef = useRef(options.gestureOptions);
  gestureOptionsRef.current = options.gestureOptions;
  const keyboardOptionsRef = useRef(options.keyboardOptions);
  keyboardOptionsRef.current = options.keyboardOptions;

  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (element === null) return undefined;
    if (gestures) {
      gestureRef.current = attachGestures({
        engine,
        element,
        transformTarget: transformRef?.current ?? undefined,
        ...gestureOptionsRef.current,
      });
    }
    if (keyboard) {
      keyboardRef.current = attachKeyboard({
        engine,
        element,
        ...keyboardOptionsRef.current,
      });
    }
    return () => {
      gestureRef.current?.detach();
      gestureRef.current = null;
      keyboardRef.current?.detach();
      keyboardRef.current = null;
    };
  }, [engine, gestures, keyboard, surfaceRef, transformRef]);

  useLayoutEffect(() => {
    gestureRef.current?.sync();
  }, [zoomScale]);

  const controllerRef = useRef<MekuriSurfaceController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = {
      getGestures: () => gestureRef.current,
      getKeyboard: () => keyboardRef.current,
    };
  }
  return controllerRef.current;
}
