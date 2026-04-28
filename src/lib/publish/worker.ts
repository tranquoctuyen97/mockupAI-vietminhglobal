/**
 * Publish Worker — 2-stage pipeline: Shopify → Printify
 *
 * Retry: 3 attempts with exponential backoff (1s, 2s, 4s)
 * SSE: real-time progress events
 * Idempotency: sha256(draftId + tenantId)
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto/envelope";
import { ShopifyClient } from "@/lib/shopify/client";
import { publishToShopify, type ShopifyMockupImage } from "./shopify";
import { publishToPrintify } from "./printify";
import { ensureVariantCostCache, buildVariantPayload } from "@/lib/printify/variant-catalog";
import { getClientForStore } from "@/lib/printify/account";
import { sseChannels } from "@/lib/sse/channel";
import { getStorage } from "@/lib/storage/local-disk";
import { isEnabled } from "@/lib/feature-flags";
import { resolveEffectivePlacementData } from "@/lib/mockup/plan";
import { DEFAULT_PLACEMENT, type PlacementData } from "@/lib/placement/types";
import {
  createOrUpdatePrintifyProduct,
  ensurePrintifyImage,
} from "@/lib/printify/product";
import { PrintifyNotFoundError } from "@/lib/printify/client";

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 2000;

export function generateIdempotencyKey(draftId: string, tenantId: string): string {
  return createHash("sha256").update(`${draftId}|${tenantId}`).digest("hex");
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

  const emitEvent = (type: string, data: any) => {
    sseChannels.emit(publishChannelId, { type, data });
    sseChannels.emit(draftChannelId, { type, data });
  };

  try {
    // Load listing with all relations
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { variants: true, publishJobs: true },
    });
    if (!listing) throw new Error("Listing not found");

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
      emitEvent("publish.failed", { error: "Store đã bị xóa. Vui lòng chọn lại store và thử publish lại." });
      return;
    }

    // Load credentials
    const creds = await prisma.storeCredentials.findUnique({
      where: { storeId: store.id },
    });
    if (!creds || !creds.shopifyTokenEncrypted) throw new Error("Store credentials not found or Shopify not connected");

    let shopifyAccessToken: string;
    try {
      shopifyAccessToken = decrypt(creds.shopifyTokenEncrypted);
    } catch {
      throw new Error(
        "Shopify token hết hạn hoặc bị lỗi mã hóa. Vui lòng kết nối lại Shopify ở Store Settings → Shopify tab."
      );
    }

    // Load draft for mockup paths
    const draft = await prisma.wizardDraft.findUnique({
      where: { id: draftId },
      include: { mockupJobs: true, design: true, store: { include: { template: true, colors: true } } },
    });
    if (!draft) throw new Error("Draft not found");

    const storage = getStorage();
    const listingColorNames = listing.variants.map((v) => v.colorName);
    const includedImages = await prisma.mockupImage.findMany({
      where: {
        mockupJob: { draftId },
        included: true,
        compositeUrl: { not: null }
      }
    });
    // Check dry-run feature flag
    const isDryRun = await isEnabled("publish_dry_run");
    const requireRealPrintifyMockups = await isEnabled("printify_real_mockups");
    const { mockupImages, mockupPaths, missingColorNames } = resolveShopifyMockupMedia({
      images: includedImages,
      storage,
      colorNames: listingColorNames,
      requireRealPrintifyMockups,
    });

    if (requireRealPrintifyMockups && missingColorNames.length > 0) {
      throw new Error(
        `Thiếu mockup Printify thật cho màu: ${missingColorNames.join(", ")}. Vui lòng tạo lại mockup trước khi publish.`,
      );
    }

    // ─── Stage 1: Shopify ───────────────────────────────

    const shopifyJob = listing.publishJobs.find((j) => j.stage === "SHOPIFY");
    if (!shopifyJob) throw new Error("Shopify publish job not found");

    emitEvent("publish.shopify.start", { stage: "SHOPIFY" });

    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: { status: "RUNNING" },
    });

    let shopifyResult: { shopifyProductId: string; shopifyVariantIds: string[] } | null = null;

    if (isDryRun) {
      shopifyResult = {
        shopifyProductId: `gid://shopify/Product/dry-run-${Date.now()}`,
        shopifyVariantIds: listing.variants.map((_, i) => `gid://shopify/ProductVariant/dry-${i}`),
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
            productType: draft.store?.template?.blueprintTitle || draft.store?.name || "Apparel",
            colors: listing.variants.map((v) => ({ name: v.colorName, hex: v.colorHex })),
            mockupPaths,
            mockupImages,
            existingProductId: createdProductId, // reuse if created in previous attempt
          });
          createdProductId = result.shopifyProductId; // save for next retry
          return { shopifyProductId: result.shopifyProductId, shopifyVariantIds: result.shopifyVariantIds };
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
      emitEvent("publish.failed", { stage: "SHOPIFY", error: "Shopify publish failed after retries" });
      return;
    }

    // Update listing with Shopify IDs
    await prisma.listing.update({
      where: { id: listingId },
      data: { shopifyProductId: shopifyResult.shopifyProductId },
    });

    for (let i = 0; i < listing.variants.length && i < shopifyResult.shopifyVariantIds.length; i++) {
      await prisma.listingVariant.update({
        where: { id: listing.variants[i].id },
        data: { shopifyVariantId: shopifyResult.shopifyVariantIds[i] },
      });
    }

    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });

    emitEvent("publish.shopify.done", { shopifyProductId: shopifyResult.shopifyProductId });

    // ─── Stage 2: Printify ──────────────────────────────

    // Phase 6.5: Lookup Printify key via workspace-level account
    let printifyApiKey: string | null = null;
    let externalShopId: number | null = null;
    try {
      const { getClientForStore } = await import("@/lib/printify/account");
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
      emitEvent("publish.complete", { status: "PARTIAL_FAILURE", reason: "No Printify shop linked" });
      return;
    }

    await runPrintifyStage(listingId, listing, draft, store, printifyApiKey, externalShopId, storage, isDryRun, publishChannelId, draftChannelId);
  } catch (error) {
    console.error("[PublishWorker] Unexpected error:", error);
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "FAILED" },
    });
    emitEvent("publish.failed", { error: error instanceof Error ? error.message : "Unknown error" });

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

  sseChannels.emit(channelId, {
    type: "publish.printify.start",
    data: { stage: "PRINTIFY" },
  });
  sseChannels.emit(draftId, {
    type: "publish.printify.start",
    data: { stage: "PRINTIFY" },
  });

  await prisma.publishJob.update({
    where: { id: printifyJob.id },
    data: { status: "RUNNING" },
  });

  let printifyResult: { printifyProductId: string } | null = null;

  if (isDryRun) {
    printifyResult = { printifyProductId: `dry-run-${Date.now()}` };
    await sleep(1000);
  } else {
    const designPath = draft.design?.storagePath
      ? storage.resolvePath(draft.design.storagePath)
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
      sseChannels.emit(channelId, {
        type: "publish.complete",
        data: { status: "PARTIAL_FAILURE", reason: "Design file not found" },
      });
      sseChannels.emit(draftId, {
        type: "publish.complete",
        data: { status: "PARTIAL_FAILURE", reason: "Design file not found" },
      });
      return;
    }

    // Find included mockup images
    const includedImages = await prisma.mockupImage.findMany({
      where: {
        mockupJob: { draftId: draftId },
        included: true
      }
    });
    const selectedMockupIds = includedImages.map((img: any) => img.printifyMockupId);
    const variantIds = resolvePublishVariantIds(listing, draft);
    const template = draft.store?.template;
    const placementData = resolveEffectivePlacementData(
      draft.placementOverride,
      template?.defaultPlacement,
    ) ?? defaultPlacementData();

    // -- Calculate Variants Payload (Price & SKU) --
    let printifyVariantsPayload: any[] | undefined = undefined;
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
        const selectedSizes = draft.enabledSizes || [];

        // 4. Build payload — if no sizes selected, use all available sizes from cache
        const effectiveSizes = selectedSizes.length > 0
          ? selectedSizes
          : [...new Set(cachedVariants.filter(v => v.isAvailable).map(v => v.size))];

        printifyVariantsPayload = buildVariantPayload(
          cachedVariants,
          selectedColorNames,
          effectiveSizes,
          baseRetailPriceUSD
        );
      }
    } catch (err) {
      console.warn("[PublishWorker] Failed to build dynamic variant payload, falling back to dummy prices:", err);
    }

    if (draft.printifyDraftProductId) {
      printifyResult = await retryWithBackoff(
        async () => publishExistingPrintifyDraftProduct({
          storeId: store.id,
          draftId: draft.id,
          productId: draft.printifyDraftProductId!,
          designStoragePath: draft.design!.storagePath,
          cachedImageId: draft.printifyImageId,
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
    sseChannels.emit(channelId, {
      type: "publish.complete",
      data: { status: "ACTIVE", printifyProductId: printifyResult.printifyProductId },
    });
    sseChannels.emit(draftId, {
      type: "publish.complete",
      data: { status: "ACTIVE", printifyProductId: printifyResult.printifyProductId },
    });
  } else {
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "PARTIAL_FAILURE" },
    });
    sseChannels.emit(channelId, {
      type: "publish.complete",
      data: { status: "PARTIAL_FAILURE", reason: "Printify publish failed after retries", listingId },
    });
    sseChannels.emit(draftId, {
      type: "publish.complete",
      data: { status: "PARTIAL_FAILURE", reason: "Printify publish failed after retries", listingId },
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
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
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
  draft: { store?: { template?: { enabledVariantIds?: number[] | null } | null } | null },
): number[] {
  const listingVariantIds = (listing.variants ?? [])
    .map((variant) => Number(variant.printifyVariantId))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (listingVariantIds.length > 0) return Array.from(new Set(listingVariantIds));

  const templateVariantIds = draft.store?.template?.enabledVariantIds ?? [];
  return templateVariantIds.length > 0 ? templateVariantIds : [1];
}

async function publishExistingPrintifyDraftProduct(input: {
  storeId: string;
  draftId: string;
  productId: string;
  designStoragePath: string;
  cachedImageId?: string | null;
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  variantIds: number[];
  variants?: Array<{ id: number; price: number; is_enabled: boolean; sku?: string; is_default?: boolean }>;
  placementData: PlacementData;
}): Promise<{ printifyProductId: string }> {
  const { getClientForStore } = await import("@/lib/printify/account");
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

  console.log(`[PublishWorker] PRINTIFY sending PUT update — product: ${input.productId}, shopId: ${externalShopId}, imageId: ${imageId}, variants: ${input.variants?.length ?? "fallback"}, blueprint: ${input.blueprintId}/${input.printProviderId}`);

  try {
    const product = await createOrUpdatePrintifyProduct({
      ...commonPayload,
      productId: input.productId,
    });
    return { printifyProductId: product.productId };
  } catch (err) {
    if (err instanceof PrintifyNotFoundError) {
      // Draft product was deleted from Printify — clear stale ref and CREATE new
      console.warn(`[PublishWorker] Draft product ${input.productId} not found (404). Clearing stale ref and creating new product.`);
      await prisma.wizardDraft.update({
        where: { id: input.draftId },
        data: { printifyDraftProductId: null },
      });

      const product = await createOrUpdatePrintifyProduct({
        ...commonPayload,
        productId: null, // Force CREATE
      });
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
  const mockupImages: ShopifyMockupImage[] = [];

  for (const image of input.images) {
    const colorKey = normalizeColorName(image.colorName);
    if (!selectedColorKeys.has(colorKey)) continue;

    const source = image.compositeUrl ?? image.sourceUrl;
    if (!source) continue;

    if (isRemoteUrl(source)) {
      if (isDisallowedRemoteMockupUrl(source)) continue;
      mockupImages.push({
        kind: "remote",
        url: source,
        colorName: image.colorName,
      });
      coveredColorKeys.add(colorKey);
      continue;
    }

    if (input.requireRealPrintifyMockups) continue;
    if (isSyntheticMockupSource(source)) continue;

    const path = input.storage.resolvePath(source);
    mockupImages.push({
      kind: "local",
      path,
      colorName: image.colorName,
    });
    coveredColorKeys.add(colorKey);
  }

  return {
    mockupImages,
    mockupPaths: mockupImages
      .filter((image): image is Extract<ShopifyMockupImage, { kind: "local" }> => image.kind === "local")
      .map((image) => image.path),
    missingColorNames: selectedColors
      .filter((color) => !coveredColorKeys.has(color.key))
      .map((color) => color.name),
  };
}

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isSyntheticMockupSource(value: string): boolean {
  return value.startsWith("mockup://");
}

function isDisallowedRemoteMockupUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "via.placeholder.com";
  } catch {
    return true;
  }
}

function normalizeColorName(value: string): string {
  return value.trim().toLowerCase();
}
