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
  const shopifySource = readFileSync(new URL("./shopify.ts", import.meta.url), "utf8");

  it("passes Listing organizationCollections to Shopify publish", () => {
    assert.match(
      source,
      /organizationCollections:\s*listing\.organizationCollections\s*\?\?\s*\[\]/,
    );
  });

  it("persists Shopify product id during productSet before later retryable steps", () => {
    assert.match(source, /onProductCreated:\s*async\s*\(productId,\s*variantNodes\)/);
    assert.match(source, /data:\s*\{\s*shopifyProductId:\s*productId\s*\}/);
    assert.match(
      source,
      /let createdProductId:\s*string\s*\|\s*null\s*=\s*listing\.shopifyProductId/,
    );
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

  it("persists Shopify Direct variants by SKU instead of index", () => {
    assert.match(source, /persistDirectShopifyVariantMapping/);
    assert.match(source, /shopifyVariantBySku/);
    assert.match(source, /prisma\.listingVariant\.deleteMany/);
    assert.match(source, /prisma\.listingVariant\.createMany/);
    assert.doesNotMatch(
      source,
      /listing\.variants\[i\]\.id[\s\S]{0,180}shopifyResult\.shopifyVariantIds\[i\]/,
    );
  });

  it("verifies Shopify Direct media and publications before marking Shopify success", () => {
    const resultIndex = source.indexOf("if (!shopifyResult)");
    const verifyIndex = source.indexOf("await repairAndVerifyShopifyPostSync(", resultIndex);
    const mappingIndex = source.indexOf("await persistDirectShopifyVariantMapping(", verifyIndex);
    const publishIndex = source.indexOf("await publishShopifyChannelsStrict(", mappingIndex);
    const successIndex = source.indexOf(
      'data: { status: "SUCCEEDED", completedAt: new Date() }',
      publishIndex,
    );
    assert.ok(
      verifyIndex > resultIndex,
      "Direct should run shared Shopify verifier after productSet/reuse",
    );
    assert.ok(mappingIndex > verifyIndex, "Direct should persist DB mapping after verification");
    assert.ok(publishIndex > mappingIndex, "Direct should publish channels after mapping");
    assert.ok(
      successIndex > publishIndex,
      "Direct Shopify job should succeed only after strict channel publish",
    );
  });

  it("reuses existing Shopify Direct products by fetching current variants", () => {
    assert.match(shopifySource, /fetchProductVariantNodes/);
    assert.match(
      shopifySource,
      /variantNodes = await fetchProductVariantNodes\(client, productId\)/,
    );
    assert.doesNotMatch(shopifySource, /variantIds = \[\]; \/\/ variants already exist/);
    assert.doesNotMatch(shopifySource, /productVariantsBulkUpdate failed \(non-fatal\)/);
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
    const syncIndex = source.indexOf("await waitForPrintifyShopifySync(");
    assert.ok(publishIndex > -1, "Printify publishProduct should be called");
    assert.ok(syncIndex > -1, "Shopify sync should be called");
    assert.ok(publishIndex < syncIndex, "Printify publish must happen before Shopify sync");
    assert.match(
      source,
      /printifyClient,\s*printifyShopId:\s*externalShopId,\s*printifyProductId:\s*resolvedPrintifyProductResult\.productId/s,
    );
    assert.match(source, /timeoutMs:\s*600_000/);
  });

  it("does not let Printify sync mockup images to Shopify", () => {
    const publishIndex = source.indexOf("await printifyClient.publishProduct(");
    const publishPayloadEndIndex = source.indexOf("});", publishIndex);
    const publishPayloadSource = source.slice(publishIndex, publishPayloadEndIndex);
    assert.ok(publishIndex > -1, "Printify publishProduct should be called");
    assert.match(publishPayloadSource, /images:\s*false/);
    assert.doesNotMatch(publishPayloadSource, /images:\s*true/);
  });

  it("extracts enabled Printify matrix and persists listing variants", () => {
    assert.match(source, /extractEnabledPrintifyVariantMatrix/);
    assert.match(source, /listingVariant\.deleteMany/);
    assert.match(source, /listingVariant\.createMany/);
  });

  it("passes Listing organizationCollections into Printify Shopify sales channel properties", () => {
    assert.match(
      source,
      /salesChannelCollections:\s*normalizeOrganizationCollections\(\s*listing\.organizationCollections,\s*\)/,
    );
  });

  it("attaches Shopify collections after Printify Shopify-channel sync", () => {
    const syncIndex = source.indexOf("await waitForPrintifyShopifySync(");
    const attachIndex = source.indexOf("await attachProductToManualCollections(");
    assert.ok(syncIndex > -1, "Shopify sync should be awaited");
    assert.ok(attachIndex > -1, "Shopify collection attach should be called");
    assert.ok(syncIndex < attachIndex, "collection attach must run after Shopify product sync");
    assert.match(source, /collections:\s*listing\.organizationCollections\s*\?\?\s*\[\]/);
  });

  it("updates Shopify category after Printify Shopify-channel sync without failing publish", () => {
    const syncIndex = source.indexOf("await waitForPrintifyShopifySync(");
    const categoryIndex = source.indexOf("await updateProductCategory(");
    const attachIndex = source.indexOf("await attachProductToManualCollections(");
    assert.ok(syncIndex > -1, "Shopify sync should be awaited");
    assert.ok(categoryIndex > syncIndex, "category update should run after Shopify sync");
    assert.ok(categoryIndex < attachIndex, "category update should run before collection attach");
    assert.match(source, /Shopify category post-sync failed \(non-fatal\)/);
    assert.match(
      source,
      /productType:\s*draft\.template\?\.blueprintTitle\s*\?\?\s*draft\.productType/,
    );
  });

  it("publishes the verified Shopify product to all publications before marking it active", () => {
    const syncIndex = source.indexOf("await waitForPrintifyShopifySync(");
    const repairIndex = source.indexOf("await repairAndVerifyShopifyPostSync(", syncIndex);
    const mappingIndex = source.indexOf("await persistPrintifyShopifyVariantMapping(", repairIndex);
    const publishChannelsIndex = source.indexOf(
      "await publishShopifyChannelsStrict(",
      mappingIndex,
    );
    const activeUpdateIndex = source.indexOf(
      'data: { status: "ACTIVE", publishedAt: new Date() }',
      publishChannelsIndex,
    );
    assert.ok(syncIndex > -1, "Shopify sync should be awaited");
    assert.ok(repairIndex > syncIndex, "post-sync repair should run after Shopify sync");
    assert.ok(
      mappingIndex > repairIndex,
      "variant mapping should persist after Shopify verification",
    );
    assert.ok(
      publishChannelsIndex > mappingIndex,
      "sales-channel publish should run after Shopify verification and mapping",
    );
    assert.ok(
      activeUpdateIndex > publishChannelsIndex,
      "listing should only become active after sales-channel publish",
    );
    assert.match(source, /Đưa sản phẩm lên các kênh bán hàng Shopify thất bại/);
    assert.match(source, /status:\s*"PARTIAL_FAILURE"/);
  });

  it("repairs and verifies Shopify options and media after sync", () => {
    const syncIndex = source.indexOf("await waitForPrintifyShopifySync(");
    const repairIndex = source.indexOf("await repairAndVerifyShopifyPostSync(", syncIndex);
    const mappingIndex = source.indexOf("await persistPrintifyShopifyVariantMapping(", repairIndex);
    assert.ok(repairIndex > syncIndex, "post-sync repair should run after Shopify sync");
    assert.ok(
      mappingIndex > repairIndex,
      "variant mapping should persist only after Shopify verification",
    );
    assert.match(source, /Chuẩn hóa tùy chọn, phiên bản và hình ảnh Shopify thất bại/);
    assert.match(source, /status:\s*"PARTIAL_FAILURE"/);
  });

  it("uses one primary color for synced Shopify option order and media order", () => {
    const syncIndex = source.indexOf("await waitForPrintifyShopifySync(");
    const primaryIndex = source.indexOf(
      "const primaryColorName = pickPrimaryColorName(mockupImages)",
      syncIndex,
    );
    const mediaOrderIndex = source.indexOf("orderMockupImagesByPrimary(", primaryIndex);
    const repairIndex = source.indexOf("await repairAndVerifyShopifyPostSync(", mediaOrderIndex);
    assert.ok(primaryIndex > syncIndex, "primary color should be selected after Shopify sync");
    assert.ok(
      mediaOrderIndex > primaryIndex,
      "media ordering should use the selected primary color",
    );
    assert.ok(
      repairIndex > mediaOrderIndex,
      "post-sync repair should use the ordered media and same primary color",
    );
    assert.match(source, /primaryColorName,\s*sizesInOrder:\s*draft\.enabledSizes \?\? \[\],/);
    assert.match(source, /repairAndVerifyShopifyPostSync/);
  });

  it("persists Shopify product id as soon as Printify external resolves", () => {
    const syncIndex = source.indexOf("await waitForPrintifyShopifySync(");
    const foundIndex = source.indexOf("onShopifyProductFound", syncIndex);
    const updateIndex = source.indexOf("data: { shopifyProductId }", foundIndex);
    assert.ok(foundIndex > syncIndex, "sync wait should receive an early product-found callback");
    assert.ok(
      updateIndex > foundIndex,
      "callback should persist listing.shopifyProductId immediately",
    );
    assert.doesNotMatch(source, /phase:\s*"SHOPIFY_ID_PERSISTED"/);
    assert.match(source, /phase:\s*"WAITING_VARIANTS"/);
  });

  it("tracks durable Shopify publish phases", () => {
    assert.match(source, /type ShopifyPublishPhase/);
    assert.match(source, /async function setPublishJobPhase/);
    assert.match(source, /PUBLISH_PHASE_LABELS/);
    assert.match(source, /publish\.progress/);
    assert.match(source, /phase:\s*"UPDATING_ORGANIZATION"/);
    assert.match(source, /onPhaseChange/);
    assert.match(source, /phase:\s*"PUBLISHING_CHANNELS"/);
  });

  it("recovers a missing resumed Printify product only by exact SKU set", () => {
    assert.match(source, /buildPrintifyRecoveryData/);
    assert.match(source, /getPrintifyRecoveryDataFromJob/);
    assert.match(source, /expectedSkus/);
    assert.match(source, /blueprintId/);
    assert.match(source, /printProviderId/);
    assert.match(source, /recoverPrintifyProductByExactSkuSet/);
    assert.match(source, /MISSING_PRINTIFY_PRODUCT/);
    assert.match(source, /AMBIGUOUS_PRINTIFY_PRODUCT/);
    assert.match(source, /sameStringSet\(input\.expectedSkuSet, productSkuSet\)/);
    assert.match(
      source,
      /matchesPrintifyCatalog\(product, input\.blueprintId, input\.printProviderId\)/,
    );
  });

  it("optionally unpublishes Printify after Shopify sync while keeping Shopify active", () => {
    const mappingIndex = source.indexOf("await persistPrintifyShopifyVariantMapping(");
    const unpublishIndex = source.indexOf("await printifyClient.unpublishProduct(", mappingIndex);
    const activeUpdateIndex = source.indexOf(
      'data: { status: "ACTIVE", publishedAt: new Date() }',
      unpublishIndex,
    );
    assert.ok(mappingIndex > -1, "variant mapping should be persisted");
    assert.ok(
      unpublishIndex > mappingIndex,
      "Printify unpublish should run after mapping is persisted",
    );
    assert.ok(
      activeUpdateIndex > unpublishIndex,
      "Shopify/listing ACTIVE finalization should remain after unpublish",
    );
    assert.match(source, /store\.printifyShop\?\.unpublishAfterShopifySync/);
    assert.match(source, /Printify post-sync unpublish failed \(non-fatal\)/);
    assert.doesNotMatch(source, /status:\s*"DRAFT"/);
  });

  it("maps paired light and dark print areas across the full Printify variant catalog", () => {
    const resolverIndex = source.indexOf("async function resolvePrintifyProductPublishInput");
    const resolverSource = source.slice(
      resolverIndex,
      source.indexOf("async function publishExistingPrintifyDraftProduct", resolverIndex),
    );
    assert.match(resolverSource, /applyEffectivePrintifyColorHexes/);
    const pairLoopIndex = source.indexOf("for (const variant of cachedVariants)", resolverIndex);
    assert.ok(pairLoopIndex > -1, "pair variant loop should exist");
    const pairLoopSource = source.slice(
      pairLoopIndex,
      source.indexOf("imageGroups = [", pairLoopIndex),
    );
    assert.doesNotMatch(pairLoopSource, /enabledSet\.has\(variant\.variantId\).*continue/s);
  });

  it("persists each paired Printify image id immediately after its own upload", () => {
    const uploadPattern = /const lightImageId = await ensurePrintifyImage/;
    const uploadMatches = [...source.matchAll(new RegExp(uploadPattern.source, "g"))];
    assert.ok(uploadMatches.length >= 2, "both pair upload branches should be covered");

    for (const match of uploadMatches) {
      const branch = source.slice(match.index ?? 0, (match.index ?? 0) + 1400);
      const lightUploadIndex = branch.indexOf("const lightImageId = await ensurePrintifyImage");
      const lightPersistIndex = branch.indexOf("data: { printifyImageId: lightImageId }");
      const darkUploadIndex = branch.indexOf("const darkImageId = await ensurePrintifyImage");
      const darkPersistIndex = branch.indexOf("data: { printifyImageId: darkImageId }");

      assert.ok(lightUploadIndex > -1, "light upload should exist");
      assert.ok(
        lightPersistIndex > lightUploadIndex,
        "light image id should persist after light upload",
      );
      assert.ok(
        lightPersistIndex < darkUploadIndex,
        "light image id should persist before dark upload starts",
      );
      assert.ok(
        darkPersistIndex > darkUploadIndex,
        "dark image id should persist after dark upload",
      );
    }
  });

  it("uses explicit full-width Printify placement for Shopify-channel products", () => {
    const resolverIndex = source.indexOf("async function resolvePrintifyProductPublishInput");
    const fullWidthIndex = source.indexOf("buildFullWidthPlacementData", resolverIndex);
    const customPlacementIndex = source.indexOf(
      "await resolveCustomMockupPlacementData(",
      resolverIndex,
    );
    assert.ok(
      fullWidthIndex > resolverIndex,
      "Shopify-channel publish input should use full-width placement",
    );
    assert.equal(
      customPlacementIndex,
      -1,
      "Shopify-channel publish input should not derive placement from custom mockup region",
    );
    assert.match(source, /presetKey:\s*"full-width"/);
  });

  it("keeps Shopify-channel full-width placement from saved custom placement data", () => {
    const resolverIndex = source.indexOf("async function resolvePrintifyProductPublishInput");
    const resolverSource = source.slice(
      resolverIndex,
      source.indexOf("async function publishExistingPrintifyDraftProduct", resolverIndex),
    );
    assert.match(resolverSource, /const placementData = buildFullWidthPlacementData\(/);
    assert.doesNotMatch(resolverSource, /resolveEffectivePlacementData/);
    assert.doesNotMatch(resolverSource, /resolveCustomMockupPlacementData/);
  });

  it("does not let transient Printify create recovery leave jobs stuck running", () => {
    assert.match(source, /Failed to check recent Printify product after transient create error/);
    assert.match(
      source,
      /where:\s*\{\s*id:\s*printifyJob\.id\s*\}[\s\S]*status:\s*"FAILED"[\s\S]*completedAt:\s*new Date\(\)/,
    );
  });

  it("marks Shopify sync timeout as partial failure without Shopify productSet fallback", () => {
    assert.match(source, /Chưa xác nhận được sản phẩm Shopify sau khi Printify publish/);
    assert.doesNotMatch(source, /catch[\s\S]{0,400}publishToShopify/);
  });
});

describe("retry Printify route source contract", () => {
  it("routes retries through a publish attempt outbox instead of inline workers", () => {
    const retryRoute = readFileSync(
      new URL("../../app/api/listings/[id]/retry-printify/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(retryRoute, /publishAttempt\.create/);
    assert.match(retryRoute, /publishOutbox\.create/);
    assert.match(retryRoute, /activePublishAttemptId/);
    assert.doesNotMatch(retryRoute, /runPublishWorker/);
    assert.doesNotMatch(retryRoute, /runPrintifyStage/);
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
    assert.deepEqual(selectTagsForShopify(["Unisex", "Printify"], ["summer", "unisex", "Cotton"]), [
      "Unisex",
      "Printify",
      "summer",
      "Cotton",
    ]);
  });

  it("filters out internal mockup draft tags from listing tags", () => {
    assert.deepEqual(selectTagsForShopify(["Unisex"], ["draft-preview", "Cotton", "unisex"]), [
      "Unisex",
      "Cotton",
    ]);
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
