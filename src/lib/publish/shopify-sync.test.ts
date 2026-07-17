import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EnabledPrintifyVariantMatrixRow } from "@/lib/printify/product-matrix";
import {
  ShopifySyncTimeoutError,
  extractExternalProductIds,
  selectShopifyProductCandidate,
  toShopifyProductGid,
  waitForPrintifyShopifySync,
  waitForShopifyProductSync,
} from "./shopify-sync";

const printifyRows: EnabledPrintifyVariantMatrixRow[] = [
  {
    printifyVariantId: 101,
    sku: "BLACK-S",
    title: "Black / S",
    colorName: "Black",
    colorHex: "#111",
    size: "S",
    priceCents: 3199,
  },
  {
    printifyVariantId: 102,
    sku: "BLACK-M",
    title: "Black / M",
    colorName: "Black",
    colorHex: "#111",
    size: "M",
    priceCents: 3299,
  },
];

describe("selectShopifyProductCandidate", () => {
  it("matches one Shopify product by exact SKU set", () => {
    const match = selectShopifyProductCandidate(printifyRows, [
      {
        id: "gid://shopify/ProductVariant/1",
        sku: "BLACK-S",
        selectedOptions: [
          { name: "Color", value: "Black" },
          { name: "Size", value: "S" },
        ],
        product: {
          id: "gid://shopify/Product/10",
          title: "Product",
          updatedAt: "2026-07-07T00:00:00Z",
        },
      },
      {
        id: "gid://shopify/ProductVariant/2",
        sku: "BLACK-M",
        selectedOptions: [
          { name: "Color", value: "Black" },
          { name: "Size", value: "M" },
        ],
        product: {
          id: "gid://shopify/Product/10",
          title: "Product",
          updatedAt: "2026-07-07T00:00:00Z",
        },
      },
    ]);

    assert.equal(match?.shopifyProductId, "gid://shopify/Product/10");
    assert.deepEqual(
      match?.variantsBySku.get("BLACK-S")?.shopifyVariantId,
      "gid://shopify/ProductVariant/1",
    );
  });

  it("rejects partial or extra SKU sets", () => {
    assert.equal(
      selectShopifyProductCandidate(printifyRows, [
        {
          id: "gid://shopify/ProductVariant/1",
          sku: "BLACK-S",
          selectedOptions: [],
          product: {
            id: "gid://shopify/Product/10",
            title: "Product",
            updatedAt: "2026-07-07T00:00:00Z",
          },
        },
      ]),
      null,
    );

    assert.equal(
      selectShopifyProductCandidate(printifyRows, [
        {
          id: "gid://shopify/ProductVariant/1",
          sku: "BLACK-S",
          selectedOptions: [],
          product: {
            id: "gid://shopify/Product/10",
            title: "Product",
            updatedAt: "2026-07-07T00:00:00Z",
          },
        },
        {
          id: "gid://shopify/ProductVariant/2",
          sku: "BLACK-M",
          selectedOptions: [],
          product: {
            id: "gid://shopify/Product/10",
            title: "Product",
            updatedAt: "2026-07-07T00:00:00Z",
          },
        },
        {
          id: "gid://shopify/ProductVariant/3",
          sku: "EXTRA",
          selectedOptions: [],
          product: {
            id: "gid://shopify/Product/10",
            title: "Product",
            updatedAt: "2026-07-07T00:00:00Z",
          },
        },
      ]),
      null,
    );
  });
});

describe("waitForShopifyProductSync", () => {
  it("polls until a matching product appears", async () => {
    let calls = 0;
    const result = await waitForShopifyProductSync({
      printifyRows,
      updatedAfterIso: "2026-07-07T00:00:00Z",
      timeoutMs: 100,
      intervalMs: 1,
      now: () => calls,
      sleep: async () => {
        calls += 10;
      },
      fetchCandidates: async () => {
        calls += 1;
        return calls < 2
          ? []
          : [
              {
                id: "gid://shopify/ProductVariant/1",
                sku: "BLACK-S",
                selectedOptions: [],
                product: {
                  id: "gid://shopify/Product/10",
                  title: "Product",
                  updatedAt: "2026-07-07T00:00:01Z",
                },
              },
              {
                id: "gid://shopify/ProductVariant/2",
                sku: "BLACK-M",
                selectedOptions: [],
                product: {
                  id: "gid://shopify/Product/10",
                  title: "Product",
                  updatedAt: "2026-07-07T00:00:01Z",
                },
              },
            ];
      },
    });

    assert.equal(result.shopifyProductId, "gid://shopify/Product/10");
  });

  it("throws a timeout when no matching product appears", async () => {
    let currentTime = 0;
    await assert.rejects(
      waitForShopifyProductSync({
        printifyRows,
        updatedAfterIso: "2026-07-07T00:00:00Z",
        timeoutMs: 5,
        intervalMs: 2,
        now: () => currentTime,
        sleep: async (ms) => {
          currentTime += ms;
        },
        fetchCandidates: async () => [],
      }),
      ShopifySyncTimeoutError,
    );
  });
});

describe("Printify external Shopify sync", () => {
  it("normalizes Printify external product references", () => {
    assert.deepEqual(extractExternalProductIds({ external: { id: "123", handle: "/products/a" } }), ["123"]);
    assert.deepEqual(
      extractExternalProductIds({
        external: [
          { id: "123", handle: "/products/a" },
          { id: "456", handle: "/products/b" },
        ],
      }),
      ["123", "456"],
    );
    assert.equal(toShopifyProductGid("123"), "gid://shopify/Product/123");
    assert.equal(toShopifyProductGid("gid://shopify/Product/123"), "gid://shopify/Product/123");
  });

  it("polls Printify external before falling back to Shopify search", async () => {
    let now = 0;
    let productPolls = 0;
    const result = await waitForPrintifyShopifySync({
      printifyRows,
      printifyShopId: 1,
      printifyProductId: "printify-product",
      updatedAfterIso: "2026-07-07T00:00:00Z",
      timeoutMs: 100,
      intervalMs: 5,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      printifyClient: {
        getProduct: async () => {
          productPolls += 1;
          return productPolls === 1
            ? ({ id: "printify-product", external: [] } as any)
            : ({ id: "printify-product", external: [{ id: "10" }] } as any);
        },
      },
      shopifyClient: {
        graphql: async (_query: string, variables?: Record<string, unknown>) => {
          if (!variables?.id) {
            return {
              productVariants: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            } as any;
          }
          assert.equal(variables?.id, "gid://shopify/Product/10");
          return {
            product: {
              id: "gid://shopify/Product/10",
              title: "Product",
              updatedAt: "2026-07-07T00:00:05Z",
              variants: {
                nodes: [
                  { id: "gid://shopify/ProductVariant/1", sku: "BLACK-S", selectedOptions: [] },
                  { id: "gid://shopify/ProductVariant/2", sku: "BLACK-M", selectedOptions: [] },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          } as any;
        },
      },
    });

    assert.equal(result.shopifyProductId, "gid://shopify/Product/10");
    assert.equal(productPolls, 2);
  });
});
