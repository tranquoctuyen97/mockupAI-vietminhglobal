import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidCompositeRegionPx, normalizeCompositeRegionPx } from "./custom-library";

describe("isValidCompositeRegionPx", () => {
  const valid = {
    x: 100, y: 150, width: 300, height: 300,
    rotationDeg: 0, imageWidth: 1024, imageHeight: 1024,
  };

  it("returns true for valid region", () => {
    assert.equal(isValidCompositeRegionPx(valid), true);
  });

  it("returns true when rotationDeg is missing (optional)", () => {
    const { rotationDeg, ...rest } = valid;
    assert.equal(isValidCompositeRegionPx(rest), true);
  });

  it("returns false for null/undefined", () => {
    assert.equal(isValidCompositeRegionPx(null), false);
    assert.equal(isValidCompositeRegionPx(undefined), false);
  });

  it("returns false for non-object", () => {
    assert.equal(isValidCompositeRegionPx("hello"), false);
    assert.equal(isValidCompositeRegionPx(123), false);
  });

  it("returns false when required numeric fields are missing", () => {
    assert.equal(isValidCompositeRegionPx({ x: 1, y: 2 }), false);
    assert.equal(isValidCompositeRegionPx({ width: 1, height: 2 }), false);
  });

  it("returns false for non-finite numbers", () => {
    assert.equal(isValidCompositeRegionPx({ ...valid, x: NaN }), false);
    assert.equal(isValidCompositeRegionPx({ ...valid, width: Infinity }), false);
  });

  it("returns false for zero/negative width/height/imageWidth/imageHeight", () => {
    assert.equal(isValidCompositeRegionPx({ ...valid, width: 0 }), false);
    assert.equal(isValidCompositeRegionPx({ ...valid, height: -5 }), false);
    assert.equal(isValidCompositeRegionPx({ ...valid, imageWidth: 0 }), false);
    assert.equal(isValidCompositeRegionPx({ ...valid, imageHeight: -1 }), false);
  });

  it("accepts negative x/y (valid for manual placement)", () => {
    assert.equal(isValidCompositeRegionPx({ ...valid, x: -999 }), true);
    assert.equal(isValidCompositeRegionPx({ ...valid, y: -20 }), true);
  });

  it("accepts non-integer values", () => {
    assert.equal(isValidCompositeRegionPx({ ...valid, x: 100.5, y: 150.7 }), true);
  });
});

describe("normalizeCompositeRegionPx", () => {
  it("returns normalized region with rotationDeg defaulted to 0", () => {
    const input = {
      x: 100, y: 150, width: 300, height: 300,
      imageWidth: 1024, imageHeight: 1024,
    };
    const result = normalizeCompositeRegionPx(input);
    assert.deepEqual(result, {
      x: 100, y: 150, width: 300, height: 300,
      rotationDeg: 0, imageWidth: 1024, imageHeight: 1024,
    });
  });

  it("preserves explicit rotationDeg", () => {
    const result = normalizeCompositeRegionPx({
      x: 100, y: 150, width: 300, height: 300,
      rotationDeg: 45, imageWidth: 1024, imageHeight: 1024,
    });
    assert.equal(result?.rotationDeg, 45);
  });

  it("returns null for invalid input", () => {
    assert.equal(normalizeCompositeRegionPx(null), null);
    assert.equal(normalizeCompositeRegionPx({ x: "hello" }), null);
    assert.equal(normalizeCompositeRegionPx({ x: 1, y: 2, width: -1, height: 5 }), null);
  });
});
