import assert from "node:assert/strict";
import test from "node:test";
import { parseCompositeRegionPx } from "./custom-library";

test("parseCompositeRegionPx preserves source image dimensions for draft custom composites", () => {
  const region = parseCompositeRegionPx({
    x: 120,
    y: 180,
    width: 420,
    height: 360,
    rotationDeg: 4.5,
    imageWidth: 1600,
    imageHeight: 1200,
  });

  assert.deepEqual(region, {
    x: 120,
    y: 180,
    width: 420,
    height: 360,
    rotationDeg: 4.5,
    imageWidth: 1600,
    imageHeight: 1200,
  });
});
