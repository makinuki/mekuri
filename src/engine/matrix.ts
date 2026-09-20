// Zero-dependency 2D affine matrix primitives for the zoom layer. A matrix uses
// the six-component form CSS matrix() consumes: x' = a*x + c*y + e and
// y' = b*x + d*y + f. The gesture layer composes zoom and pan here and writes
// the result to the element it transforms. Nothing in this module touches the
// DOM, so hosts may reuse the math for canvas or other custom renderers.

import type { MekuriPoint } from "./types";

export interface MekuriMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Unscaled content extents and the visible viewport that bounds panning. */
export interface MekuriPanBounds {
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export const IDENTITY_MATRIX: MekuriMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

export function translationMatrix(x: number, y: number): MekuriMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaleMatrix(scale: number): MekuriMatrix {
  return { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 };
}

/** Composes two matrices: right applies first, then left. */
export function multiplyMatrix(left: MekuriMatrix, right: MekuriMatrix): MekuriMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function applyMatrix(matrix: MekuriMatrix, point: MekuriPoint): MekuriPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

/** Inverse of a matrix, or null when it is singular and cannot be inverted. */
export function invertMatrix(matrix: MekuriMatrix): MekuriMatrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (determinant === 0) return null;
  const { a, b, c, d, e, f } = matrix;
  return {
    a: d / determinant,
    b: -b / determinant,
    c: -c / determinant,
    d: a / determinant,
    e: (c * f - d * e) / determinant,
    f: (b * e - a * f) / determinant,
  };
}

/** Matrix of a zoom layer whose origin sits at the top left of the viewport: a
 * content point lands at scale * point + pan. */
export function zoomMatrix(scale: number, pan: MekuriPoint): MekuriMatrix {
  return multiplyMatrix(translationMatrix(pan.x, pan.y), scaleMatrix(scale));
}

export function matrixToCss(matrix: MekuriMatrix): string {
  return `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${matrix.e}, ${matrix.f})`;
}

/** Pan that keeps the content point under `from` beneath `to` while the scale
 * changes from previousScale to scale. Both coordinates are viewport-local. */
export function panForPinch(
  scale: number,
  previousScale: number,
  previousPan: MekuriPoint,
  from: MekuriPoint,
  to: MekuriPoint,
): MekuriPoint {
  if (!(previousScale > 0)) return { x: 0, y: 0 };
  const contentX = (from.x - previousPan.x) / previousScale;
  const contentY = (from.y - previousPan.y) / previousScale;
  return { x: to.x - contentX * scale, y: to.y - contentY * scale };
}

/** Pan that holds the content point under a fixed anchor while the scale
 * changes. The single-anchor case of panForPinch. */
export function panForZoom(
  scale: number,
  previousScale: number,
  previousPan: MekuriPoint,
  anchor: MekuriPoint,
): MekuriPoint {
  return panForPinch(scale, previousScale, previousPan, anchor, anchor);
}

/** Clamps pan so scaled content always covers the viewport: an axis larger than
 * the viewport cannot be dragged past its own edge, and an axis that fits keeps
 * the origin, so no background gap can be revealed. */
export function clampPan(pan: MekuriPoint, bounds: MekuriPanBounds, scale: number): MekuriPoint {
  return {
    x: clampAxis(pan.x, bounds.contentWidth * scale, bounds.viewportWidth),
    y: clampAxis(pan.y, bounds.contentHeight * scale, bounds.viewportHeight),
  };
}

function clampAxis(value: number, scaledContent: number, viewport: number): number {
  if (!(scaledContent > viewport)) return 0;
  return Math.min(0, Math.max(viewport - scaledContent, value));
}
