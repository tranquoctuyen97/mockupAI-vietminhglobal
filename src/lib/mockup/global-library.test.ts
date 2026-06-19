import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSmartFitCompositeRegion,
  chooseTemplateMockupsForColor,
  normalizeAppliesToColorIds,
  normalizeCompositeRenderMode,
  normalizeMockupLibraryScene,
  normalizeMockupLibraryView,
  resolveLibraryCompositeRegion,
} from "./global-library";

test("normalizeCompositeRenderMode accepts only COMPOSITE", () => {
  assert.equal(normalizeCompositeRenderMode("COMPOSITE"), "COMPOSITE");
  assert.equal(normalizeCompositeRenderMode(null), "COMPOSITE");
  assert.equal(normalizeCompositeRenderMode("FINAL"), null);
  assert.equal(normalizeCompositeRenderMode("anything"), null);
});

test("normalizes library view and scene enum values", () => {
  assert.equal(normalizeMockupLibraryView("front"), "front");
  assert.equal(normalizeMockupLibraryView("sleeve_left"), "sleeve_left");
  assert.equal(normalizeMockupLibraryView("bad"), null);
  assert.equal(normalizeMockupLibraryScene("flat_lay"), "flat_lay");
  assert.equal(normalizeMockupLibraryScene("model"), "model");
  assert.equal(normalizeMockupLibraryScene("bad"), null);
});

test("buildSmartFitCompositeRegion returns a valid centered region", () => {
  assert.deepEqual(buildSmartFitCompositeRegion(1000, 800), {
    x: 250,
    y: 150,
    width: 500,
    height: 500,
    rotationDeg: 0,
    imageWidth: 1000,
    imageHeight: 800,
  });
});

test("normalizeAppliesToColorIds validates against store colors", () => {
  assert.deepEqual(normalizeAppliesToColorIds([], new Set(["white", "black"])), []);
  assert.deepEqual(normalizeAppliesToColorIds(["black", "white", "black"], new Set(["white", "black"])), ["black", "white"]);
  assert.equal(normalizeAppliesToColorIds(["missing"], new Set(["white", "black"])), null);
});

test("chooseTemplateMockupsForColor uses exact matches before generic fallback", () => {
  const items = [
    { id: "generic", appliesToColorIds: [], isPrimary: false, sortOrder: 0, createdAt: new Date("2026-01-01") },
    { id: "exact", appliesToColorIds: ["white"], isPrimary: true, sortOrder: 5, createdAt: new Date("2026-01-02") },
  ];
  assert.deepEqual(chooseTemplateMockupsForColor(items, "white").map((item) => item.id), ["exact"]);
  assert.deepEqual(chooseTemplateMockupsForColor(items, "black").map((item) => item.id), ["generic"]);
});

test("resolveLibraryCompositeRegion uses draft override before library frame before smart fit", () => {
  const library = { x: 10, y: 20, width: 300, height: 300, rotationDeg: 0, imageWidth: 1000, imageHeight: 800 };
  const override = { x: 40, y: 50, width: 200, height: 200, rotationDeg: 5, imageWidth: 1000, imageHeight: 800 };
  assert.deepEqual(resolveLibraryCompositeRegion({ draftOverride: override, libraryRegion: library, imageWidth: 1000, imageHeight: 800 }), override);
  assert.deepEqual(resolveLibraryCompositeRegion({ draftOverride: null, libraryRegion: library, imageWidth: 1000, imageHeight: 800 }), library);
  assert.deepEqual(resolveLibraryCompositeRegion({ draftOverride: null, libraryRegion: null, imageWidth: 1000, imageHeight: 800 }), buildSmartFitCompositeRegion(1000, 800));
});
