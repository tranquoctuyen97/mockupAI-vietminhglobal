import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCustomPrintAreaPx,
  computeFitRegion,
  computeListingReadyRegion,
  computeLogoRegion,
  isBadCompositeRegion,
  isSentinelRegion,
  materializeSmartFitPlacement,
  shouldAutoApplySmartFit,
} from "./placement-region";

// Shared test fixture: standard apparel front print area
const pa = { x: 171, y: 124, width: 659, height: 800 };

// ─── isBadCompositeRegion ─────────────────────────────────────────────────────

test("isBadCompositeRegion catches legacy huge region (659×753)", () => {
  assert.equal(
    isBadCompositeRegion({ x: 171, y: 124, width: 659, height: 753 }, pa),
    true,
  );
});

test("isBadCompositeRegion catches out-of-bounds region (x=0, y=0)", () => {
  assert.equal(
    isBadCompositeRegion({ x: 0, y: 0, width: 300, height: 300 }, pa),
    true,
  );
});

test("isBadCompositeRegion does NOT catch Max Fit (659×659)", () => {
  assert.equal(
    isBadCompositeRegion({ x: 171, y: 195, width: 659, height: 659 }, pa),
    false,
  );
});

test("isBadCompositeRegion does NOT catch Smart Fit (316×316)", () => {
  assert.equal(
    isBadCompositeRegion({ x: 342, y: 310, width: 316, height: 316 }, pa),
    false,
  );
});

// ─── computeListingReadyRegion ────────────────────────────────────────────────

test("computeListingReadyRegion — square design → ratio-based, chest area", () => {
  const r = computeListingReadyRegion(pa, 1024, 1024);
  // Width: ~59% of print-area width
  const expectedW = Math.round(pa.width * 0.59);
  assert.ok(Math.abs(r.width - expectedW) <= 1, `width ${r.width} should be ~${expectedW}`);
  assert.ok(Math.abs(r.height - expectedW) <= 1, `height ${r.height} should be ~${expectedW}`);
  // X: centered horizontally
  const expectedX = Math.round(pa.x + (pa.width - expectedW) / 2);
  assert.ok(Math.abs(r.x - expectedX) <= 1, `x ${r.x} should be ~${expectedX}`);
  // Y: centerY at ~47.5% of print-area height
  const expectedY = Math.round(pa.y + pa.height * 0.475 - expectedW / 2);
  assert.ok(Math.abs(r.y - expectedY) <= 1, `y ${r.y} should be ~${expectedY}`);
  // Must not be bad
  assert.equal(isBadCompositeRegion(r, pa), false);
});

test("computeListingReadyRegion — tall design → height capped at 66%", () => {
  // Very portrait: 500×1500 → aspect = 0.33
  const r = computeListingReadyRegion(pa, 500, 1500);
  const maxH = pa.height * 0.66; // 528
  assert.ok(r.height <= maxH + 1, `height ${r.height} should be <= ${maxH}`);
  assert.equal(isBadCompositeRegion(r, pa), false);
});

// ─── computeFitRegion (Max Fit) ───────────────────────────────────────────────

test("computeFitRegion — square design → W=659, H=659, not bad", () => {
  const r = computeFitRegion(pa, 1024, 1024);
  assert.equal(r.width, 659);
  assert.equal(r.height, 659);
  assert.equal(isBadCompositeRegion(r, pa), false);
});

// ─── computeLogoRegion ────────────────────────────────────────────────────────

test("computeLogoRegion — square design → W≈119, left chest", () => {
  const r = computeLogoRegion(pa, 1024, 1024);
  // Width: 659 * 0.18 ≈ 119
  assert.ok(Math.abs(r.width - 119) <= 1, `width ${r.width} should be ~119`);
  assert.equal(isBadCompositeRegion(r, pa), false);
});

test("computeLogoRegion — tall design → height capped at 25%", () => {
  const r = computeLogoRegion(pa, 500, 1500);
  const maxH = pa.height * 0.25; // 200
  assert.ok(r.height <= maxH + 1, `height ${r.height} should be <= ${maxH}`);
  assert.equal(isBadCompositeRegion(r, pa), false);
});

// ─── computeCustomPrintAreaPx ─────────────────────────────────────────────────

test("computeCustomPrintAreaPx — centered, ≤80% of image", () => {
  const r = computeCustomPrintAreaPx({ widthMm: 340, heightMm: 420 }, 1024, 1024);
  assert.ok(r.x > 0, `x ${r.x} should be > 0`);
  assert.ok(r.width <= 1024 * 0.8 + 1, `width ${r.width} should be <= 819`);
  assert.ok(r.height <= 1024 * 0.8 + 1, `height ${r.height} should be <= 819`);
  // Should be centered
  const centerX = r.x + r.width / 2;
  assert.ok(Math.abs(centerX - 512) <= 10, `centerX ${centerX} should be ~512`);
});

test("computeCustomPrintAreaPx — respects real mockup dimensions (not 1000px)", () => {
  // Simulate a real mockup image that is 3000×2400
  const r = computeCustomPrintAreaPx({ widthMm: 340, heightMm: 420 }, 3000, 2400);
  assert.ok(r.width > 0);
  assert.ok(r.height > 0);
  assert.ok(r.x >= 0);
  assert.ok(r.y >= 0);
  // Must not use hardcoded 1000
  assert.ok(r.width !== 659, "should not use hardcoded 1000px dimensions");
});

// ─── isSentinelRegion ─────────────────────────────────────────────────────────

test("isSentinelRegion detects (0,0,w,h)", () => {
  assert.equal(
    isSentinelRegion({ x: 0, y: 0, width: 1024, height: 1024 }, 1024, 1024),
    true,
  );
});

test("isSentinelRegion does NOT false-positive on normal region", () => {
  assert.equal(
    isSentinelRegion({ x: 100, y: 100, width: 500, height: 500 }, 1024, 1024),
    false,
  );
});

// ─── shouldAutoApplySmartFit ─────────────────────────────────────────────────

const smartFitPrintArea = { x: 40, y: 40, width: 320, height: 400 };
const smartFitImageW = 400;
const smartFitImageH = 500;

test("shouldAutoApplySmartFit — returns true when existingRegion is null/undefined", () => {
  assert.equal(
    shouldAutoApplySmartFit({
      existingRegion: null,
      printAreaPx: smartFitPrintArea,
      imageWidth: smartFitImageW,
      imageHeight: smartFitImageH,
    }),
    true,
  );

  assert.equal(
    shouldAutoApplySmartFit({
      existingRegion: undefined,
      printAreaPx: smartFitPrintArea,
      imageWidth: smartFitImageW,
      imageHeight: smartFitImageH,
    }),
    true,
  );
});

test("shouldAutoApplySmartFit — returns true for sentinel region (0,0,imageW,imageH)", () => {
  assert.equal(
    shouldAutoApplySmartFit({
      existingRegion: { x: 0, y: 0, width: smartFitImageW, height: smartFitImageH },
      printAreaPx: smartFitPrintArea,
      imageWidth: smartFitImageW,
      imageHeight: smartFitImageH,
    }),
    true,
  );
});

test("shouldAutoApplySmartFit — returns true for bad composite region (out of bounds)", () => {
  assert.equal(
    shouldAutoApplySmartFit({
      existingRegion: { x: 0, y: 0, width: 10, height: 10 },
      printAreaPx: { x: 300, y: 300, width: 50, height: 50 },
      imageWidth: smartFitImageW,
      imageHeight: smartFitImageH,
    }),
    true,
  );
});

test("shouldAutoApplySmartFit — returns false for valid Smart Fit region", () => {
  assert.equal(
    shouldAutoApplySmartFit({
      existingRegion: { x: 50, y: 80, width: 150, height: 200 },
      printAreaPx: smartFitPrintArea,
      imageWidth: smartFitImageW,
      imageHeight: smartFitImageH,
    }),
    false,
  );
});

test("shouldAutoApplySmartFit — returns false for valid manual smaller region", () => {
  assert.equal(
    shouldAutoApplySmartFit({
      existingRegion: { x: 100, y: 120, width: 80, height: 100 },
      printAreaPx: smartFitPrintArea,
      imageWidth: smartFitImageW,
      imageHeight: smartFitImageH,
    }),
    false,
  );
});

// ─── materializeSmartFitPlacement ──────────────────────────────────────────────

test("materializeSmartFitPlacement returns clamped Smart Fit region inside print area", () => {
  const printAreaMm = { widthMm: 340, heightMm: 420 };
  const result = materializeSmartFitPlacement({
    printAreaMm,
    imageWidth: 1000,
    imageHeight: 1200,
    designWidth: 800,
    designHeight: 600,
  });

  assert.ok(result !== null, "result should not be null");
  const r = result!;
  assert.ok(r.width > 0);
  assert.ok(r.height > 0);
  assert.equal(r.rotationDeg, 0);
  assert.equal(r.imageWidth, 1000);
  assert.equal(r.imageHeight, 1200);
  // Region must be within image bounds
  assert.ok(r.x >= 0, `x ${r.x} should be >= 0`);
  assert.ok(r.y >= 0, `y ${r.y} should be >= 0`);
  assert.ok(r.x + r.width <= 1000, `right edge ${r.x + r.width} should be <= 1000`);
  assert.ok(r.y + r.height <= 1200, `bottom edge ${r.y + r.height} should be <= 1200`);
});

test("materializeSmartFitPlacement returns null when design dimensions are missing", () => {
  const printAreaMm = { widthMm: 340, heightMm: 420 };

  assert.equal(
    materializeSmartFitPlacement({
      printAreaMm,
      imageWidth: 1000,
      imageHeight: 1200,
      designWidth: 0,
      designHeight: 600,
    }),
    null,
  );

  assert.equal(
    materializeSmartFitPlacement({
      printAreaMm,
      imageWidth: 1000,
      imageHeight: 1200,
      designWidth: 800,
      designHeight: 0,
    }),
    null,
  );
});

test("materializeSmartFitPlacement returns null when image dimensions are missing", () => {
  const printAreaMm = { widthMm: 340, heightMm: 420 };
  assert.equal(
    materializeSmartFitPlacement({
      printAreaMm,
      imageWidth: 0,
      imageHeight: 1200,
      designWidth: 800,
      designHeight: 600,
    }),
    null,
  );
});

test("materializeSmartFitPlacement handles tall/portrait design aspect ratio", () => {
  const result = materializeSmartFitPlacement({
    printAreaMm: { widthMm: 300, heightMm: 400 },
    imageWidth: 800,
    imageHeight: 1000,
    designWidth: 400,
    designHeight: 1200, // portrait: aspect 0.33
  });

  assert.ok(result !== null, "result should not be null");
  // Smart Fit caps height at 66% of print area height
  const maxHeight = Math.round(1000 * 0.8 * 0.66);
  assert.ok(
    result!.height <= maxHeight,
    `height ${result!.height} should be <= ${maxHeight}`,
  );
});

// ─── New Smart Fit (0.59 / 0.475 / 0.66) — customer-driven ─────────────────

test("Smart Fit — golden: customer print area 717×819, design 426×522", () => {
  const printArea = { x: 154, y: 101, width: 717, height: 819 };
  const r = computeListingReadyRegion(printArea, 426, 522);

  // Width ~420-435, close to customer target W≈426
  assert.ok(r.width >= 420, `width ${r.width} should be >= 420`);
  assert.ok(r.width <= 435, `width ${r.width} should be <= 435`);

  // Height ~510-535, close to customer target H≈522
  assert.ok(r.height >= 505, `height ${r.height} should be >= 505`);
  assert.ok(r.height <= 540, `height ${r.height} should be <= 540`);

  // X ≈ 301 (154 + (717-423)/2)
  assert.ok(r.x >= 295, `x ${r.x} should be >= 295`);
  assert.ok(r.x <= 305, `x ${r.x} should be <= 305`);

  // Y ≈ 231 (101 + 819*0.475 - 518/2)
  assert.ok(r.y >= 225, `y ${r.y} should be >= 225`);
  assert.ok(r.y <= 238, `y ${r.y} should be <= 238`);

  // Within print area
  assert.ok(r.x >= printArea.x, `x ${r.x} should be >= printArea.x ${printArea.x}`);
  assert.ok(r.y >= printArea.y, `y ${r.y} should be >= printArea.y ${printArea.y}`);
  assert.ok(
    r.x + r.width <= printArea.x + printArea.width,
    `right edge ${r.x + r.width} should be <= ${printArea.x + printArea.width}`,
  );
  assert.ok(
    r.y + r.height <= printArea.y + printArea.height,
    `bottom edge ${r.y + r.height} should be <= ${printArea.y + printArea.height}`,
  );

  assert.equal(isBadCompositeRegion(r, printArea), false);
});

test("Smart Fit — width ratio in [0.58, 0.60], height ratio ≤ 0.66", () => {
  const r = computeListingReadyRegion(pa, 1024, 1024);
  const wRatio = r.width / pa.width;
  const hRatio = r.height / pa.height;
  assert.ok(wRatio >= 0.58, `widthRatio ${wRatio} should be >= 0.58`);
  assert.ok(wRatio <= 0.60, `widthRatio ${wRatio} should be <= 0.60`);
  assert.ok(hRatio <= 0.66, `heightRatio ${hRatio} should be <= 0.66`);
});

test("Smart Fit — centerY relative in [0.46, 0.49]", () => {
  const r = computeListingReadyRegion(pa, 1024, 1024);
  const centerY = r.y + r.height / 2;
  const relativeCenterY = (centerY - pa.y) / pa.height;
  assert.ok(relativeCenterY >= 0.46, `centerY relative ${relativeCenterY} should be >= 0.46`);
  assert.ok(relativeCenterY <= 0.49, `centerY relative ${relativeCenterY} should be <= 0.49`);
});

test("Smart Fit — very wide design stays inside print area", () => {
  // 3000×500 → aspect 6.0, very wide banner
  const r = computeListingReadyRegion(pa, 3000, 500);
  assert.ok(r.width <= pa.width, `width ${r.width} should be <= ${pa.width}`);
  assert.ok(r.x >= pa.x, `x ${r.x} should be >= ${pa.x}`);
  assert.ok(r.x + r.width <= pa.x + pa.width);
  assert.equal(isBadCompositeRegion(r, pa), false);
});

// ─── Regression: Max Fit unchanged ─────────────────────────────────────────

test("Max Fit — still fills print area (larger than Smart Fit)", () => {
  const smart = computeListingReadyRegion(pa, 1024, 1024);
  const max = computeFitRegion(pa, 1024, 1024);
  // Max Fit should be larger than Smart Fit
  assert.ok(max.width > smart.width, `Max width ${max.width} should be > Smart width ${smart.width}`);
  assert.ok(max.height > smart.height, `Max height ${max.height} should be > Smart height ${smart.height}`);
  assert.equal(isBadCompositeRegion(max, pa), false);
});

// ─── Regression: Logo unchanged ────────────────────────────────────────────

test("Logo — still small left-chest (~18% width)", () => {
  const r = computeLogoRegion(pa, 1024, 1024);
  const expectedW = Math.round(pa.width * 0.18);
  assert.ok(Math.abs(r.width - expectedW) <= 1, `Logo width ${r.width} should be ~${expectedW}`);
  // Logo should be much smaller than Smart Fit
  const smart = computeListingReadyRegion(pa, 1024, 1024);
  assert.ok(r.width < smart.width, `Logo width ${r.width} should be < Smart width ${smart.width}`);
  assert.equal(isBadCompositeRegion(r, pa), false);
});
