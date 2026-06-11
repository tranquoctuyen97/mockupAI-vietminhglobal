import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCustomPrintAreaPx,
  computeFitRegion,
  computeListingReadyRegion,
  computeLogoRegion,
  isBadCompositeRegion,
  isSentinelRegion,
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

test("computeListingReadyRegion — square design → W≈316, H≈316, chest area", () => {
  const r = computeListingReadyRegion(pa, 1024, 1024);
  // Width: 659 * 0.48 ≈ 316
  assert.ok(Math.abs(r.width - 316) <= 1, `width ${r.width} should be ~316`);
  assert.ok(Math.abs(r.height - 316) <= 1, `height ${r.height} should be ~316`);
  // X: 171 + (659-316)/2 = 171 + 171.5 ≈ 342
  assert.ok(Math.abs(r.x - 342) <= 1, `x ${r.x} should be ~342`);
  // Y: 124 + 800*0.43 - 316/2 = 124 + 344 - 158 = 310
  assert.ok(Math.abs(r.y - 310) <= 1, `y ${r.y} should be ~310`);
  // Must not be bad
  assert.equal(isBadCompositeRegion(r, pa), false);
});

test("computeListingReadyRegion — tall design → height capped at 55%", () => {
  // Very portrait: 500×1500 → aspect = 0.33
  const r = computeListingReadyRegion(pa, 500, 1500);
  const maxH = pa.height * 0.55; // 440
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
