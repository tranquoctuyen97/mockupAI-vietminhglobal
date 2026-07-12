import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ShopifyMockupImage } from "./shopify";
import {
  normalizeExternalTags,
  orderColorsByPrimary,
  orderMockupImagesByPrimary,
  orderVariantsByPrimary,
  pickPrimaryColorName,
  resolvePrintifyTagsForShopify,
  resolvePublishVariantIds,
  resolveShopifyMockupMedia,
  selectTagsForShopify,
  validateVariantSkus,
} from "./worker";

describe("runPublishWorker organization collections source", () => {
  const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

  it("passes Listing organizationCollections to Shopify publish", () => {
    assert.match(source, /organizationCollections:\s*listing\.organizationCollections\s*\?\?\s*\[\]/);
  });

  it("persists Shopify product id during productSet before later retryable steps", () => {
    assert.match(source, /onProductCreated:\s*async\s*\(productId,\s*variantNodes\)/);
    assert.match(source, /data:\s*\{\s*shopifyProductId:\s*productId\s*\}/);
    assert.match(source, /let createdProductId:\s*string\s*\|\s*null\s*=\s*listing\.shopifyProductId/);
  });

  it("does not force-create a new Printify product after 5xx", () => {
    assert.match(source, /5xx can happen after Printify creates a product/);
    assert.doesNotMatch(source, /isServerError/);
  });

  it("uses template pricing defaults for Printify and Shopify variant plans", () => {
    assert.match(source, /resolveBaseTemplatePrice/);
    assert.match(source, /mergeDraftAndTemplatePriceMaps/);
    assert.match(source, /templatePriceBySizeDefault:\s*template\?\.priceBySizeDefault/);
    assert.doesNotMatch(source, /productPricingTemplate\.findFirst/);
  });
});

describe("Printify Shopify-channel publish branch", () => {
  const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

  it("loads the store Printify shop for strategy resolution", () => {
    assert.match(source, /include:\s*\{\s*printifyShop:\s*true\s*\}/);
  });

  it("resolves publish strategy before the Shopify productSet stage", () => {
    const strategyIndex = source.indexOf("resolvePublishStrategy");
    const shopifyStageIndex = source.indexOf("Stage 1: Shopify");
    assert.ok(strategyIndex > -1, "resolvePublishStrategy should be used in worker");
    assert.ok(shopifyStageIndex > -1, "Shopify stage marker should remain present");
    assert.ok(strategyIndex < shopifyStageIndex, "strategy must be resolved before Shopify stage");
  });

  it("returns from Printify-first branch before publishToShopify can run", () => {
    assert.match(source, /PRINTIFY_SHOPIFY_CHANNEL/);
    assert.match(source, /runPrintifyShopifyChannelPublish/);
  });
});

describe("runPrintifyShopifyChannelPublish invariants", () => {
  const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

  it("publishes through Printify publishProduct before Shopify sync", () => {
    const publishIndex = source.indexOf("await printifyClient.publishProduct(");
    const syncIndex = source.indexOf("await waitForShopifyProductSync(");
    assert.ok(publishIndex > -1, "Printify publishProduct should be called");
    assert.ok(syncIndex > -1, "Shopify sync should be called");
    assert.ok(publishIndex < syncIndex, "Printify publish must happen before Shopify sync");
  });

  it("extracts enabled Printify matrix and persists listing variants", () => {
    assert.match(source, /extractEnabledPrintifyVariantMatrix/);
    assert.match(source, /listingVariant\.deleteMany/);
    assert.match(source, /listingVariant\.createMany/);
  });

  it("passes Listing organizationCollections into Printify Shopify sales channel properties", () => {
    assert.match(source, /salesChannelCollections:\s*normalizeOrganizationCollections\(listing\.organizationCollections\)/);
  });

  it("attaches Shopify collections after Printify Shopify-channel sync", () => {
    const syncIndex = source.indexOf("await waitForShopifyProductSync(");
    const attachIndex = source.indexOf("await attachProductToManualCollections(");
    assert.ok(syncIndex > -1, "Shopify sync should be awaited");
    assert.ok(attachIndex > -1, "Shopify collection attach should be called");
    assert.ok(syncIndex < attachIndex, "collection attach must run after Shopify product sync");
    assert.match(source, /collections:\s*listing\.organizationCollections\s*\?\?\s*\[\]/);
  });

  it("uploads existing WebP mockup media to Shopify after sync without duplicating retries", () => {
    const syncIndex = source.indexOf("await waitForShopifyProductSync(");
    const hasWebpIndex = source.indexOf("await productHasWebpMedia(");
    const uploadIndex = source.indexOf("await uploadProductImages(");
    assert.ok(hasWebpIndex > syncIndex, "WebP check should run after Shopify sync");
    assert.ok(uploadIndex > hasWebpIndex, "WebP upload should run after idempotency check");
    assert.match(source, /Shopify WebP media post-sync failed \(non-fatal\)/);
  });

  it("maps paired light and dark print areas across the full Printify variant catalog", () => {
    const resolverIndex = source.indexOf("async function resolvePrintifyProductPublishInput");
    const pairLoopIndex = source.indexOf("for (const variant of cachedVariants)", resolverIndex);
    assert.ok(pairLoopIndex > -1, "pair variant loop should exist");
    const pairLoopSource = source.slice(pairLoopIndex, source.indexOf("imageGroups = [", pairLoopIndex));
    assert.doesNotMatch(pairLoopSource, /enabledSet\.has\(variant\.variantId\).*continue/s);
  });

  it("does not let transient Printify create recovery leave jobs stuck running", () => {
    assert.match(source, /Failed to check recent Printify product after transient create error/);
    assert.match(source, /where:\s*\{\s*id:\s*printifyJob\.id\s*\}[\s\S]*status:\s*"FAILED"[\s\S]*completedAt:\s*new Date\(\)/);
  });

  it("marks Shopify sync timeout as partial failure without Shopify productSet fallback", () => {
    assert.match(source, /Printify published but Shopify sync was not confirmed/);
    assert.doesNotMatch(source, /catch[\s\S]{0,400}publishToShopify/);
  });
});

describe("retry Printify route source contract", () => {
  it("routes Printify Shopify-channel retries through the full publish worker", () => {
    const retryRoute = readFileSync(
      new URL("../../app/api/listings/[id]/retry-printify/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(retryRoute, /resolvePublishStrategy/);
    assert.match(retryRoute, /runPublishWorker/);
    assert.match(retryRoute, /PRINTIFY_SHOPIFY_CHANNEL/);
  });
});

describe("normalizeExternalTags", () => {
  it("trims, drops blank/nullish tags, deduplicates case-insensitively, and preserves first casing", () => {
    assert.deepEqual(
      normalizeExternalTags([
        " Women's Clothing ",
        "women's clothing",
        "",
        "   ",
        null,
        undefined,
        "Unisex",
      ]),
      ["Women's Clothing", "Unisex"],
    );
  });

  it("removes internal mockup draft tags", () => {
    assert.deepEqual(normalizeExternalTags(["mockupai", "DRAFT-PREVIEW", "Cotton"]), ["Cotton"]);
  });

  it("returns an empty array for non-array input", () => {
    assert.deepEqual(normalizeExternalTags("Cotton"), []);
    assert.deepEqual(normalizeExternalTags(null), []);
  });
});

describe("resolvePrintifyTagsForShopify", () => {
  it("returns normalized tags from an existing Printify product", async () => {
    const client = {
      getProduct: async (shopId: number, productId: string) => {
        assert.equal(shopId, 123);
        assert.equal(productId, "printify-product-1");
        return { id: productId, title: "Product", tags: [" Printify ", "mockupai", "Unisex"] };
      },
    };

    assert.deepEqual(
      await resolvePrintifyTagsForShopify({
        client,
        externalShopId: 123,
        productId: "printify-product-1",
        storeId: "store-1",
        listingId: "listing-1",
      }),
      ["Printify", "Unisex"],
    );
  });

  it("returns an empty array for missing context", async () => {
    const client = {
      getProduct: async () => {
        throw new Error("should not be called");
      },
    };

    assert.deepEqual(
      await resolvePrintifyTagsForShopify({
        client,
        externalShopId: null,
        productId: "printify-product-1",
        storeId: "store-1",
        listingId: "listing-1",
      }),
      [],
    );

    assert.deepEqual(
      await resolvePrintifyTagsForShopify({
        client,
        externalShopId: 123,
        productId: null,
        storeId: "store-1",
        listingId: "listing-1",
      }),
      [],
    );
  });

  it("returns an empty array for internal-only tags", async () => {
    const client = {
      getProduct: async () => ({
        id: "printify-product-1",
        title: "Product",
        tags: ["mockupai", "draft-preview"],
      }),
    };

    assert.deepEqual(
      await resolvePrintifyTagsForShopify({
        client,
        externalShopId: 123,
        productId: "printify-product-1",
        storeId: "store-1",
        listingId: "listing-1",
      }),
      [],
    );
  });

  it("does not throw when Printify fetch fails", async () => {
    const client = {
      getProduct: async () => {
        throw new Error("Printify unavailable");
      },
    };
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      assert.deepEqual(
        await resolvePrintifyTagsForShopify({
          client,
          externalShopId: 123,
          productId: "printify-product-1",
          storeId: "store-1",
          listingId: "listing-1",
        }),
        [],
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("selectTagsForShopify", () => {
  it("merges and deduplicates printify tags and listing tags", () => {
    assert.deepEqual(
      selectTagsForShopify(["Unisex", "Printify"], ["summer", "unisex", "Cotton"]),
      ["Unisex", "Printify", "summer", "Cotton"]
    );
  });

  it("filters out internal mockup draft tags from listing tags", () => {
    assert.deepEqual(
      selectTagsForShopify(["Unisex"], ["draft-preview", "Cotton", "unisex"]),
      ["Unisex", "Cotton"]
    );
  });

  it("handles null or empty listing tags gracefully", () => {
    assert.deepEqual(selectTagsForShopify(["Unisex"], null), ["Unisex"]);
    assert.deepEqual(selectTagsForShopify([], ["summer"]), ["summer"]);
  });
});

describe("resolvePublishVariantIds", () => {
  it("uses listing Printify variant IDs when present", () => {
    assert.deepEqual(
      resolvePublishVariantIds(
        {
          variants: [
            { printifyVariantId: "101" },
            { printifyVariantId: "101" },
            { printifyVariantId: "202" },
            { printifyVariantId: null },
          ],
        },
        { store: { template: { enabledVariantIds: [303] } } },
      ),
      [101, 202],
    );
  });

  it("falls back to template variants, then a defensive default", () => {
    assert.deepEqual(
      resolvePublishVariantIds(
        { variants: [] },
        { store: { template: { enabledVariantIds: [303, 404] } } },
      ),
      [303, 404],
    );
    assert.deepEqual(resolvePublishVariantIds({ variants: [] }, {}), [1]);
  });
});

describe("resolveShopifyMockupMedia", () => {
  const storage = {
    resolvePath: (key: string) => `/uploads/${key}`,
  };

  it("passes remote Printify URLs without resolving them as local files", () => {
    const result = resolveShopifyMockupMedia({
      images: [
        {
          colorName: "Royal Blue",
          compositeUrl: "https://images-api.printify.com/mockup/front.png",
          sourceUrl: "https://images-api.printify.com/mockup/front.png",
        },
      ],
      storage,
      colorNames: ["Royal Blue"],
      requireRealPrintifyMockups: true,
    });

    assert.deepEqual(result.mockupImages, [
      {
        kind: "remote",
        url: "https://images-api.printify.com/mockup/front.png",
        colorName: "Royal Blue",
      },
    ]);
    assert.deepEqual(result.mockupPaths, []);
    assert.deepEqual(result.missingColorNames, []);
  });

  it("rejects synthetic/local media when real Printify mockups are required", () => {
    const result = resolveShopifyMockupMedia({
      images: [
        {
          colorName: "Royal Blue",
          compositeUrl: "mockups/local.png",
          sourceUrl: "mockup://solid/front",
        },
        {
          colorName: "Gold",
          compositeUrl: "https://via.placeholder.com/1200",
          sourceUrl: "https://via.placeholder.com/1200",
        },
      ],
      storage,
      colorNames: ["Royal Blue", "Gold"],
      requireRealPrintifyMockups: true,
    });

    assert.deepEqual(result.mockupImages, []);
    assert.deepEqual(result.missingColorNames, ["Royal Blue", "Gold"]);
  });

  it("uses local cached media when it came from a real Printify source", () => {
    const result = resolveShopifyMockupMedia({
      images: [
        {
          colorName: "Royal Blue",
          compositeUrl: "mockups/printify_front.png",
          sourceUrl: "https://images-api.printify.com/mockup/front.png",
        },
      ],
      storage,
      colorNames: ["Royal Blue"],
      requireRealPrintifyMockups: true,
    });

    assert.deepEqual(result.mockupImages, [
      {
        kind: "local",
        path: "/uploads/mockups/printify_front.png",
        colorName: "Royal Blue",
      },
    ]);
    assert.deepEqual(result.mockupPaths, ["/uploads/mockups/printify_front.png"]);
    assert.deepEqual(result.missingColorNames, []);
  });

  it("prefers backend compositeUrl for Shopify media", () => {
    const result = resolveShopifyMockupMedia({
      images: [
        {
          colorName: "White",
          compositeUrl: "custom-mockups/renders/job-1/image-1-output.webp",
          sourceUrl: "mockup://library/template-item-1",
        },
      ],
      storage: {
        resolvePath: (key: string) => `/abs/media/${key}`,
      },
      colorNames: ["White"],
      requireRealPrintifyMockups: false,
    });

    assert.deepEqual(result.mockupImages, [
      {
        kind: "local",
        path: "/abs/media/custom-mockups/renders/job-1/image-1-output.webp",
        colorName: "White",
      },
    ]);
    assert.deepEqual(result.mockupPaths, [
      "/abs/media/custom-mockups/renders/job-1/image-1-output.webp",
    ]);
    assert.deepEqual(result.missingColorNames, []);
  });

  it("keeps local storage media for non-strict development fallback", () => {
    const result = resolveShopifyMockupMedia({
      images: [
        {
          colorName: "Royal Blue",
          compositeUrl: "mockups/local.png",
          sourceUrl: "mockup://solid/front",
        },
      ],
      storage,
      colorNames: ["Royal Blue"],
      requireRealPrintifyMockups: false,
    });

    assert.deepEqual(result.mockupImages, [
      {
        kind: "local",
        path: "/uploads/mockups/local.png",
        colorName: "Royal Blue",
      },
    ]);
    assert.deepEqual(result.mockupPaths, ["/uploads/mockups/local.png"]);
  });
});

describe("pickPrimaryColorName", () => {
  const img = (colorName?: string): ShopifyMockupImage => ({
    kind: "remote",
    url: "https://images-api.printify.com/m.png",
    colorName,
  });

  it("returns null when no mockup carries a color name", () => {
    assert.equal(pickPrimaryColorName([img(), img("")]), null);
  });

  it("picks a color present in the mockups using the provided rng", () => {
    const images = [img("Black"), img("Black"), img("White"), img("Navy")];
    // unique colors: [Black, White, Navy]; rng 0.5 → index 1 → White
    assert.equal(
      pickPrimaryColorName(images, () => 0.5),
      "White",
    );
    assert.equal(
      pickPrimaryColorName(images, () => 0),
      "Black",
    );
  });
});

describe("orderMockupImagesByPrimary", () => {
  const img = (colorName: string, url: string): ShopifyMockupImage => ({
    kind: "remote",
    url,
    colorName,
  });

  it("moves the primary color group first, keeping original order otherwise", () => {
    const images = [img("Black", "b1"), img("White", "w1"), img("Navy", "n1"), img("White", "w2")];
    const ordered = orderMockupImagesByPrimary(images, ["Black", "White", "Navy"], "White");
    assert.deepEqual(
      ordered.map((m) => (m.kind === "remote" ? m.url : "")),
      ["w1", "w2", "b1", "n1"],
    );
  });

  it("returns the input unchanged when there is no primary color", () => {
    const images = [img("Black", "b1"), img("White", "w1")];
    assert.deepEqual(orderMockupImagesByPrimary(images, ["Black", "White"], null), images);
  });
});

describe("orderColorsByPrimary and orderVariantsByPrimary", () => {
  it("moves the thumbnail color first for Shopify color options and variants", () => {
    assert.deepEqual(
      orderColorsByPrimary(
        [
          { name: "Black", hex: "#000" },
          { name: "White", hex: "#fff" },
          { name: "Navy", hex: "#001f3f" },
        ],
        "White",
      ).map((color) => color.name),
      ["White", "Black", "Navy"],
    );

    assert.deepEqual(
      orderVariantsByPrimary(
        [
          { colorName: "Black", size: "S" },
          { colorName: "Black", size: "M" },
          { colorName: "White", size: "S" },
          { colorName: "White", size: "M" },
          { colorName: "Navy", size: "S" },
        ],
        "White",
      )?.map((variant) => `${variant.colorName}/${variant.size}`),
      ["White/S", "White/M", "Black/S", "Black/M", "Navy/S"],
    );
  });
});

describe("validateVariantSkus", () => {
  it("passes when every variant has a unique SKU", () => {
    assert.doesNotThrow(() =>
      validateVariantSkus([
        { colorName: "Black", size: "S", sku: "SKU-1", priceUsd: 20, colorHex: null },
        { colorName: "Black", size: "M", sku: "SKU-2", priceUsd: 20, colorHex: null },
      ]),
    );
  });

  it("throws on duplicate SKUs", () => {
    assert.throws(
      () =>
        validateVariantSkus([
          { colorName: "Black", size: "S", sku: "DUP", priceUsd: 20, colorHex: null },
          { colorName: "White", size: "S", sku: "DUP", priceUsd: 20, colorHex: null },
        ]),
      /Duplicate SKU/,
    );
  });

  it("throws when SKUs are present on some but missing on others", () => {
    assert.throws(
      () =>
        validateVariantSkus([
          { colorName: "Black", size: "S", sku: "SKU-1", priceUsd: 20, colorHex: null },
          { colorName: "White", size: "S", sku: null, priceUsd: 20, colorHex: null },
        ]),
      /Missing SKU/,
    );
  });

  it("allows a catalog where no variant has a SKU", () => {
    assert.doesNotThrow(() =>
      validateVariantSkus([
        { colorName: "Black", size: "S", sku: null, priceUsd: 20, colorHex: null },
        { colorName: "White", size: "S", sku: "", priceUsd: 20, colorHex: null },
      ]),
    );
  });
});
