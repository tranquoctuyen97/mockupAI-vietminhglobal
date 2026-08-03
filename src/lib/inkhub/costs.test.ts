import assert from "node:assert/strict";
import test from "node:test";

import { normalizeInkhubOrderCosts } from "./costs";

test("keeps missing Inkhub cost as pending instead of zero", () => {
  const result = normalizeInkhubOrderCosts({ items: [{ id: 1, SKU: "3001-BLACK-M" }] });
  assert.equal(result.status, "PENDING");
  assert.equal(result.totalCents, null);
  assert.equal(result.lines[0]?.totalCents, null);
  assert.equal(result.lines[0]?.status, "PENDING");
});

test("normalizes Beeful decimal costs and matches duplicate SKUs by mockup URL", () => {
  const result = normalizeInkhubOrderCosts({
    fulfillmentCost: "14.30",
    shippingCost: "6.60",
    totalCost: "20.90",
    fulfillmentCostMetadata: { cost: 14.3, chargeShippingFee: 6.6 },
    items: [
      {
        id: 1,
        SKU: "UT-3001-DAR-XL",
        printAreas: [{ url: "design-a", mockupUrl: "mockup-a" }],
      },
      {
        id: 2,
        SKU: "UT-3001-DAR-XL",
        printAreas: [{ url: "design-b", mockupUrl: "mockup-b" }],
      },
    ],
    transferredMetadata: {
      response: {
        items: [
          { sku: "UT-3001-DAR-XL", cost: 7.15, mockupUrl: "mockup-b", frontDesignUrl: "design-b" },
          { sku: "UT-3001-DAR-XL", cost: 7.15, mockupUrl: "mockup-a", frontDesignUrl: "design-a" },
        ],
      },
    },
  });

  assert.equal(result.totalCents, 2090);
  assert.equal(result.status, "READY");
  assert.deepEqual(
    result.lines.map((line) => line.totalCents),
    [1045, 1045],
  );
  assert.equal(
    result.lines.reduce((sum, line) => sum + (line.totalCents ?? 0), 0),
    2090,
  );
});

test("converts Printify minor-unit metadata and reconciles the last line", () => {
  const result = normalizeInkhubOrderCosts({
    fulfillmentCost: null,
    shippingCost: null,
    totalCost: null,
    fulfillmentCostMetadata: {
      source: "printify",
      total_price: 1440,
      total_shipping: 475,
      line_items: [
        { sku: "B", cost: 250, mockup: "b" },
        { sku: "A", cost: 715, mockup: "a" },
      ],
    },
    items: [
      { id: 1, SKU: "A", printAreas: [{ mockupUrl: "a" }] },
      { id: 2, SKU: "B", printAreas: [{ mockupUrl: "b" }] },
    ],
  });

  assert.equal(result.fulfillmentCents, 965);
  assert.equal(result.shippingCents, 475);
  assert.equal(result.totalCents, 1440);
  assert.equal(
    result.lines.reduce((sum, line) => sum + (line.totalCents ?? 0), 0),
    1440,
  );
  assert.equal(result.lines[0]?.fulfillmentCents, 715);
  assert.equal(result.lines[1]?.fulfillmentCents, 250);
});

test("does not fabricate per-line cost when a multi-line order has no line match", () => {
  const result = normalizeInkhubOrderCosts({
    fulfillmentCost: "14.30",
    shippingCost: "6.60",
    totalCost: "20.90",
    items: [
      { id: 1, SKU: "unknown-a" },
      { id: 2, SKU: "unknown-b" },
    ],
  });

  assert.equal(result.totalCents, 2090);
  assert.deepEqual(
    result.lines.map((line) => line.totalCents),
    [null, null],
  );
  assert.deepEqual(
    result.lines.map((line) => line.status),
    ["PENDING", "PENDING"],
  );
});
