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

test("worker loads draft pick placement for every custom composite source", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/mockup/worker.ts"), "utf8");

  assert.match(source, /wizardDraftMockupLibraryPick\.findUnique/);
  assert.match(source, /pickRegion(?::\s*unknown)?\s*=\s*pick\?\.compositeRegionPx \?\? null/);
  assert.doesNotMatch(source, /if\s*\(\s*source\.scope\s*===\s*"TEMPLATE"\s*\)/);
});

test("generation row creation uses effective region fallback for draft picks", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/mockup/generation.ts"), "utf8");

  assert.match(
    source,
    /mockupLibraryPicks:\s*{\s*select:\s*{\s*sourceId:\s*true,\s*isPrimary:\s*true,\s*sortOrder:\s*true,\s*compositeRegionPx:\s*true/,
  );
  assert.match(source, /const pickRegionBySourceId = new Map/);
  assert.match(source, /const effective = resolveEffectiveCompositeRegion\({/);
  assert.doesNotMatch(
    source,
    /Boolean\(source\.compositeRegionPx\)\s*\|\|\s*source\.scope\s*===\s*"TEMPLATE"/,
  );
});
