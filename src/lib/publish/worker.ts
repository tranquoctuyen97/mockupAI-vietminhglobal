/**
 * Publish Worker — 2-stage pipeline: Shopify → Printify
 *
 * Retry: 3 attempts with exponential backoff (1s, 2s, 4s)
 * SSE: real-time progress events
 * Idempotency: sha256(draftId + tenantId + scope)
 */

import { createHash } from "node:crypto";
import { isPublishDryRun, PRODUCT_DEFAULTS } from "@/lib/config/runtime-controls";
import { decrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";
import { getLatestJobByDraftDesignId } from "@/lib/mockup/multi-design";
import { resolveEffectivePlacementData } from "@/lib/mockup/plan";
import {
  isAllowedRemoteMockupUrl,
  isRemoteUrl,
  isSyntheticMockupSource,
} from "@/lib/mockup/real-printify-media";
import { parseMockupSourceUrl } from "@/lib/mockup/source-url";
import { DEFAULT_PLACEMENT, type PlacementData } from "@/lib/placement/types";
import { getClientForStore } from "@/lib/printify/account";
import { PrintifyApiError, PrintifyNotFoundError } from "@/lib/printify/client";
import { createOrUpdatePrintifyProduct, ensurePrintifyImage } from "@/lib/printify/product";
import { buildVariantPayload, computeVariantMatrixPerColor, ensureVariantCostCache } from "@/lib/printify/variant-catalog";
import { ShopifyClient } from "@/lib/shopify/client";
import { sseChannels } from "@/lib/sse/channel";
import { getStorage } from "@/lib/storage/local-disk";
import { publishToPrintify } from "./printify";
import { publishToShopify, type ShopifyMockupImage } from "./shopify";

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 2000;

export function generateIdempotencyKey(draftId: string, tenantId: string, scope = ""): string {
  return createHash("sha256").update(`${draftId}|${tenantId}|${scope}`).digest("hex");
}

interface PublishInput {
  listingId: string;
  draftId: string;
  tenantId: string;
}

type PublishableMockupImage = {
  compositeUrl: string | null;
  sourceUrl: string;
  colorName: string;
};

type StorageResolver = {
  resolvePath(key: string): string;
};

export async function runPublishWorker(input: PublishInput): Promise<void> {
  const { listingId, draftId, tenantId } = input;
  const publishChannelId = `publish:${listingId}`;
  const draftChannelId = draftId; // Also emit to draft events for Step 5 review page
  let draftDesignIdForEvents: string | null = null;

  const emitEvent = (type: string, data: Record<string, unknown> = {}) => {
    const payload = { ...data, listingId, draftId, draftDesignId: draftDesignIdForEvents };
    sseChannels.emit(publishChannelId, { type, data: payload });
    sseChannels.emit(draftChannelId, { type, data: payload });
  };

  try {
    // Load listing with all relations
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { variants: true, publishJobs: true },
    });
    if (!listing) throw new Error("Listing not found");
    draftDesignIdForEvents = listing.wizardDraftDesignId ?? null;

    // Load store
    const store = await prisma.store.findUnique({
      where: { id: listing.storeId! },
    });
    if (!store) {
      // Store was deleted — mark all jobs as FAILED gracefully
      for (const job of listing.publishJobs) {
        await prisma.publishJob.update({
          where: { id: job.id },
          data: { status: "FAILED", lastError: "Store đã bị xóa", completedAt: new Date() },
        });
      }
      await prisma.listing.update({
        where: { id: listingId },
        data: { status: "FAILED" },
      });
      emitEvent("publish.failed", {
        error: "Store đã bị xóa. Vui lòng chọn lại store và thử publish lại.",
      });
      return;
    }

    // Load credentials
    const creds = await prisma.storeCredentials.findUnique({
      where: { storeId: store.id },
    });
    if (!creds || !creds.shopifyTokenEncrypted)
      throw new Error("Store credentials not found or Shopify not connected");

    let shopifyAccessToken: string;
    try {
      shopifyAccessToken = decrypt(creds.shopifyTokenEncrypted);
    } catch {
      throw new Error(
        "Shopify token hết hạn hoặc bị lỗi mã hóa. Vui lòng kết nối lại Shopify ở Store Settings → Shopify tab.",
      );
    }

    // Load draft for mockup paths
    const draft = await prisma.wizardDraft.findUnique({
      where: { id: draftId },
      include: {
        mockupJobs: {
          include: {
            images: {
              orderBy: { sortOrder: "asc" },
            },
          },
        },
        design: true,
        draftDesigns: {
          orderBy: { sortOrder: "asc" },
          include: {
            design: true,
          },
        },
        template: true,
        store: { include: { colors: true } },
      },
    });
    if (!draft) throw new Error("Draft not found");

    const storage = getStorage();
    const listingColorNames = listing.variants.map((v) => v.colorName);
    const latestJobsByDesign = getLatestJobByDraftDesignId(draft.mockupJobs);
    const draftDesign = listing.wizardDraftDesignId
      ? draft.draftDesigns.find((entry) => entry.id === listing.wizardDraftDesignId) ?? null
      : null;
    const designJobKey = listing.wizardDraftDesignId ?? listing.designId ?? draft.designId ?? null;
    const selectedMockupJob = designJobKey ? latestJobsByDesign.get(designJobKey) ?? null : null;

    if (!selectedMockupJob || selectedMockupJob.status?.toLowerCase() !== "completed") {
      throw new Error(
        `Mockups chưa hoàn tất cho design ${draftDesign?.design?.name ?? draft.design?.name ?? listing.title}`,
      );
    }

    const includedImages = (selectedMockupJob.images ?? []).filter(
      (image) => image.included && Boolean(image.compositeUrl),
    );
    const isDryRun = isPublishDryRun();
    const requireRealPrintifyMockups = PRODUCT_DEFAULTS.mockup.requireRealPrintifyMockups;
    // Resolve template
    let template = draft.template;
    if (!template && draft.storeId) {
      template = await prisma.storeMockupTemplate.findFirst({
        where: { storeId: draft.storeId, isDefault: true },
      });
    }

    // Pre-calculate variants payload for accurate Shopify/Printify options
    let shopifyVariants: Array<{
      colorName: string;
      size: string;
      sku: string;
      price: number;
      printifyVariantId: string;
    }> = [];
    let shopifySizes: string[] = [];

    let printifyApiKey: string | null = null;
    let externalShopId: number | null = null;
    try {
      const result = await getClientForStore(store.id);
      printifyApiKey = (result.client as any).apiKey;
      externalShopId = result.externalShopId;
    } catch (err) {
      console.warn("[PublishWorker] Could not resolve Printify shop (non-fatal for Shopify stage):", err);
    }

    try {
      const blueprintId = template?.printifyBlueprintId ?? 0;
      const printProviderId = template?.printifyPrintProviderId ?? 0;
      const productType = template?.blueprintTitle || draft.store?.name || "Apparel";

      if (blueprintId && printProviderId && productType && externalShopId && printifyApiKey) {
        // 1. Fetch pricing template
        const pricing = await prisma.productPricingTemplate.findFirst({
          where: { productType },
        });
        const baseRetailPriceUSD = pricing?.basePriceUsd ?? 24.99;

        // 2. Fetch cache
        const { client: printifyClient } = await getClientForStore(store.id);
        const cachedVariants = await ensureVariantCostCache({
          client: printifyClient,
          shopId: externalShopId,
          blueprintId,
          printProviderId,
        });

        // 3. Extract colors & sizes from draft
        const enabledColorIdSet = new Set(draft.enabledColorIds ?? []);
        const storeColors = (draft.store as any)?.colors ?? [];
        const selectedColorNames: string[] = storeColors
          .filter((c: any) => enabledColorIdSet.has(c.id))
          .map((c: any) => c.name);

        // 4. Per-color sizes or global fallback
        const sizesByColor = draft.enabledSizesByColor as Record<string, string[]> | null;
        const hasSizesByColor = sizesByColor && Object.keys(sizesByColor).length > 0;

        let effectiveVariantIds: number[];
        if (hasSizesByColor) {
          effectiveVariantIds = computeVariantMatrixPerColor(
            cachedVariants,
            selectedColorNames,
            sizesByColor!,
            draft.enabledSizes ?? [],
          );
        } else {
          const selectedSizes = draft.enabledSizes || [];
          const effectiveSizes =
            selectedSizes.length > 0
              ? selectedSizes
              : [...new Set(cachedVariants.filter((v) => v.isAvailable).map((v) => v.size))];
          effectiveVariantIds = cachedVariants
            .filter((v) => {
              const lowerColor = v.colorName.trim().toLowerCase();
              const colorOk = selectedColorNames.some((c) => c.trim().toLowerCase() === lowerColor);
              return v.isAvailable && colorOk && effectiveSizes.includes(v.size);
            })
            .map((v) => v.variantId);
        }

        // 5. Build payload
        const effectiveSizesForPayload = hasSizesByColor
          ? [...new Set(Object.values(sizesByColor!).flat())]
          : (draft.enabledSizes?.length > 0
            ? draft.enabledSizes
            : [...new Set(cachedVariants.filter((v) => v.isAvailable).map((v) => v.size))]);

        const priceBySizeOverride = draft.priceBySizeOverride as Record<string, number> | null;

        const printifyVariantsPayload = buildVariantPayload(
          cachedVariants,
          selectedColorNames,
          effectiveSizesForPayload,
          baseRetailPriceUSD,
          priceBySizeOverride,
        );

        const enabledSet = new Set(effectiveVariantIds);
        const finalPrintifyVariantsPayload = printifyVariantsPayload.map((p) => ({
          ...p,
          is_enabled: enabledSet.has(p.id),
        }));

        shopifySizes = effectiveSizesForPayload;
        
        // Map enabled variants to shopifyVariants payload & validate SKU uniqueness
        const skuSet = new Set<string>();
        for (const p of finalPrintifyVariantsPayload) {
          if (p.is_enabled) {
            const cachedV = cachedVariants.find(v => v.variantId === p.id);
            if (cachedV) {
              let sku = p.sku?.trim();
              if (!sku || sku === "") {
                sku = `VMG-${blueprintId}-${p.id}`;
              }
              if (skuSet.has(sku)) {
                throw new Error(`Trùng lặp SKU: ${sku}. Vui lòng kiểm tra lại cấu hình SKU.`);
              }
              skuSet.add(sku);

              shopifyVariants.push({
                colorName: cachedV.colorName,
                size: cachedV.size,
                sku: sku,
                price: p.price,
                printifyVariantId: String(p.id),
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn(
        "[PublishWorker] Failed to build dynamic variant payload, falling back to dummy prices:",
        err,
      );
      if (err instanceof Error && err.message.startsWith("Trùng lặp SKU")) {
        throw err;
      }
    }

    // Re-create listing variants with correct sizes and SKUs in Prisma
    if (shopifyVariants.length > 0) {
      console.log(`[PublishWorker] Re-creating listing variants with correct sizes and SKUs (${shopifyVariants.length} variants)...`);
      // Delete existing variants
      await prisma.listingVariant.deleteMany({
        where: { listingId: listing.id },
      });
      
      // Re-create variants
      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          variants: {
            create: shopifyVariants.map(v => {
              // Find matching hex for color
              const matchingColor = listing.variants.find(lv => lv.colorName.toLowerCase() === v.colorName.toLowerCase());
              const hex = matchingColor?.colorHex || "#000000";
              return {
                colorName: v.colorName,
                colorHex: hex,
                size: v.size,
                sku: v.sku,
                printifyVariantId: v.printifyVariantId,
              };
            }),
          },
        },
      });
      
      // Reload listing variants so we have the updated ones in memory
      const updatedListing = await prisma.listing.findUnique({
        where: { id: listing.id },
        include: { variants: true },
      });
      if (updatedListing) {
        listing.variants = updatedListing.variants;
      }
    }

    const shopifyJob = listing.publishJobs.find((j) => j.stage === "SHOPIFY");
    if (!shopifyJob) throw new Error("Shopify publish job not found");

    emitEvent("publish.shopify.start", { stage: "SHOPIFY" });

    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: { status: "RUNNING" },
    });

    const updatedListingColorNames = listing.variants.map((v) => v.colorName);
    const { mockupImages, mockupPaths, missingColorNames } = resolveShopifyMockupMedia({
      images: includedImages,
      storage,
      colorNames: updatedListingColorNames,
      requireRealPrintifyMockups,
    });

    if (requireRealPrintifyMockups && missingColorNames.length > 0) {
      throw new Error(
        `Thiếu mockup Printify thật cho màu: ${missingColorNames.join(", ")}. Vui lòng tạo lại mockup trước khi publish.`,
      );
    }

    let shopifyResult: {
      shopifyProductId: string;
      shopifyVariantIds: string[];
      shopifyVariantsDetail?: Array<{ id: string; colorName?: string; sizeName?: string }>;
    } | null = null;

    if (isDryRun) {
      shopifyResult = {
        shopifyProductId: `gid://shopify/Product/dry-run-${Date.now()}`,
        shopifyVariantIds: listing.variants.map((v) => v.shopifyVariantId || `gid://shopify/ProductVariant/dry-${v.id}`),
        shopifyVariantsDetail: listing.variants.map((v) => ({
          id: v.shopifyVariantId || `gid://shopify/ProductVariant/dry-${v.id}`,
          colorName: v.colorName,
          sizeName: v.size,
        })),
      };
      await sleep(1000);
    } else {
      // Track product ID across retries to prevent duplicate creation
      let createdProductId: string | null = null;

      shopifyResult = await retryWithBackoff(
        async () => {
          const shopifyClient = new ShopifyClient(store.shopifyDomain!, shopifyAccessToken);
          const result = await publishToShopify(shopifyClient, store.shopifyDomain!, {
            title: listing.title,
            descriptionHtml: listing.descriptionHtml,
            tags: listing.tags,
            priceUsd: listing.priceUsd,
            productType: draft.template?.blueprintTitle || draft.store?.name || "Apparel",
            colors: listing.variants.reduce((acc, v) => {
              if (!acc.some((c) => c.name === v.colorName)) {
                acc.push({ name: v.colorName, hex: v.colorHex });
              }
              return acc;
            }, [] as Array<{ name: string; hex: string }>),
            sizes: shopifySizes.length > 0 ? shopifySizes : undefined,
            variants: shopifyVariants.length > 0 ? shopifyVariants : undefined,
            mockupPaths,
            mockupImages,
            existingProductId: createdProductId, // reuse if created in previous attempt
          });
          createdProductId = result.shopifyProductId; // save for next retry
          return {
            shopifyProductId: result.shopifyProductId,
            shopifyVariantIds: result.shopifyVariantIds,
            shopifyVariantsDetail: result.shopifyVariantsDetail,
          };
        },
        shopifyJob.id,
        "SHOPIFY",
      );
    }

    if (!shopifyResult) {
      await prisma.listing.update({
        where: { id: listingId },
        data: { status: "FAILED" },
      });
      emitEvent("publish.failed", {
        stage: "SHOPIFY",
        error: "Shopify publish failed after retries",
      });
      return;
    }

    // Update listing with Shopify IDs
    await prisma.listing.update({
      where: { id: listingId },
      data: { shopifyProductId: shopifyResult.shopifyProductId },
    });

    if (shopifyResult.shopifyVariantsDetail && shopifyResult.shopifyVariantsDetail.length > 0) {
      for (const detail of shopifyResult.shopifyVariantsDetail) {
        if (!detail.colorName || !detail.sizeName) continue;
        
        // Find matching variant in DB
        const dbVariant = listing.variants.find(
          (v) =>
            v.colorName.toLowerCase() === detail.colorName!.toLowerCase() &&
            v.size.toLowerCase() === detail.sizeName!.toLowerCase()
        );
        
        if (dbVariant) {
          await prisma.listingVariant.update({
            where: { id: dbVariant.id },
            data: { shopifyVariantId: detail.id },
          });
        }
      }
    } else {
      for (
        let i = 0;
        i < listing.variants.length && i < shopifyResult.shopifyVariantIds.length;
        i++
      ) {
        await prisma.listingVariant.update({
          where: { id: listing.variants[i].id },
          data: { shopifyVariantId: shopifyResult.shopifyVariantIds[i] },
        });
      }
    }

    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });

    emitEvent("publish.shopify.done", { shopifyProductId: shopifyResult.shopifyProductId });

    // Refresh listing object before running Printify stage
    const refreshedListing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { variants: true, publishJobs: true },
    });
    if (refreshedListing) {
      Object.assign(listing, refreshedListing);
    }

    // ─── Stage 2: Printify ──────────────────────────────

    // Phase 6.5: Lookup Printify key via workspace-level account
    try {
      const result = await getClientForStore(store.id);
      printifyApiKey = (result.client as any).apiKey; // access private field for worker
      externalShopId = result.externalShopId;
    } catch {
      // No Printify linked
    }

    if (!printifyApiKey) {
      await prisma.listing.update({
        where: { id: listingId },
        data: { status: "PARTIAL_FAILURE" },
      });
      emitEvent("publish.complete", {
        status: "PARTIAL_FAILURE",
        reason: "No Printify shop linked",
      });
      return;
    }

    await runPrintifyStage(
      listingId,
      listing,
      draft,
      store,
      printifyApiKey,
      externalShopId,
      storage,
      isDryRun,
      publishChannelId,
      draftChannelId,
    );
  } catch (error) {
    console.error("[PublishWorker] Unexpected error:", error);
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "FAILED" },
    });
    emitEvent("publish.failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Printify stage — can be called independently for retry
 */
export async function runPrintifyStage(
  listingId: string,
  listing: any,
  draft: any,
  store: any,
  printifyApiKey: string,
  externalShopId: number | null,
  storage: any,
  isDryRun: boolean,
  channelId: string,
  draftId: string,
): Promise<void> {
  const printifyJob = listing.publishJobs.find((j: any) => j.stage === "PRINTIFY");
  if (!printifyJob) return;

  const emitEvent = (type: string, data: Record<string, unknown> = {}) => {
    const payload = { ...data, listingId, draftId, draftDesignId: listing.wizardDraftDesignId ?? null };
    sseChannels.emit(channelId, { type, data: payload });
    sseChannels.emit(draftId, { type, data: payload });
  };

  const draftDesign = listing.wizardDraftDesignId
    ? draft.draftDesigns?.find((entry: any) => entry.id === listing.wizardDraftDesignId) ?? null
    : null;
  const targetDesign = draftDesign?.design ?? draft.design ?? null;
  if (listing.wizardDraftDesignId && !draftDesign) {
    await prisma.publishJob.update({
      where: { id: printifyJob.id },
      data: { status: "FAILED", lastError: "Draft design not found", attempts: { increment: 1 } },
    });
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "PARTIAL_FAILURE" },
    });
    emitEvent("publish.complete", { status: "PARTIAL_FAILURE", reason: "Draft design not found" });
    return;
  }

  const designJobKey = listing.wizardDraftDesignId ?? listing.designId ?? draft.designId ?? null;
  const latestJobsByDesign = getLatestJobByDraftDesignId(draft.mockupJobs ?? []);
  const selectedMockupJob = designJobKey ? latestJobsByDesign.get(designJobKey) ?? null : null;

  emitEvent("publish.printify.start", { stage: "PRINTIFY" });

  await prisma.publishJob.update({
    where: { id: printifyJob.id },
    data: { status: "RUNNING" },
  });

  let printifyResult: { printifyProductId: string } | null = null;

  if (isDryRun) {
    printifyResult = { printifyProductId: `dry-run-${Date.now()}` };
    await sleep(1000);
  } else {
    if (!selectedMockupJob || selectedMockupJob.status?.toLowerCase() !== "completed") {
      await prisma.publishJob.update({
        where: { id: printifyJob.id },
        data: { status: "FAILED", lastError: "Mockups not ready", attempts: { increment: 1 } },
      });
      await prisma.listing.update({
        where: { id: listingId },
        data: { status: "PARTIAL_FAILURE" },
      });
      emitEvent("publish.complete", {
        status: "PARTIAL_FAILURE",
        reason: `Mockups chưa hoàn tất cho design ${targetDesign?.name ?? listing.title}`,
      });
      return;
    }

    const designPath = targetDesign?.storagePath
      ? storage.resolvePath(targetDesign.storagePath)
      : null;

    if (!designPath) {
      await prisma.publishJob.update({
        where: { id: printifyJob.id },
        data: { status: "FAILED", lastError: "Design file not found", attempts: { increment: 1 } },
      });
      await prisma.listing.update({
        where: { id: listingId },
        data: { status: "PARTIAL_FAILURE" },
      });
      emitEvent("publish.complete", { status: "PARTIAL_FAILURE", reason: "Design file not found" });
      return;
    }

    const includedImagesForPrintify = (selectedMockupJob.images ?? []).filter((img: any) => img.included);

    const selectedMockupIds = includedImagesForPrintify
      .map((img: any) => img.printifyMockupId)
      .filter((id: string) => id && !id.startsWith("custom:") && !id.startsWith("synthetic:"));
    const draftProductId = draftDesign?.printifyDraftProductId ?? draft.printifyDraftProductId ?? null;
    const draftImageId = draftDesign?.printifyImageId ?? draft.printifyImageId ?? null;
    let template = draft.template;
    if (!template && draft.storeId) {
      template = await prisma.storeMockupTemplate.findFirst({
        where: { storeId: draft.storeId, isDefault: true },
      });
    }

    const variantIds = resolvePublishVariantIds(listing, draft, template);
    const placementData =
      resolveEffectivePlacementData(draft.placementOverride, template?.defaultPlacement) ??
      defaultPlacementData();

    // -- Calculate Variants Payload (Price & SKU) --
    let printifyVariantsPayload: any[] | undefined;
    try {
      const blueprintId = template?.printifyBlueprintId ?? 0;
      const printProviderId = template?.printifyPrintProviderId ?? 0;
      const productType = template?.blueprintTitle ?? draft.productType;

      if (blueprintId && printProviderId && productType && externalShopId) {
        // 1. Fetch pricing template
        const pricing = await prisma.productPricingTemplate.findFirst({
          where: { productType },
        });
        const baseRetailPriceUSD = pricing?.basePriceUsd ?? 24.99;

        // 2. Fetch cache
        const { client: printifyClient } = await getClientForStore(store.id);
        const cachedVariants = await ensureVariantCostCache({
          client: printifyClient,
          shopId: externalShopId,
          blueprintId,
          printProviderId,
        });

        // 3. Extract colors & sizes from draft
        const enabledColorIdSet = new Set(draft.enabledColorIds ?? []);
        const storeColors = (draft.store as any)?.colors ?? [];
        const selectedColorNames: string[] = storeColors
          .filter((c: any) => enabledColorIdSet.has(c.id))
          .map((c: any) => c.name);

        // 4. Per-color sizes or global fallback
        const sizesByColor = draft.enabledSizesByColor as Record<string, string[]> | null;
        const hasSizesByColor = sizesByColor && Object.keys(sizesByColor).length > 0;

        let effectiveVariantIds: number[];
        if (hasSizesByColor) {
          // Per-color mode: each color uses its own size list
          effectiveVariantIds = computeVariantMatrixPerColor(
            cachedVariants,
            selectedColorNames,
            sizesByColor!,
            draft.enabledSizes ?? [],
          );
        } else {
          // Legacy global mode
          const selectedSizes = draft.enabledSizes || [];
          const effectiveSizes =
            selectedSizes.length > 0
              ? selectedSizes
              : [...new Set(cachedVariants.filter((v) => v.isAvailable).map((v) => v.size))];
          effectiveVariantIds = cachedVariants
            .filter((v) => {
              const lowerColor = v.colorName.trim().toLowerCase();
              const colorOk = selectedColorNames.some((c) => c.trim().toLowerCase() === lowerColor);
              return v.isAvailable && colorOk && effectiveSizes.includes(v.size);
            })
            .map((v) => v.variantId);
        }

        // 5. Build payload with computed variant IDs determining enabled state
        const effectiveSizesForPayload = hasSizesByColor
          ? [...new Set(Object.values(sizesByColor!).flat())]
          : (draft.enabledSizes?.length > 0
            ? draft.enabledSizes
            : [...new Set(cachedVariants.filter((v) => v.isAvailable).map((v) => v.size))]);

        const priceBySizeOverride = draft.priceBySizeOverride as Record<string, number> | null;

        printifyVariantsPayload = buildVariantPayload(
          cachedVariants,
          selectedColorNames,
          effectiveSizesForPayload,
          baseRetailPriceUSD,
          priceBySizeOverride,
        );
        // Override is_enabled based on exact per-color computation
        const enabledSet = new Set(effectiveVariantIds);
        printifyVariantsPayload = printifyVariantsPayload.map((p) => ({
          ...p,
          is_enabled: enabledSet.has(p.id),
        }));
      }
    } catch (err) {
      console.warn(
        "[PublishWorker] Failed to build dynamic variant payload, falling back to dummy prices:",
        err,
      );
    }

    if (draftProductId) {
      printifyResult = await retryWithBackoff(
        async () =>
          publishExistingPrintifyDraftProduct({
            storeId: store.id,
            draftId: draft.id,
            draftDesignId: draftDesign?.id ?? null,
            productId: draftProductId,
            designStoragePath: designPath,
            cachedImageId: draftImageId,
            title: listing.title,
            description: listing.descriptionHtml,
            blueprintId: template?.printifyBlueprintId ?? 0,
            printProviderId: template?.printifyPrintProviderId ?? 0,
            variantIds,
            variants: printifyVariantsPayload,
            placementData,
          }),
        printifyJob.id,
        "PRINTIFY",
      );
    } else {
      printifyResult = await retryWithBackoff(
        async () => {
          return publishToPrintify({
            apiKey: printifyApiKey,
            shopId: externalShopId?.toString() || "",
            title: listing.title,
            description: listing.descriptionHtml,
            blueprintId: template?.printifyBlueprintId ?? 0,
            printProviderId: template?.printifyPrintProviderId ?? 0,
            variantIds,
            variants: printifyVariantsPayload,
            mockupPaths: [],
            selectedMockupIds,
            designPath,
          });
        },
        printifyJob.id,
        "PRINTIFY",
      );
    }
  }

  if (printifyResult) {
    await prisma.listing.update({
      where: { id: listingId },
      data: {
        printifyProductId: printifyResult.printifyProductId,
        status: "ACTIVE",
        publishedAt: new Date(),
      },
    });
    await prisma.publishJob.update({
      where: { id: printifyJob.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });
    // Emit printify done before final complete
    emitEvent("publish.printify.done", { printifyProductId: printifyResult.printifyProductId });

    emitEvent("publish.complete", { status: "ACTIVE", printifyProductId: printifyResult.printifyProductId });
  } else {
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "PARTIAL_FAILURE" },
    });
    emitEvent("publish.complete", {
      status: "PARTIAL_FAILURE",
      reason: "Printify publish failed after retries",
    });
  }
}

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  jobId: string,
  stage: string,
): Promise<T | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await prisma.publishJob.update({
        where: { id: jobId },
        data: { attempts: attempt },
      });
      return await fn();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[PublishWorker] ${stage} attempt ${attempt}/${MAX_RETRIES} failed:`, errorMsg);

      await prisma.publishJob.update({
        where: { id: jobId },
        data: { lastError: errorMsg },
      });

      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_BASE_MS * 2 ** (attempt - 1);
        await sleep(delay);
      } else {
        await prisma.publishJob.update({
          where: { id: jobId },
          data: { status: "FAILED", completedAt: new Date() },
        });
        return null;
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolvePublishVariantIds(
  listing: { variants?: Array<{ printifyVariantId?: string | null }> },
  draft: any,
  template?: any,
): number[] {
  const listingVariantIds = (listing.variants ?? [])
    .map((variant) => Number(variant.printifyVariantId))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (listingVariantIds.length > 0) return Array.from(new Set(listingVariantIds));

  const templateVariantIds =
    template?.enabledVariantIds ??
    draft.template?.enabledVariantIds ??
    draft.store?.template?.enabledVariantIds ??
    [];
  return templateVariantIds.length > 0 ? templateVariantIds : [1];
}

async function publishExistingPrintifyDraftProduct(input: {
  storeId: string;
  draftId: string;
  draftDesignId?: string | null;
  productId: string;
  designStoragePath: string;
  cachedImageId?: string | null;
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  variantIds: number[];
  variants?: Array<{
    id: number;
    price: number;
    is_enabled: boolean;
    sku?: string;
    is_default?: boolean;
  }>;
  placementData: PlacementData;
}): Promise<{ printifyProductId: string }> {
  const { client, externalShopId } = await getClientForStore(input.storeId);
  const imageId = await ensurePrintifyImage({
    client,
    designStoragePath: input.designStoragePath,
    cachedImageId: input.cachedImageId,
  });

  const commonPayload = {
    client,
    shopId: externalShopId,
    blueprintId: input.blueprintId,
    printProviderId: input.printProviderId,
    variantIds: input.variantIds,
    variants: input.variants,
    imageId,
    placementData: input.placementData,
    title: input.title,
    description: input.description,
  };

  console.log(
    `[PublishWorker] PRINTIFY sending PUT update — product: ${input.productId}, shopId: ${externalShopId}, imageId: ${imageId}, variants: ${input.variants?.length ?? "fallback"}, blueprint: ${input.blueprintId}/${input.printProviderId}`,
  );

  try {
    const product = await createOrUpdatePrintifyProduct({
      ...commonPayload,
      productId: input.productId,
    });
    if (input.draftDesignId) {
      await prisma.wizardDraftDesign.update({
        where: { id: input.draftDesignId },
        data: {
          printifyImageId: imageId,
          printifyDraftProductId: product.productId,
          lastError: null,
        },
      });
    } else {
      await prisma.wizardDraft.update({
        where: { id: input.draftId },
        data: {
          printifyImageId: imageId,
          printifyDraftProductId: product.productId,
        },
      });
    }
    return { printifyProductId: product.productId };
  } catch (err) {
    // Draft product was deleted or corrupted on Printify — clear stale ref and CREATE new
    const isNotFound = err instanceof PrintifyNotFoundError;
    const isServerError = err instanceof PrintifyApiError && /\(5\d{2}\)/.test(err.message);
    if (isNotFound || isServerError) {
      console.warn(
        `[PublishWorker] Draft product ${input.productId} ${isNotFound ? "not found (404)" : "server error (5xx)"}. Clearing stale ref and creating new product.`,
      );
      if (input.draftDesignId) {
        await prisma.wizardDraftDesign.update({
          where: { id: input.draftDesignId },
          data: { printifyDraftProductId: null },
        });
      } else {
        await prisma.wizardDraft.update({
          where: { id: input.draftId },
          data: { printifyDraftProductId: null },
        });
      }

      const product = await createOrUpdatePrintifyProduct({
        ...commonPayload,
        productId: null, // Force CREATE
      });
      if (input.draftDesignId) {
        await prisma.wizardDraftDesign.update({
          where: { id: input.draftDesignId },
          data: {
            printifyImageId: imageId,
            printifyDraftProductId: product.productId,
            lastError: null,
          },
        });
      } else {
        await prisma.wizardDraft.update({
          where: { id: input.draftId },
          data: {
            printifyImageId: imageId,
            printifyDraftProductId: product.productId,
          },
        });
      }
      return { printifyProductId: product.productId };
    }
    throw err;
  }
}

function defaultPlacementData(): PlacementData {
  return {
    version: "2.1",
    variants: {
      _default: {
        front: DEFAULT_PLACEMENT,
      },
    },
  };
}

export function resolveShopifyMockupMedia(input: {
  images: PublishableMockupImage[];
  storage: StorageResolver;
  colorNames: string[];
  requireRealPrintifyMockups: boolean;
}): {
  mockupImages: ShopifyMockupImage[];
  mockupPaths: string[];
  missingColorNames: string[];
} {
  const selectedColors = input.colorNames.map((name) => ({
    name,
    key: normalizeColorName(name),
  }));
  const selectedColorKeys = new Set(selectedColors.map((color) => color.key));
  const coveredColorKeys = new Set<string>();
  const rawMockupImages: ShopifyMockupImage[] = [];

  for (const image of input.images) {
    const colorKey = normalizeColorName(image.colorName);
    if (!selectedColorKeys.has(colorKey)) continue;

    const source = image.compositeUrl ?? image.sourceUrl;
    if (!source) continue;

    if (isRemoteUrl(source)) {
      if (!isAllowedRemoteMockupUrl(source)) continue;
      rawMockupImages.push({
        kind: "remote",
        url: source,
        colorName: image.colorName,
      });
      coveredColorKeys.add(colorKey);
      continue;
    }

    if (isSyntheticMockupSource(source)) continue;
    const parsedSource = image.sourceUrl
      ? parseMockupSourceUrl(image.sourceUrl)
      : { kind: "printify" as const };
    const hasRealPrintifySource =
      isAllowedRemoteMockupUrl(image.sourceUrl) ||
      parsedSource.kind === "custom";
    if (input.requireRealPrintifyMockups && !hasRealPrintifySource) continue;

    const path = input.storage.resolvePath(source);
    rawMockupImages.push({
      kind: "local",
      path,
      colorName: image.colorName,
    });
    coveredColorKeys.add(colorKey);
  }

  // 1. Choose a random Primary Color from colors that have mockups
  const coveredColorNames = Array.from(coveredColorKeys);
  let primaryColorKey: string | null = null;
  if (coveredColorNames.length > 0) {
    const randomName = coveredColorNames[Math.floor(Math.random() * coveredColorNames.length)];
    primaryColorKey = randomName;
  }

  // 2. Separate primary color images and rest
  const primaryImages = rawMockupImages.filter(img => img.colorName && normalizeColorName(img.colorName) === primaryColorKey);
  const otherImages = rawMockupImages.filter(img => !img.colorName || normalizeColorName(img.colorName) !== primaryColorKey);

  // 3. Sort otherImages to match input.colorNames order
  const colorOrderMap = new Map<string, number>();
  input.colorNames.forEach((name, idx) => {
    colorOrderMap.set(normalizeColorName(name), idx);
  });

  otherImages.sort((a, b) => {
    const idxA = a.colorName ? (colorOrderMap.get(normalizeColorName(a.colorName)) ?? 9999) : 9999;
    const idxB = b.colorName ? (colorOrderMap.get(normalizeColorName(b.colorName)) ?? 9999) : 9999;
    return idxA - idxB;
  });

  // 4. Combine: primary color images first, then other sorted images
  const finalMockupImages = [...primaryImages, ...otherImages];

  return {
    mockupImages: finalMockupImages,
    mockupPaths: finalMockupImages
      .filter(
        (image): image is Extract<ShopifyMockupImage, { kind: "local" }> => image.kind === "local",
      )
      .map((image) => image.path),
    missingColorNames: selectedColors
      .filter((color) => !coveredColorKeys.has(color.key))
      .map((color) => color.name),
  };
}

function normalizeColorName(value: string): string {
  return value.trim().toLowerCase();
}
