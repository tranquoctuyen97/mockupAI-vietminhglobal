import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrintifyProductResponse } from "./client";
import {
  PrintifyVariantMatrixError,
  extractEnabledPrintifyVariantMatrix,
} from "./product-matrix";

const product = (overrides: Partial<PrintifyProductResponse> = {}): PrintifyProductResponse => ({
  id: "printify-product-1",
  title: "Test Product",
  blueprint_id: 12,
  print_provider_id: 39,
  options: [
    {
      name: "Colors",
      type: "color",
      values: [
        { id: 10, title: "Black", colors: ["#111111"] },
        { id: 11, title: "White", colors: ["#ffffff"] },
      ],
    },
    {
      name: "Sizes",
      type: "size",
      values: [
        { id: 20, title: "S" },
        { id: 21, title: "M" },
      ],
    },
  ],
  variants: [
    {
      id: 101,
      title: "Black / S",
      sku: "BLACK-S",
      price: 3199,
      is_enabled: true,
      options: [10, 20],
    },
    {
      id: 102,
      title: "Black / M",
      sku: "BLACK-M",
      price: 3299,
      is_enabled: true,
      options: [10, 21],
    },
    {
      id: 103,
      title: "White / S",
      sku: "WHITE-S",
      price: 3199,
      is_enabled: false,
      options: [11, 20],
    },
  ],
  ...overrides,
});

describe("extractEnabledPrintifyVariantMatrix", () => {
  it("returns enabled variants with color, size, sku, price, and Printify variant id", () => {
    assert.deepEqual(extractEnabledPrintifyVariantMatrix(product()), [
      {
        printifyVariantId: 101,
        sku: "BLACK-S",
        title: "Black / S",
        colorName: "Black",
        colorHex: "#111111",
        size: "S",
        priceCents: 3199,
      },
      {
        printifyVariantId: 102,
        sku: "BLACK-M",
        title: "Black / M",
        colorName: "Black",
        colorHex: "#111111",
        size: "M",
        priceCents: 3299,
      },
    ]);
  });

  it("falls back to parsing variant title when option IDs are missing", () => {
    const rows = extractEnabledPrintifyVariantMatrix(
      product({
        options: [],
        variants: [
          {
            id: 201,
            title: "Heather Navy / XL",
            sku: "NAVY-XL",
            price: 3399,
            is_enabled: true,
            options: [],
          },
        ],
      }),
    );
    assert.equal(rows[0].colorName, "Heather Navy");
    assert.equal(rows[0].size, "XL");
  });

  it("throws when an enabled variant has no SKU", () => {
    assert.throws(
      () =>
        extractEnabledPrintifyVariantMatrix(
          product({
            variants: [
              {
                id: 101,
                title: "Black / S",
                sku: "",
                price: 3199,
                is_enabled: true,
                options: [10, 20],
              },
            ],
          }),
        ),
      /Missing SKU for enabled Printify variant 101/,
    );
  });

  it("throws on duplicate enabled SKUs", () => {
    assert.throws(
      () =>
        extractEnabledPrintifyVariantMatrix(
          product({
            variants: [
              {
                id: 101,
                title: "Black / S",
                sku: "DUP",
                price: 3199,
                is_enabled: true,
                options: [10, 20],
              },
              {
                id: 102,
                title: "Black / M",
                sku: "DUP",
                price: 3299,
                is_enabled: true,
                options: [10, 21],
              },
            ],
          }),
        ),
      /Duplicate Printify SKU/,
    );
  });

  it("throws when no enabled variants remain", () => {
    assert.throws(
      () => extractEnabledPrintifyVariantMatrix(product({ variants: [] })),
      PrintifyVariantMatrixError,
    );
  });
});
