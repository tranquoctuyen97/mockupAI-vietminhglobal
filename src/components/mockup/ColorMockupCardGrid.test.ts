import assert from "node:assert/strict";
import test from "node:test";
import { computeReadiness, findSourceForColor } from "./ColorMockupCardGrid.js";

const colors = [
  { id: "c1", name: "Red", hex: "#ff0000" },
  { id: "c2", name: "Blue", hex: "#0000ff" },
];

const sourceReady = { id: "s1", colorId: "c1", colorName: "Red", compositeRegionPx: { x:0,y:0,width:100,height:100,rotationDeg:0,imageWidth:800,imageHeight:800 }, scope: "DRAFT", imageUrl: "x" };
const sourceNoPlacement = { id: "s2", colorId: "c2", colorName: "Blue", compositeRegionPx: null, scope: "DRAFT", imageUrl: "y" };

test("findSourceForColor: matches by colorId", () => {
  const found = findSourceForColor("c1", [sourceReady, sourceNoPlacement]);
  assert.equal(found?.id, "s1");
});

test("findSourceForColor: falls back to colorName match", () => {
  const sourceNoId = { ...sourceReady, colorId: null };
  const found = findSourceForColor("c1", [sourceNoId, sourceNoPlacement], colors);
  assert.equal(found?.id, "s1");
});

test("findSourceForColor: falls back to nested color.name match", () => {
  const sourceWithNestedColor = { ...sourceReady, colorId: null, colorName: null, color: { id: "c1", name: "Red", hex: "#ff0000" } };
  const found = findSourceForColor("c1", [sourceWithNestedColor], colors);
  assert.equal(found?.id, "s1");
});

test("findSourceForColor: returns null when no match", () => {
  assert.equal(findSourceForColor("c99", [sourceReady]), null);
});

test("computeReadiness: all ready", () => {
  const sourceMap = new Map([["c1", sourceReady]]);
  // c2 has no source
  const result = computeReadiness(colors, sourceMap, new Map());
  assert.equal(result.readyCount, 1);
  assert.equal(result.totalCount, 2);
  assert.equal(result.allReady, false);
});

test("computeReadiness: all ready when all colors have source with placement", () => {
  const sourceMap = new Map([["c1", sourceReady], ["c2", sourceReady]]);
  const result = computeReadiness(colors, sourceMap, new Map());
  assert.equal(result.readyCount, 2);
  assert.equal(result.allReady, true);
});
