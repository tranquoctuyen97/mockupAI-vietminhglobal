import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  parseCompositeRegionPx,
  resolveEffectiveCompositeRegion,
  scaleCompositeRegionToImage,
} from "./custom-library";

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

test("resolveEffectiveCompositeRegion uses pick before source before template default", () => {
  const templateDefault = {
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    rotationDeg: 0,
    imageWidth: 1000,
    imageHeight: 1000,
  };
  const sourceRegion = {
    x: 20,
    y: 20,
    width: 110,
    height: 110,
    rotationDeg: 0,
    imageWidth: 1000,
    imageHeight: 1000,
  };
  const pickRegion = {
    x: 30,
    y: 30,
    width: 120,
    height: 120,
    rotationDeg: 0,
    imageWidth: 1000,
    imageHeight: 1000,
  };

  assert.deepEqual(
    resolveEffectiveCompositeRegion({
      scope: "TEMPLATE",
      sourceRegion,
      pickRegion,
      templateDefaultRegion: templateDefault,
    }),
    pickRegion,
  );

  assert.deepEqual(
    resolveEffectiveCompositeRegion({
      scope: "TEMPLATE",
      sourceRegion: null,
      pickRegion: null,
      templateDefaultRegion: templateDefault,
    }),
    templateDefault,
  );
});

test("resolveEffectiveCompositeRegion uses source before pick before template default for draft sources", () => {
  const templateDefault = {
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    rotationDeg: 0,
    imageWidth: 1000,
    imageHeight: 1000,
  };
  const sourceRegion = {
    x: 20,
    y: 20,
    width: 110,
    height: 110,
    rotationDeg: 0,
    imageWidth: 1000,
    imageHeight: 1000,
  };
  const pickRegion = {
    x: 30,
    y: 30,
    width: 120,
    height: 120,
    rotationDeg: 0,
    imageWidth: 1000,
    imageHeight: 1000,
  };

  assert.deepEqual(
    resolveEffectiveCompositeRegion({
      scope: "DRAFT",
      sourceRegion,
      pickRegion,
      templateDefaultRegion: templateDefault,
    }),
    sourceRegion,
  );

  assert.deepEqual(
    resolveEffectiveCompositeRegion({
      scope: "DRAFT",
      sourceRegion: null,
      pickRegion,
      templateDefaultRegion: templateDefault,
    }),
    pickRegion,
  );

  assert.deepEqual(
    resolveEffectiveCompositeRegion({
      scope: "DRAFT",
      sourceRegion: null,
      pickRegion: null,
      templateDefaultRegion: templateDefault,
    }),
    templateDefault,
  );
});

test("scaleCompositeRegionToImage scales runtime region without mutating saved default", () => {
  const saved = {
    x: 100,
    y: 50,
    width: 300,
    height: 200,
    rotationDeg: 7,
    imageWidth: 1000,
    imageHeight: 500,
  };
  const scaled = scaleCompositeRegionToImage(saved, 2000, 1000);

  assert.deepEqual(scaled, {
    x: 200,
    y: 100,
    width: 600,
    height: 400,
    rotationDeg: 7,
    imageWidth: 2000,
    imageHeight: 1000,
  });
  assert.deepEqual(saved, {
    x: 100,
    y: 50,
    width: 300,
    height: 200,
    rotationDeg: 7,
    imageWidth: 1000,
    imageHeight: 500,
  });
});

test("resolveEffectiveCompositeRegion preserves relaxed saved pick regions", () => {
  const sourceRegion = {
    x: 20,
    y: 20,
    width: 110,
    height: 110,
    rotationDeg: 0,
    imageWidth: 1000,
    imageHeight: 1000,
  };
  const pickRegion = {
    x: -12.5,
    y: 30.25,
    width: 120.5,
    height: 90.5,
    rotationDeg: 4,
    imageWidth: 1000,
    imageHeight: 1000,
  };

  assert.deepEqual(
    resolveEffectiveCompositeRegion({
      scope: "TEMPLATE",
      sourceRegion,
      pickRegion,
      templateDefaultRegion: null,
    }),
    pickRegion,
  );
});

test("generation and worker use template mockup items instead of legacy custom sources", () => {
  const generation = readFileSync("src/lib/mockup/generation.ts", "utf8");
  const worker = readFileSync("src/lib/mockup/worker.ts", "utf8");

  assert.match(generation, /templateMockupItem/);
  assert.match(worker, /templateMockupItem/);
  assert.match(worker, /pick\.compositeRegionPx \?\? pick\.templateMockupItem\.mockup\.compositeRegionPx/);
  assert.match(worker, /scaleCompositeRegionToImage/);
  assert.doesNotMatch(worker, /effectiveRegion\.imageWidth = imgW/);
  assert.doesNotMatch(worker, /effectiveRegion\.imageHeight = imgH/);
  assert.doesNotMatch(generation, /customMockupSource/);
  assert.doesNotMatch(worker, /customMockupSource/);
});
