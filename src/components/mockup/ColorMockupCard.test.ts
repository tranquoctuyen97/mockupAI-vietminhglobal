import assert from "node:assert/strict";
import test from "node:test";
import { getCardState, type CardSource } from "./ColorMockupCard.js";

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

// --- getCardState with pick placement ---

test("getCardState: TEMPLATE source with compositeRegionPx from pick → READY", () => {
  const source: CardSource = {
    id: "s1",
    scope: "TEMPLATE",
    imageUrl: "https://cdn.example.com/mockup.jpg",
    compositeRegionPx: {
      x: 100, y: 150, width: 200, height: 250,
      rotationDeg: 0, imageWidth: 1000, imageHeight: 1200,
    },
  };
  assert.equal(getCardState(source, null), "READY");
});

test("getCardState: DRAFT source with compositeRegionPx directly → READY", () => {
  const source: CardSource = {
    id: "s2",
    scope: "DRAFT",
    imageUrl: "https://cdn.example.com/mockup.jpg",
    compositeRegionPx: {
      x: 80, y: 100, width: 180, height: 220,
      rotationDeg: 0, imageWidth: 800, imageHeight: 1000,
    },
  };
  assert.equal(getCardState(source, null), "READY");
});

test("getCardState: TEMPLATE source with no compositeRegionPx → NO_PLACEMENT", () => {
  const source: CardSource = {
    id: "s3",
    scope: "TEMPLATE",
    imageUrl: "https://cdn.example.com/mockup.jpg",
    compositeRegionPx: null,
  };
  assert.equal(getCardState(source, null), "NO_PLACEMENT");
});

test("getCardState: TEMPLATE source with sentinel region → NO_PLACEMENT", () => {
  const source: CardSource = {
    id: "s4",
    scope: "TEMPLATE",
    imageUrl: "https://cdn.example.com/mockup.jpg",
    imageWidth: 1000,
    imageHeight: 1000,
    compositeRegionPx: {
      x: 0, y: 0, width: 1000, height: 1000,
      rotationDeg: 0, imageWidth: 1000, imageHeight: 1000,
    },
  };
  assert.equal(getCardState(source, null), "NO_PLACEMENT");
});

test("getCardState: outputUrl exists → GENERATED regardless of placement", () => {
  const source: CardSource = {
    id: "s5",
    scope: "TEMPLATE",
    imageUrl: "https://cdn.example.com/mockup.jpg",
    compositeRegionPx: null,
  };
  assert.equal(getCardState(source, "https://cdn.example.com/output.jpg"), "GENERATED");
});
