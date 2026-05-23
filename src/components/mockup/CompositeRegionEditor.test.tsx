import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentPath = "src/components/mockup/CompositeRegionEditor.tsx";

test("CompositeRegionEditor uses react-rnd for drag and resize", () => {
  const source = readFileSync(componentPath, "utf8");

  assert.match(source, /from ["']react-rnd["']/);
  assert.match(source, /<Rnd\b/);
  assert.match(source, /onDragStop/);
  assert.match(source, /onResizeStop/);
});

test("CompositeRegionEditor exposes numeric rotation and advanced pixel fields", () => {
  const source = readFileSync(componentPath, "utf8");

  assert.match(source, /rotationDeg/);
  assert.match(source, /Rotation \(degrees\)/);
  assert.match(source, /\["x", "y", "width", "height", "rotationDeg"\]/);
  assert.match(source, /name=\{field\}/);
  for (const field of ["x", "y", "width", "height", "rotationDeg"]) {
    assert.match(source, new RegExp(`["']${field}["']`));
  }
});
