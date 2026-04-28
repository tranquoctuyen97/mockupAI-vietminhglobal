import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PLACEMENT, type PlacementData } from "./types";
import { resolvePlacement } from "./resolver";

test("resolvePlacement supports default, _default, and first variant keys", () => {
  assert.equal(
    resolvePlacement(dataWithVariant("default", 10), "front")?.xMm,
    10,
  );
  assert.equal(
    resolvePlacement(dataWithVariant("_default", 20), "front")?.xMm,
    20,
  );
  assert.equal(
    resolvePlacement(dataWithVariant("12345", 30), "front")?.xMm,
    30,
  );
});

function dataWithVariant(variantKey: string, xMm: number): PlacementData {
  return {
    version: "2.1",
    variants: {
      [variantKey]: {
        front: {
          ...DEFAULT_PLACEMENT,
          xMm,
        },
      },
    },
  };
}
