import assert from "node:assert/strict";
import test from "node:test";
import { getCardState } from "./ColorMockupCard.js";

const draftSourceWithPlacement = {
  id: "s1", scope: "DRAFT",
  compositeRegionPx: { x: 10, y: 10, width: 100, height: 100, rotationDeg: 0, imageWidth: 800, imageHeight: 800 },
  imageUrl: "https://example.com/img.jpg", colorId: "c1", colorName: "Red", imageWidth: 800, imageHeight: 800,
};
const draftSourceNoPlacement = { ...draftSourceWithPlacement, compositeRegionPx: null };
const templateSource = { ...draftSourceWithPlacement, scope: "TEMPLATE" };

test("getCardState: no source → NO_SOURCE", () => {
  assert.equal(getCardState(null, null), "NO_SOURCE");
});

test("getCardState: DRAFT source without placement → NO_PLACEMENT", () => {
  assert.equal(getCardState(draftSourceNoPlacement, null), "NO_PLACEMENT");
});

test("getCardState: DRAFT source with placement → READY", () => {
  assert.equal(getCardState(draftSourceWithPlacement, null), "READY");
});

test("getCardState: TEMPLATE source (always has placement) → READY", () => {
  assert.equal(getCardState(templateSource, null), "READY");
});

test("getCardState: generatedOutputUrl present → GENERATED regardless of source", () => {
  assert.equal(getCardState(draftSourceWithPlacement, "https://example.com/out.jpg"), "GENERATED");
  assert.equal(getCardState(null, "https://example.com/out.jpg"), "GENERATED");
});
