import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildProductTags,
  normalizeProductType,
  resolveProductCollectionIds,
  updateProductCategory,
} from "./shopify";

describe("normalizeProductType", () => {
  it("maps Printify blueprint titles to canonical apparel types", () => {
    assert.equal(normalizeProductType("Unisex Heavy Cotton Tee"), "T-Shirt");
    assert.equal(normalizeProductType("Unisex College Hoodie"), "Hoodie");
    assert.equal(normalizeProductType("Unisex Crewneck Sweatshirt"), "Sweatshirt");
    assert.equal(normalizeProductType("Unisex Tank Top"), "Tank Top");
    assert.equal(normalizeProductType("Long Sleeve Shirt"), "Long Sleeve Shirt");
  });

  it("returns null for unrecognized types", () => {
    assert.equal(normalizeProductType("Ceramic Mug"), null);
    assert.equal(normalizeProductType(""), null);
  });
});

describe("buildProductTags", () => {
  it("merges Printify-like defaults with AI tags, de-duplicated case-insensitively", () => {
    assert.deepEqual(buildProductTags("T-Shirt", ["summer", "t-shirt", "Sale"]), [
      "T-Shirt",
      "Printify",
      "Unisex",
      "DTG",
      "Cotton",
      "Crew neck",
      "Men's Clothing",
      "Women's Clothing",
      "summer",
      "Sale",
    ]);
  });

  it("returns only AI tags when the type is unrecognized", () => {
    assert.deepEqual(buildProductTags(null, ["custom"]), ["custom"]);
  });

  it("prepends defaults to external Printify tags", () => {
    assert.deepEqual(buildProductTags("T-Shirt", ["Women's Clothing", "Unisex", "DTG", "Cotton"]), [
      "T-Shirt",
      "Printify",
      "Unisex",
      "DTG",
      "Cotton",
      "Crew neck",
      "Men's Clothing",
      "Women's Clothing",
    ]);
  });

  it("returns default tags when no external or listing tags are available", () => {
    assert.deepEqual(buildProductTags("T-Shirt", []), [
      "T-Shirt",
      "Printify",
      "Unisex",
      "DTG",
      "Cotton",
      "Crew neck",
      "Men's Clothing",
      "Women's Clothing",
    ]);
  });

  it("deduplicates external tags that overlap with defaults", () => {
    assert.deepEqual(buildProductTags("T-Shirt", ["Printify", "T-Shirt", "Unisex"]), [
      "T-Shirt",
      "Printify",
      "Unisex",
      "DTG",
      "Cotton",
      "Crew neck",
      "Men's Clothing",
      "Women's Clothing",
    ]);
  });
});

describe("Shopify productSet collections", () => {
  const source = readFileSync(new URL("./shopify.ts", import.meta.url), "utf8");

  it("prefers optimized Manual Collections over product type fallback", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const client = {
      graphql: async (query: string, variables: Record<string, unknown>) => {
        calls.push({ query, variables });
        assert.equal(variables.q, "handle:patriotic");
        return {
          collections: {
            nodes: [
              {
                id: "gid://shopify/Collection/patriotic",
                title: "Patriotic",
                handle: "patriotic",
                ruleSet: null,
              },
            ],
          },
        };
      },
    };

    assert.deepEqual(await resolveProductCollectionIds(client, "T-Shirt", ["Patriotic"]), [
      "gid://shopify/Collection/patriotic",
    ]);
    assert.equal(calls.length, 1);
  });

  it("resolves apostrophe titles by handle without apostrophe search syntax", async () => {
    const client = {
      graphql: async (_query: string, variables: Record<string, unknown>) => {
        assert.equal(variables.q, "handle:mens-clothing");
        assert.doesNotMatch(String(variables.q), /Men's Clothing/);
        return {
          collections: {
            nodes: [
              {
                id: "gid://shopify/Collection/mens",
                title: "Men's Clothing",
                handle: "mens-clothing",
                ruleSet: null,
              },
            ],
          },
        };
      },
    };

    assert.deepEqual(await resolveProductCollectionIds(client, "T-Shirt", ["Men's Clothing"]), [
      "gid://shopify/Collection/mens",
    ]);
  });

  it("ignores Smart Collections and falls back to product type collections", async () => {
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const client = {
        graphql: async (_query: string, variables: Record<string, unknown>) => {
          if (variables.q === "handle:patriotic") {
            return {
              collections: {
                nodes: [
                  {
                    id: "gid://shopify/Collection/smart",
                    title: "Patriotic",
                    handle: "patriotic",
                    ruleSet: { appliedDisjunctively: true },
                  },
                ],
              },
            };
          }

          if (variables.q === "handle:t-shirts") {
            return {
              collections: {
                nodes: [
                  {
                    id: "gid://shopify/Collection/t-shirts",
                    title: "T-Shirts",
                    handle: "t-shirts",
                    ruleSet: null,
                  },
                ],
              },
            };
          }

          return {
            collections: {
              nodes: [
                {
                  id: "gid://shopify/Collection/smart",
                  title: "Patriotic",
                  handle: "patriotic",
                  ruleSet: { appliedDisjunctively: true },
                },
              ],
            },
          };
        },
      };

      assert.deepEqual(await resolveProductCollectionIds(client, "T-Shirt", ["Patriotic"]), [
        "gid://shopify/Collection/t-shirts",
      ]);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("auto-creates manual collection if it does not exist on Shopify", async () => {
    const mutationsCalled: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const client = {
      graphql: async (query: string, variables: Record<string, unknown>) => {
        if (query.includes("FindManualCollectionsByHandle")) {
          return {
            collections: {
              nodes: [],
            },
          };
        }
        if (query.includes("ListManualCollectionsForTitleMatch")) {
          return {
            collections: {
              nodes: [],
            },
          };
        }
        if (query.includes("CreateManualCollection")) {
          mutationsCalled.push({ query, variables });
          return {
            collectionCreate: {
              collection: {
                id: "gid://shopify/Collection/newly-created-patriotic",
                title: (variables.input as { title: string }).title,
              },
              userErrors: [],
            },
          };
        }
        throw new Error(`Unexpected query/mutation: ${query}`);
      },
    };

    const ids = await resolveProductCollectionIds(client, "T-Shirt", ["Patriotic"]);
    assert.deepEqual(ids, ["gid://shopify/Collection/newly-created-patriotic"]);
    assert.equal(mutationsCalled.length, 1);
    assert.equal((mutationsCalled[0].variables.input as { title: string }).title, "Patriotic");
  });

  it("resolves and sends collections through productSet", () => {
    assert.match(source, /resolveProductCollectionIds/);
    assert.match(source, /productSetInput\.collections/);
    assert.match(source, /PRODUCT_TYPE_COLLECTION_MAP/);
  });

  it("queries ruleSet.appliedDisjunctively without requesting ruleSet.id", () => {
    assert.match(source, /ruleSet\s*\{\s*appliedDisjunctively\s*\}/);
    assert.doesNotMatch(source, /ruleSet\s*\{\s*id\s*\}/);
  });
});

describe("Shopify productSet inventory quantities", () => {
  const source = readFileSync(new URL("./shopify.ts", import.meta.url), "utf8");

  it("sets default available inventory at the resolved Shopify location", () => {
    assert.match(source, /DEFAULT_SHOPIFY_INVENTORY_QUANTITY\s*=\s*999/);
    assert.match(source, /locations\(first:\s*1\)/);
    assert.match(source, /inventoryQuantities/);
    assert.match(source, /locationId/);
    assert.match(source, /name:\s*"available"/);
    assert.match(source, /quantity:\s*DEFAULT_SHOPIFY_INVENTORY_QUANTITY/);
  });

  it("omits inventory quantities when the default location cannot be resolved", () => {
    assert.match(source, /resolveDefaultLocationId/);
    assert.match(source, /Promise<string\s*\|\s*null>/);
    assert.match(source, /omitting inventory quantities/);
    assert.match(source, /if \(!locationId\) return/);
  });

  it("keeps continue-selling inventory policy with inventory quantities", () => {
    assert.match(source, /inventoryPolicy:\s*"CONTINUE"/);
  });

  it("logs productSet user error fields with messages", () => {
    assert.match(source, /field.*join\("\."\)/s);
    assert.match(source, /Shopify productSet failed: \$\{errors\.join/);
  });

  it("requests inventoryItem id from productSet response", () => {
    assert.match(source, /inventoryItem\s*\{\s*id\s*\}/);
  });

  it("enables inventory tracking and sets stock after product creation", () => {
    assert.match(source, /enableInventoryTrackingAndSetStock/);
    assert.match(source, /tracked:\s*true/);
    assert.match(source, /inventoryItemUpdate/);
    assert.match(source, /inventorySetQuantities/);
  });
});

describe("updateProductCategory", () => {
  it("validates and updates the Shopify taxonomy category for a synced product", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const client = {
      graphql: async (query: string, variables: Record<string, unknown>) => {
        calls.push({ query, variables });
        if (query.includes("ValidateCategory")) {
          return {
            node: {
              __typename: "TaxonomyCategory",
              id: variables.id,
            },
          };
        }
        if (query.includes("UpdateProductCategory")) {
          return {
            productUpdate: {
              product: { id: (variables.product as { id: string }).id },
              userErrors: [],
            },
          };
        }
        throw new Error(`Unexpected query/mutation: ${query}`);
      },
    };

    const categoryId = await updateProductCategory({
      client,
      productId: "gid://shopify/Product/123",
      productType: "Unisex Heavy Cotton Tee",
    });

    assert.equal(categoryId, "gid://shopify/TaxonomyCategory/aa-1-13-8");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].variables.product, {
      id: "gid://shopify/Product/123",
      category: "gid://shopify/TaxonomyCategory/aa-1-13-8",
      productType: "T-Shirt",
    });
  });

  it("skips productUpdate when the product type has no taxonomy mapping", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const client = {
      graphql: async (query: string, variables: Record<string, unknown>) => {
        calls.push({ query, variables });
        throw new Error("graphql should not be called for unmapped product types");
      },
    };

    assert.equal(
      await updateProductCategory({
        client,
        productId: "gid://shopify/Product/123",
        productType: "Ceramic Mug",
      }),
      null,
    );
    assert.equal(calls.length, 0);
  });
});
