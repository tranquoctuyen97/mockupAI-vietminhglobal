import assert from "node:assert/strict";
import test from "node:test";
import { autoPlace, buildListingReadyPlacementData } from "./auto-place";
import {
  buildDefaultPlacementFromRatio,
  clampPlacementToPrintArea,
  resolvePlacementProfile,
  resolveProductType,
} from "./profile";
import type { Placement, PrintArea } from "./types";
import { getPlacementForView } from "./views";

// Mirrors src/lib/publish/printify.ts:mmToPrintifyCoords — Printify uses the
// design *center* relative to the print area, and scale = width / printAreaWidth.
function toPrintifyCoords(p: Placement, printArea: PrintArea) {
  return {
    x: (p.xMm + p.widthMm / 2) / printArea.widthMm,
    y: (p.yMm + p.heightMm / 2) / printArea.heightMm,
    scale: p.widthMm / printArea.widthMm,
  };
}

const PRINT_AREA_700x800: PrintArea = {
  // 700x800 px @ 300 DPI ≈ 59.27 x 67.73 mm — the exact mm scale is irrelevant
  // because everything is ratio-based; use round mm to keep the test readable.
  widthMm: 700,
  heightMm: 800,
  safeMarginMm: 0,
};

test("resolveProductType infers garment from explicit type and blueprint text", () => {
  assert.equal(resolveProductType({ productType: "T-Shirt" }), "T-Shirt");
  assert.equal(resolveProductType({ blueprintTitle: "Unisex Heavy Blend Hoodie" }), "Hoodie");
  assert.equal(resolveProductType({ blueprintTitle: "Crewneck Sweatshirt" }), "Sweatshirt");
  assert.equal(resolveProductType({ blueprintTitle: "Bella+Canvas Tee 3001" }), "T-Shirt");
  // Hoodie must win over the generic "shirt" match.
  assert.equal(resolveProductType({ blueprintTitle: "Hooded Sweatshirt" }), "Hoodie");
  assert.equal(resolveProductType({ blueprintTitle: "Random Mug" }), null);
});

test("square design: ~48% width, horizontally centered, chest-positioned", () => {
  const profile = resolvePlacementProfile({ productType: "T-Shirt" }, "front");
  const placement = buildDefaultPlacementFromRatio({
    printArea: PRINT_AREA_700x800,
    design: { widthPx: 1000, heightPx: 1000 },
    profile,
  });

  // widthRatio 0.48 → ~45-50% of print area width.
  const widthRatio = placement.widthMm / PRINT_AREA_700x800.widthMm;
  assert.ok(widthRatio >= 0.45 && widthRatio <= 0.5, `widthRatio=${widthRatio}`);

  // Square design → square placement box.
  assert.equal(Math.round(placement.widthMm), Math.round(placement.heightMm));

  const coords = toPrintifyCoords(placement, PRINT_AREA_700x800);
  assert.ok(Math.abs(coords.x - 0.5) < 0.001, `x=${coords.x}`);
  assert.ok(coords.y >= 0.42 && coords.y <= 0.46, `y=${coords.y}`);
  assert.ok(Math.abs(coords.scale - widthRatio) < 0.001, `scale=${coords.scale}`);
});

test("tall design does not overflow the print area", () => {
  const profile = resolvePlacementProfile({ productType: "T-Shirt" }, "front");
  const placement = buildDefaultPlacementFromRatio({
    printArea: PRINT_AREA_700x800,
    design: { widthPx: 500, heightPx: 4000 }, // very tall
    profile,
  });

  assert.ok(placement.xMm >= 0, `xMm=${placement.xMm}`);
  assert.ok(placement.yMm >= 0, `yMm=${placement.yMm}`);
  assert.ok(
    placement.xMm + placement.widthMm <= PRINT_AREA_700x800.widthMm + 0.01,
    `right=${placement.xMm + placement.widthMm}`,
  );
  assert.ok(
    placement.yMm + placement.heightMm <= PRINT_AREA_700x800.heightMm + 0.01,
    `bottom=${placement.yMm + placement.heightMm}`,
  );
});

test("wide design does not overflow the print area", () => {
  const profile = resolvePlacementProfile({ productType: "T-Shirt" }, "front");
  const placement = buildDefaultPlacementFromRatio({
    printArea: PRINT_AREA_700x800,
    design: { widthPx: 6000, heightPx: 500 }, // very wide
    profile,
  });

  assert.ok(placement.xMm >= 0, `xMm=${placement.xMm}`);
  assert.ok(placement.yMm >= 0, `yMm=${placement.yMm}`);
  assert.ok(
    placement.xMm + placement.widthMm <= PRINT_AREA_700x800.widthMm + 0.01,
    `right=${placement.xMm + placement.widthMm}`,
  );
  assert.ok(
    placement.yMm + placement.heightMm <= PRINT_AREA_700x800.heightMm + 0.01,
    `bottom=${placement.yMm + placement.heightMm}`,
  );
});

test("clampPlacementToPrintArea respects the safe margin", () => {
  const printArea: PrintArea = { widthMm: 700, heightMm: 800, safeMarginMm: 20 };
  const clamped = clampPlacementToPrintArea(
    { ...autoPlace({ design: { widthPx: 9000, heightPx: 9000 }, printArea }) },
    printArea,
  );

  assert.ok(clamped.xMm >= 20 - 0.01, `xMm=${clamped.xMm}`);
  assert.ok(clamped.yMm >= 20 - 0.01, `yMm=${clamped.yMm}`);
  assert.ok(clamped.xMm + clamped.widthMm <= 700 - 20 + 0.01);
  assert.ok(clamped.yMm + clamped.heightMm <= 800 - 20 + 0.01);
});

test("buildListingReadyPlacementData produces a front placement that round-trips", () => {
  const data = buildListingReadyPlacementData({
    design: { widthPx: 1200, heightPx: 1500 },
    printArea: PRINT_AREA_700x800,
    template: { blueprintTitle: "Gildan Heavy Cotton T-Shirt" },
  });

  const front = getPlacementForView(data, "front");
  assert.ok(front, "front placement should be present");
  if (!front) return;
  const coords = toPrintifyCoords(front, PRINT_AREA_700x800);
  assert.ok(Math.abs(coords.x - 0.5) < 0.001, `x=${coords.x}`);
  assert.ok(coords.scale > 0 && coords.scale <= 0.5, `scale=${coords.scale}`);
});
