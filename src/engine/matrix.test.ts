import { describe, expect, it } from "vite-plus/test";
import {
  applyMatrix,
  clampPan,
  IDENTITY_MATRIX,
  invertMatrix,
  matrixToCss,
  multiplyMatrix,
  panForPinch,
  panForZoom,
  scaleMatrix,
  translationMatrix,
  zoomMatrix,
  type MekuriMatrix,
} from "./matrix";

function expectMatrixCloseTo(actual: MekuriMatrix | null, expected: MekuriMatrix): void {
  expect(actual).not.toBeNull();
  const matrix = actual as MekuriMatrix;
  expect(matrix.a).toBeCloseTo(expected.a);
  expect(matrix.b).toBeCloseTo(expected.b);
  expect(matrix.c).toBeCloseTo(expected.c);
  expect(matrix.d).toBeCloseTo(expected.d);
  expect(matrix.e).toBeCloseTo(expected.e);
  expect(matrix.f).toBeCloseTo(expected.f);
}

describe("matrix composition", () => {
  it("applies the right operand first", () => {
    const translateThenScale = multiplyMatrix(translationMatrix(10, 20), scaleMatrix(2));
    expect(applyMatrix(translateThenScale, { x: 3, y: 4 })).toEqual({ x: 16, y: 28 });

    const scaleThenTranslate = multiplyMatrix(scaleMatrix(2), translationMatrix(10, 20));
    expect(applyMatrix(scaleThenTranslate, { x: 3, y: 4 })).toEqual({ x: 26, y: 48 });
  });

  it("leaves a point untouched when composed with the identity", () => {
    const matrix = zoomMatrix(3, { x: -8, y: 12 });
    expect(applyMatrix(multiplyMatrix(IDENTITY_MATRIX, matrix), { x: 5, y: 7 })).toEqual(
      applyMatrix(matrix, { x: 5, y: 7 }),
    );
    expect(applyMatrix(multiplyMatrix(matrix, IDENTITY_MATRIX), { x: 5, y: 7 })).toEqual(
      applyMatrix(matrix, { x: 5, y: 7 }),
    );
  });

  it("inverts a matrix and inverts its own inversion", () => {
    const matrix = zoomMatrix(2.5, { x: -40, y: 16 });
    const inverse = invertMatrix(matrix);
    expect(inverse).not.toBeNull();
    if (inverse === null) throw new Error("expected an invertible matrix");

    const roundTrip = applyMatrix(inverse, applyMatrix(matrix, { x: 12, y: -4 }));
    expect(roundTrip.x).toBeCloseTo(12);
    expect(roundTrip.y).toBeCloseTo(-4);
    expectMatrixCloseTo(invertMatrix(inverse), matrix);
  });

  it("reports a singular matrix as uninvertible", () => {
    expect(invertMatrix(scaleMatrix(0))).toBeNull();
    expect(invertMatrix({ a: 1, b: 1, c: 1, d: 1, e: 0, f: 0 })).toBeNull();
  });

  it("serializes to the CSS matrix() form", () => {
    expect(matrixToCss(zoomMatrix(2, { x: -12, y: 8 }))).toBe("matrix(2, 0, 0, 2, -12, 8)");
    expect(matrixToCss(IDENTITY_MATRIX)).toBe("matrix(1, 0, 0, 1, 0, 0)");
  });
});

describe("pan derivation", () => {
  it("holds the content point under the anchor while the scale changes", () => {
    const anchor = { x: 120, y: 90 };
    const pan = panForZoom(2, 1, { x: 0, y: 0 }, anchor);
    expect(applyMatrix(zoomMatrix(2, pan), anchor)).toEqual(anchor);
  });

  it("holds the anchored point through a second zoom step", () => {
    const first = panForZoom(2, 1, { x: 0, y: 0 }, { x: 150, y: 100 });
    const anchor = { x: 250, y: 400 };
    const contentPoint = applyMatrix(invertMatrix(zoomMatrix(2, first)) as MekuriMatrix, anchor);
    const second = panForZoom(3, 2, first, anchor);
    const landed = applyMatrix(zoomMatrix(3, second), contentPoint);
    expect(landed.x).toBeCloseTo(anchor.x);
    expect(landed.y).toBeCloseTo(anchor.y);
  });

  it("follows a moving midpoint during a pinch", () => {
    const pan = panForPinch(2, 1, { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 150, y: 120 });
    expect(applyMatrix(zoomMatrix(2, pan), { x: 100, y: 100 })).toEqual({ x: 150, y: 120 });
  });

  it("derives no pan from a degenerate previous scale", () => {
    expect(panForPinch(2, 0, { x: 5, y: 5 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("clampPan", () => {
  const bounds = {
    contentWidth: 800,
    contentHeight: 600,
    viewportWidth: 400,
    viewportHeight: 600,
  };

  it("anchors an axis whose content fits inside the viewport", () => {
    // Height matches the viewport exactly, so no vertical offset survives.
    expect(clampPan({ x: -300, y: -300 }, bounds, 1)).toEqual({ x: -300, y: 0 });
    // Both axes fit at 1.5x only for height; the width still pans.
    expect(clampPan({ x: -300, y: 300 }, bounds, 1.5)).toEqual({ x: -300, y: 0 });
    expect(clampPan({ x: 300, y: 300 }, bounds, 1.5)).toEqual({ x: 0, y: 0 });
  });

  it("stops at the scaled content edges", () => {
    expect(clampPan({ x: -5000, y: 0 }, bounds, 2)).toEqual({ x: -1200, y: 0 });
    expect(clampPan({ x: 400, y: 0 }, bounds, 2)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: -600, y: 0 }, bounds, 2)).toEqual({ x: -600, y: 0 });
  });

  it("keeps a fitting axis anchored while the other axis pans", () => {
    const tall = { ...bounds, viewportHeight: 1200 };
    expect(clampPan({ x: -100, y: 999 }, tall, 2)).toEqual({ x: -100, y: 0 });
  });
});
