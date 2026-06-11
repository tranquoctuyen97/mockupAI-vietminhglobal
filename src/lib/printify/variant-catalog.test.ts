import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlacementPosition } from "@prisma/client";
import {
  buildShopifyVariantInputs,
  type CachedVariant,
  computeEnabledVariantSelection,
  PRINTIFY_POSITION_TO_ENUM,
} from "./variant-catalog";

const variants: CachedVariant[] = [
  {
    variantId: 1,
    colorName: "Black",
    colorHex: "#000",
    size: "S",
    sku: "BLK-S",
    costCents: 800,
    isAvailable: true,
  },
  {
    variantId: 2,
    colorName: "Black",
    colorHex: "#000",
    size: "M",
    sku: "BLK-M",
    costCents: 800,
    isAvailable: true,
  },
  {
    variantId: 3,
    colorName: "White",
    colorHex: "#fff",
    size: "S",
    sku: "WHT-S",
    costCents: 900,
    isAvailable: true,
  },
  {
    variantId: 4,
    colorName: "White",
    colorHex: "#fff",
    size: "M",
    sku: "WHT-M",
    costCents: 900,
    isAvailable: false,
  },
];

describe("computeEnabledVariantSelection", () => {
  it("uses per-color size map when provided", () => {
    const { effectiveVariantIds, effectiveSizesForPayload } = computeEnabledVariantSelection(
      variants,
      ["Black", "White"],
      { Black: ["S"], White: ["S"] },
      [],
    );
    assert.deepEqual(effectiveVariantIds.sort(), [1, 3]);
    assert.deepEqual(effectiveSizesForPayload.sort(), ["S"]);
  });

  it("falls back to the global size list, excluding unavailable variants", () => {
    const { effectiveVariantIds } = computeEnabledVariantSelection(
      variants,
      ["Black", "White"],
      null,
      ["S", "M"],
    );
    // variant 4 (White/M) is unavailable → excluded
    assert.deepEqual(effectiveVariantIds.sort(), [1, 2, 3]);
  });
});

describe("buildShopifyVariantInputs", () => {
  it("builds Color+Size+SKU+price ordered by color order, price in USD", () => {
    const payload = [
      { id: 1, price: 2000, sku: "BLK-S" },
      { id: 2, price: 2200, sku: "BLK-M" },
      { id: 3, price: 2100, sku: "WHT-S" },
    ];
    const plan = buildShopifyVariantInputs(variants, payload, [3, 1, 2], ["Black", "White"]);
    // Black variants ranked before White even though id 3 (White) came first
    assert.deepEqual(
      plan.map((v) => `${v.colorName}/${v.size}@${v.priceUsd}/${v.sku}`),
      ["Black/S@20/BLK-S", "Black/M@22/BLK-M", "White/S@21/WHT-S"],
    );
  });

  it("falls back to cached SKU and zero price when payload missing", () => {
    const plan = buildShopifyVariantInputs(variants, [], [1], ["Black"]);
    assert.deepEqual(plan, [
      { colorName: "Black", colorHex: "#000", size: "S", sku: "BLK-S", priceUsd: 0 },
    ]);
  });
});

describe("PRINTIFY_POSITION_TO_ENUM", () => {
  const cases: [string, PlacementPosition][] = [
    ["neck", PlacementPosition.NECK_LABEL],
    ["left_sleeve", PlacementPosition.SLEEVE_LEFT],
    ["right_sleeve", PlacementPosition.SLEEVE_RIGHT],
    ["front", PlacementPosition.FRONT],
    ["back", PlacementPosition.BACK],
    ["hem", PlacementPosition.HEM],
  ];

  for (const [printify, expected] of cases) {
    it(`maps Printify position '${printify}' → PlacementPosition.${expected}`, () => {
      assert.equal(PRINTIFY_POSITION_TO_ENUM[printify], expected);
    });
  }

  it("returns undefined for unknown position", () => {
    assert.equal(PRINTIFY_POSITION_TO_ENUM["chest"], undefined);
  });
});
