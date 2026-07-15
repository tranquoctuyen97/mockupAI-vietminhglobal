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
import { classifyColorHex, resolveColorGroups } from "@/lib/designs/color-classifier";
import { getLatestJobByDraftDesignId } from "@/lib/mockup/multi-design";
import { normalizeCompositeRegionPx, scaleCompositeRegionToImage } from "@/lib/mockup/custom-library";
import {
  compositeRegionToPrintifyPlacement,
  computeCustomPrintAreaPx,
  computeListingReadyRegion,
  isBadCompositeRegion,
} from "@/lib/mockup/placement-region";
import { resolveEffectivePlacementData, resolvePlacementViews } from "@/lib/mockup/plan";
import {
  isAllowedRemoteMockupUrl,
  isRemoteUrl,
  isSyntheticMockupSource,
} from "@/lib/mockup/real-printify-media";
import { parseMockupSourceUrl } from "@/lib/mockup/source-url";
import { buildListingReadyPlacementData } from "@/lib/placement/auto-place";
import { resolvePlacement } from "@/lib/placement/resolver";
import { createEmptyPlacementData, setPlacementForView } from "@/lib/placement/views";
import {
  DEFAULT_PLACEMENT,
  DEFAULT_PRINT_AREA,
  type PlacementData,
  type PrintArea,
  type ViewKey,
} from "@/lib/placement/types";
import {
  mergeDraftAndTemplatePriceMaps,
  resolveBaseTemplatePrice,
} from "@/lib/pricing/template-pricing";
import { getClientForStore } from "@/lib/printify/account";
import { PrintifyApiError, PrintifyNotFoundError } from "@/lib/printify/client";
import { extractEnabledPrintifyVariantMatrix } from "@/lib/printify/product-matrix";
import { createOrUpdatePrintifyProduct, ensurePrintifyImage } from "@/lib/printify/product";
import {
  buildVariantPayload,
  computeVariantMatrixPerColor,
  buildShopifyVariantInputs,
  computeEnabledVariantSelection,
  ensureVariantCostCache,
  type ShopifyVariantPlanItem,
} from "@/lib/printify/variant-catalog";
import { ShopifyAuthError, ShopifyClient } from "@/lib/shopify/client";
import { sseChannels } from "@/lib/sse/channel";
import { getStorage } from "@/lib/storage/local-disk";
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";
import { publishToPrintify } from "./printify";
import { waitForShopifyProductSync, type ShopifySyncMatch } from "./shopify-sync";
import {
  attachProductToManualCollections,
  productHasWebpMedia,
  publishToAllChannels,
  publishToShopify,
  reorderProductOptionsByPrimaryColor,
  reorderPrimaryMedia,
  updateProductCategory,
  uploadProductImages,
  type ShopifyMockupImage,
  type ShopifyVariantInput,
} from "./shopify";
import { resolvePublishStrategy } from "./strategy";

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 2000;
const INTERNAL_TAG_DENYLIST = new Set(["mockupai", "draft-preview"]);
const CUSTOM_MOCKUP_REFERENCE_PRINT_AREA = { widthMm: 340, heightMm: 420 };

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

type PrintAreaByView = Partial<Record<ViewKey, PrintArea>>;

function toPlacementPosition(view: ViewKey): string {
  return view.toUpperCase();
}

async function resolvePrintAreaByView(input: {
  blueprintId: number;
  views: ViewKey[];
}): Promise<PrintAreaByView> {
  const uniqueViews = Array.from(new Set(input.views));
  if (!input.blueprintId || uniqueViews.length === 0) return {};

  const rows = await prisma.blueprintPrintArea.findMany({
    where: {
      printifyBlueprintId: input.blueprintId,
      position: { in: uniqueViews.map(toPlacementPosition) as any },
    },
  });

  const byView: PrintAreaByView = {};
  for (const row of rows) {
    byView[row.position.toLowerCase() as ViewKey] = {
      widthMm: row.widthMm,
      heightMm: row.heightMm,
      safeMarginMm: row.safeMarginMm,
    };
  }

  const missingViews = uniqueViews.filter((view) => !byView[view]);
  if (missingViews.length > 0) {
    console.warn("[PublishWorker] Printify publish using default print area fallback:", {
      blueprintId: input.blueprintId,
      missingViews,
    });
  }

  return byView;
}

function printAreaForView(printAreaByView: PrintAreaByView, view: ViewKey): PrintArea {
  return printAreaByView[view] ?? DEFAULT_PRINT_AREA;
}

function toPlacementView(view: string | null | undefined): ViewKey | null {
  if (view === "front" || view === "back" || view === "sleeve_left" || view === "sleeve_right") {
    return view;
  }
  return null;
}

async function resolveCustomMockupPlacementData(input: {
  draftId: string;
  colorIds: string[];
  design: { width: number; height: number } | null | undefined;
  printAreaByView: PrintAreaByView;
}): Promise<PlacementData | null> {
  if (!input.design || input.colorIds.length === 0) return null;

  const picks = await prisma.wizardDraftMockupLibraryPick.findMany({
    where: {
      draftId: input.draftId,
      colorId: { in: input.colorIds },
    },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      templateMockupItem: {
        include: { mockup: true },
      },
    },
  });

  for (const pick of picks) {
    const mockup = pick.templateMockupItem.mockup;
    const view = toPlacementView(mockup.view);
    if (!view) continue;

    const printAreaPx = computeCustomPrintAreaPx(
      CUSTOM_MOCKUP_REFERENCE_PRINT_AREA,
      mockup.width,
      mockup.height,
    );
    const normalizedRegion = normalizeCompositeRegionPx(
      pick.compositeRegionPx ?? mockup.compositeRegionPx,
    );
    const runtimeRegion = normalizedRegion
      ? scaleCompositeRegionToImage(normalizedRegion, mockup.width, mockup.height)
      : null;

    const region =
      runtimeRegion && !isBadCompositeRegion(runtimeRegion, printAreaPx)
        ? runtimeRegion
        : {
            ...computeListingReadyRegion(printAreaPx, input.design.width, input.design.height),
            rotationDeg: runtimeRegion?.rotationDeg ?? 0,
          };

    const placement = compositeRegionToPrintifyPlacement(
      region,
      printAreaPx,
      printAreaForView(input.printAreaByView, view),
    );

    return setPlacementForView(createEmptyPlacementData(), view, placement);
  }

  return null;
}

type PrintifyTagsClient = {
  getProduct: (shopId: number, productId: string) => Promise<{ tags?: unknown }>;
};

export function normalizeExternalTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of tags) {
    const tag = String(raw ?? "").trim();
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (INTERNAL_TAG_DENYLIST.has(key)) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(tag);
  }

  return out;
}

export async function resolvePrintifyTagsForShopify(input: {
  client: PrintifyTagsClient;
  externalShopId: number | null | undefined;
  productId: string | null | undefined;
  storeId: string;
  listingId: string;
}): Promise<string[]> {
  if (!input.externalShopId || !input.productId) return [];

  try {
    const product = await input.client.getProduct(input.externalShopId, input.productId);
    return normalizeExternalTags(product.tags);
  } catch (err) {
    console.warn("[PublishWorker] Failed to fetch Printify tags, falling back to listing tags:", {
      productId: input.productId,
      storeId: input.storeId,
      listingId: input.listingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export function selectTagsForShopify(
  printifyTags: string[],
  listingTags: string[] | null | undefined,
): string[] {
  const merged = [...printifyTags, ...normalizeExternalTags(listingTags)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of merged) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

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
      include: { variants: true, publishJobs: true, wizardDraftDesignPair: true },
    });
    if (!listing) throw new Error("Listing not found");
    draftDesignIdForEvents = listing.wizardDraftDesignId ?? null;

    // Load store
    const store = await prisma.store.findUnique({
      where: { id: listing.storeId! },
      include: { printifyShop: true },
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
      ? (draft.draftDesigns.find((entry) => entry.id === listing.wizardDraftDesignId) ?? null)
      : null;
    const pair = listing.wizardDraftDesignPair;

    let includedImages: any[] = [];
    if (pair) {
      const lightJobKey = pair.lightDraftDesignId;
      const darkJobKey = pair.darkDraftDesignId;
      const lightJob = latestJobsByDesign.get(lightJobKey);
      const darkJob = latestJobsByDesign.get(darkJobKey);

      const lightDraftDesign = draft.draftDesigns.find((entry) => entry.id === lightJobKey);
      const darkDraftDesign = draft.draftDesigns.find((entry) => entry.id === darkJobKey);

      if (!lightJob || lightJob.status?.toLowerCase() !== "completed") {
        throw new Error(
          `Mockups chưa hoàn tất cho thiết kế sáng: ${lightDraftDesign?.design?.name ?? "Sáng"}`,
        );
      }
      if (!darkJob || darkJob.status?.toLowerCase() !== "completed") {
        throw new Error(
          `Mockups chưa hoàn tất cho thiết kế tối: ${darkDraftDesign?.design?.name ?? "Tối"}`,
        );
      }

      const lightIncluded = (lightJob.images ?? []).filter(
        (image) => image.included && Boolean(image.compositeUrl),
      );
      const darkIncluded = (darkJob.images ?? []).filter(
        (image) => image.included && Boolean(image.compositeUrl),
      );
      includedImages = [...lightIncluded, ...darkIncluded];
    } else {
      const designJobKey = listing.wizardDraftDesignId ?? listing.designId ?? draft.designId ?? null;
      const selectedMockupJob = designJobKey ? (latestJobsByDesign.get(designJobKey) ?? null) : null;

      if (!selectedMockupJob || selectedMockupJob.status?.toLowerCase() !== "completed") {
        throw new Error(
          `Mockups chưa hoàn tất cho design ${draftDesign?.design?.name ?? draft.design?.name ?? listing.title}`,
        );
      }

      includedImages = (selectedMockupJob.images ?? []).filter(
        (image) => image.included && Boolean(image.compositeUrl),
      );
    }
    const isDryRun = isPublishDryRun();
    const requireRealPrintifyMockups = PRODUCT_DEFAULTS.mockup.requireRealPrintifyMockups;
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

    const publishStrategy = resolvePublishStrategy(store);
    if (publishStrategy === "PRINTIFY_SHOPIFY_CHANNEL") {
      await runPrintifyShopifyChannelPublish({
        listingId,
        listing,
        draft,
        store,
        mockupImages,
        listingColorNames,
        shopifyAccessToken,
        isDryRun,
        emitEvent,
      });
      return;
    }

    // ─── Stage 1: Shopify ───────────────────────────────

    const shopifyJob = listing.publishJobs.find((j) => j.stage === "SHOPIFY");
    if (!shopifyJob) throw new Error("Shopify publish job not found");

    emitEvent("publish.shopify.start", { stage: "SHOPIFY" });

    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: { status: "RUNNING" },
    });

    const existingPrintifyDraftProductId =
      draftDesign?.printifyDraftProductId ?? draft.printifyDraftProductId ?? null;
    let printifyClientContext: Awaited<ReturnType<typeof getClientForStore>> | null = null;
    let shopifyResult: { shopifyProductId: string; shopifyVariantIds: string[] } | null = null;

    if (isDryRun) {
      shopifyResult = {
        shopifyProductId: `gid://shopify/Product/dry-run-${Date.now()}`,
        shopifyVariantIds: listing.variants.map((_, i) => `gid://shopify/ProductVariant/dry-${i}`),
      };
      await sleep(1000);
    } else {
      // Read the Printify catalog/cache BEFORE productSet so the Shopify payload
      // carries the full Color + Size + SKU + price matrix. Falls back to a
      // colors-only payload when the catalog can't be resolved.
      let variantPlan: ShopifyVariantPlanItem[] | null = null;
      try {
        variantPlan = await resolveShopifyVariantPlan(draft, store.id);
      } catch (err) {
        console.warn(
          "[PublishWorker] Failed to resolve Shopify variant plan, falling back to colors-only:",
          err,
        );
      }

      let colorsForShopify = listing.variants.map((v) => ({ name: v.colorName, hex: v.colorHex }));
      let variantsForShopify: ShopifyVariantInput[] | undefined;
      if (variantPlan && variantPlan.length > 0) {
        validateVariantSkus(variantPlan);
        variantsForShopify = variantPlan.map((v) => ({
          colorName: v.colorName,
          size: v.size,
          sku: v.sku,
          priceUsd: v.priceUsd,
        }));
        // Derive Color option values from the plan (unique, plan order) so they
        // exactly match the variant option values sent to productSet.
        const seenColor = new Set<string>();
        const planColors: Array<{ name: string; hex: string }> = [];
        for (const v of variantPlan) {
          const key = v.colorName.trim().toLowerCase();
          if (seenColor.has(key)) continue;
          seenColor.add(key);
          planColors.push({ name: v.colorName, hex: v.colorHex ?? "" });
        }
        if (planColors.length > 0) colorsForShopify = planColors;
      }

      let printifyTagsForShopify: string[] = [];
      if (existingPrintifyDraftProductId) {
        try {
          printifyClientContext = await getClientForStore(store.id);
          printifyTagsForShopify = await resolvePrintifyTagsForShopify({
            client: printifyClientContext.client,
            externalShopId: printifyClientContext.externalShopId,
            productId: existingPrintifyDraftProductId,
            storeId: store.id,
            listingId,
          });
        } catch (err) {
          console.warn("[PublishWorker] Failed to resolve Printify account for tag lookup:", {
            productId: existingPrintifyDraftProductId,
            storeId: store.id,
            listingId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const tagsForShopify = selectTagsForShopify(printifyTagsForShopify, listing.tags);

      // Pick a random primary color (rotates thumbnails) and order Shopify color
      // options/variants/media so the storefront default matches the thumbnail.
      const primaryColorName = pickPrimaryColorName(mockupImages);
      colorsForShopify = orderColorsByPrimary(colorsForShopify, primaryColorName);
      variantsForShopify = orderVariantsByPrimary(variantsForShopify, primaryColorName);
      const orderedMockupImages = orderMockupImagesByPrimary(
        mockupImages,
        colorsForShopify.map((c) => c.name),
        primaryColorName,
      );

      // Track product ID across retries to prevent duplicate creation
      let createdProductId: string | null = listing.shopifyProductId;

      shopifyResult = await retryWithBackoff(
        async () => {
          const shopifyClient = new ShopifyClient(store.shopifyDomain!, shopifyAccessToken);
          const result = await publishToShopify(shopifyClient, store.shopifyDomain!, {
            title: listing.title,
            descriptionHtml: listing.descriptionHtml,
            tags: tagsForShopify,
            priceUsd: listing.priceUsd,
            productType: draft.template?.blueprintTitle || draft.store?.name || "Apparel",
            vendor: "Printify",
            colors: colorsForShopify,
            variants: variantsForShopify,
            primaryColorName,
            mockupPaths,
            mockupImages: orderedMockupImages,
            organizationCollections: listing.organizationCollections ?? [],
            existingProductId: createdProductId, // reuse if created in previous attempt
            onProductCreated: async (productId, variantNodes) => {
              createdProductId = productId;
              await prisma.listing.update({
                where: { id: listingId },
                data: { shopifyProductId: productId },
              });
              for (let i = 0; i < listing.variants.length && i < variantNodes.length; i++) {
                await prisma.listingVariant.update({
                  where: { id: listing.variants[i].id },
                  data: { shopifyVariantId: variantNodes[i].id },
                });
              }
            },
          });
          createdProductId = result.shopifyProductId; // save for next retry
          return {
            shopifyProductId: result.shopifyProductId,
            shopifyVariantIds: result.shopifyVariantIds,
          };
        },
        shopifyJob.id,
        "SHOPIFY",
        async () => {
          await prisma.store.update({
            where: { id: store.id },
            data: { status: "TOKEN_EXPIRED", lastHealthCheck: new Date() },
          });
        },
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
      const result = printifyClientContext ?? (await getClientForStore(store.id));
      printifyClientContext = result;
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
    const payload = {
      ...data,
      listingId,
      draftId,
      draftDesignId: listing.wizardDraftDesignId ?? null,
    };
    sseChannels.emit(channelId, { type, data: payload });
    sseChannels.emit(draftId, { type, data: payload });
  };

  const pair = listing.wizardDraftDesignPair ?? (listing.wizardDraftDesignPairId
    ? await prisma.wizardDraftDesignPair.findUnique({ where: { id: listing.wizardDraftDesignPairId } })
    : null);

  const draftDesign = listing.wizardDraftDesignId
    ? (draft.draftDesigns?.find((entry: any) => entry.id === listing.wizardDraftDesignId) ?? null)
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
    let includedImagesForPrintify: any[] = [];
    if (pair) {
      const lightJobKey = pair.lightDraftDesignId;
      const darkJobKey = pair.darkDraftDesignId;
      const lightJob = latestJobsByDesign.get(lightJobKey);
      const darkJob = latestJobsByDesign.get(darkJobKey);

      if (!lightJob || lightJob.status?.toLowerCase() !== "completed" || !darkJob || darkJob.status?.toLowerCase() !== "completed") {
        const lightDraftDesign = draft.draftDesigns?.find((entry: any) => entry.id === lightJobKey);
        const darkDraftDesign = draft.draftDesigns?.find((entry: any) => entry.id === darkJobKey);
        await prisma.publishJob.update({
          where: { id: printifyJob.id },
          data: { status: "FAILED", lastError: "Mockups not ready for light or dark design", attempts: { increment: 1 } },
        });
        await prisma.listing.update({
          where: { id: listingId },
          data: { status: "PARTIAL_FAILURE" },
        });
        emitEvent("publish.complete", {
          status: "PARTIAL_FAILURE",
          reason: `Mockups chưa hoàn tất cho cặp design: ${lightDraftDesign?.design?.name ?? "Sáng"} / ${darkDraftDesign?.design?.name ?? "Tối"}`,
        });
        return;
      }

      includedImagesForPrintify = [
        ...(lightJob.images ?? []).filter((img: any) => img.included),
        ...(darkJob.images ?? []).filter((img: any) => img.included),
      ];
    } else {
      const selectedMockupJob = designJobKey ? (latestJobsByDesign.get(designJobKey) ?? null) : null;
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
      includedImagesForPrintify = (selectedMockupJob.images ?? []).filter(
        (img: any) => img.included,
      );
    }

    const designPath = !pair && targetDesign?.storagePath
      ? storage.resolvePath(targetDesign.storagePath)
      : null;

    if (!pair && !designPath) {
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

    const selectedMockupIds = includedImagesForPrintify
      .map((img: any) => img.printifyMockupId)
      .filter((id: string) => id && !id.startsWith("custom:") && !id.startsWith("synthetic:"));
    const draftProductId =
      draftDesign?.printifyDraftProductId ?? draft.printifyDraftProductId ?? null;
    const draftImageId = draftDesign?.printifyImageId ?? draft.printifyImageId ?? null;
    let template = draft.template;
    if (!template && draft.storeId) {
      template = await prisma.storeMockupTemplate.findFirst({
        where: { storeId: draft.storeId, isDefault: true },
      });
    }

    const variantIds = resolvePublishVariantIds(listing, draft, template);

    // Resolve imageGroups for design pairs
    let imageGroups: Array<{ imageId: string; variantIds: number[] }> | undefined;
    if (pair) {
      const lightDraftDesign = draft.draftDesigns.find((d: any) => d.id === pair.lightDraftDesignId);
      const darkDraftDesign = draft.draftDesigns.find((d: any) => d.id === pair.darkDraftDesignId);

      if (!lightDraftDesign?.design || !darkDraftDesign?.design) {
        await prisma.publishJob.update({
          where: { id: printifyJob.id },
          data: { status: "FAILED", lastError: "Pair design files not found in draft", attempts: { increment: 1 } },
        });
        await prisma.listing.update({
          where: { id: listingId },
          data: { status: "PARTIAL_FAILURE" },
        });
        emitEvent("publish.complete", { status: "PARTIAL_FAILURE", reason: "Pair design files not found in draft" });
        return;
      }

      const { client: printifyClient } = await getClientForStore(store.id);

      const lightImageId = await ensurePrintifyImage({
        client: printifyClient,
        designStoragePath: lightDraftDesign.design.storagePath,
        cachedImageId: lightDraftDesign.printifyImageId,
      });
      const darkImageId = await ensurePrintifyImage({
        client: printifyClient,
        designStoragePath: darkDraftDesign.design.storagePath,
        cachedImageId: darkDraftDesign.printifyImageId,
      });

      // Save back uploaded IDs
      await prisma.wizardDraftDesign.update({
        where: { id: lightDraftDesign.id },
        data: { printifyImageId: lightImageId },
      });
      await prisma.wizardDraftDesign.update({
        where: { id: darkDraftDesign.id },
        data: { printifyImageId: darkImageId },
      });

      // Map variant IDs to light vs dark color groups
      const blueprintId = template?.printifyBlueprintId ?? 0;
      const printProviderId = template?.printifyPrintProviderId ?? 0;
      const cachedVariants = await ensureVariantCostCache({
        client: printifyClient,
        shopId: externalShopId!,
        blueprintId,
        printProviderId,
      });

      const colorNameToId = new Map<string, string>();
      for (const c of store.colors ?? []) {
        colorNameToId.set(c.name.trim().toLowerCase(), c.id);
      }

      const colorGroups = resolveColorGroups(store.colors ?? []);

      const lightVariantIds: number[] = [];
      const darkVariantIds: number[] = [];

      for (const cv of cachedVariants) {
        const cId = colorNameToId.get(cv.colorName.trim().toLowerCase());
        const grp = (() => {
          if (cId) return colorGroups.get(cId);
          const hex = cv.colorHex ?? "";
          if (/^#[0-9a-fA-F]{6}$/.test(hex.trim())) {
            try {
              return classifyColorHex(hex);
            } catch {}
          }
          return "light";
        })();

        if (grp === "dark") {
          darkVariantIds.push(cv.variantId);
        } else {
          lightVariantIds.push(cv.variantId);
        }
      }

      imageGroups = [
        { imageId: lightImageId, variantIds: lightVariantIds },
        { imageId: darkImageId, variantIds: darkVariantIds },
      ];
    }

    const blueprintIdForPlacement = template?.printifyBlueprintId ?? 0;
    const effectivePlacementData = resolveEffectivePlacementData(
      draft.placementOverride,
      template?.defaultPlacement,
    );
    const printAreaByView = await resolvePrintAreaByView({
      blueprintId: blueprintIdForPlacement,
      views: effectivePlacementData ? resolvePlacementViews(effectivePlacementData) : ["front"],
    });
    const customMockupPlacementData = !effectivePlacementData
      ? await resolveCustomMockupPlacementData({
          draftId: draft.id,
          colorIds: draft.enabledColorIds ?? [],
          design: targetDesign
            ? { width: targetDesign.width, height: targetDesign.height }
            : null,
          printAreaByView,
        })
      : null;

    // Placement fallback chain (Guard 3): draft override → template default →
    // custom mockup region → listing-ready ratio default → legacy.
    const placementData =
      effectivePlacementData ??
      customMockupPlacementData ??
      (targetDesign
        ? buildListingReadyPlacementData({
          design: { widthPx: targetDesign.width, heightPx: targetDesign.height },
          printArea: printAreaForView(printAreaByView, "front"),
          template: {
            productType: draft.productType,
            blueprintTitle: template?.blueprintTitle,
            blueprintBrand: template?.blueprintBrand,
          },
        })
        : defaultPlacementData());

    // -- Calculate Variants Payload (Price & SKU) --
    let printifyVariantsPayload: any[] | undefined;
    try {
      const blueprintId = template?.printifyBlueprintId ?? 0;
      const printProviderId = template?.printifyPrintProviderId ?? 0;
      const productType = template?.blueprintTitle ?? draft.productType;

      if (blueprintId && printProviderId && productType && externalShopId) {
        // 1. Resolve template pricing defaults
        const baseRetailPriceUSD = resolveBaseTemplatePrice({
          templateBasePriceUsd: template?.basePriceUsd,
          storeDefaultPriceUsd: (draft.store as any)?.defaultPriceUsd,
        });

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

        // 4. Per-color sizes or global fallback (shared with Shopify variant plan)
        const sizesByColor = draft.enabledSizesByColor as Record<string, string[]> | null;
        const { effectiveVariantIds, effectiveSizesForPayload } = computeEnabledVariantSelection(
          cachedVariants,
          selectedColorNames,
          sizesByColor,
          draft.enabledSizes ?? [],
        );

        // 5. Build payload with computed variant IDs determining enabled state
        const priceBySizeOverride = mergeDraftAndTemplatePriceMaps({
          draftPriceBySizeOverride: draft.priceBySizeOverride,
          templatePriceBySizeDefault: template?.priceBySizeDefault,
        });

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

    try {
      if (draftProductId) {
        printifyResult = await retryWithBackoff(
          async () =>
            publishExistingPrintifyDraftProduct({
              storeId: store.id,
              draftId: draft.id,
              draftDesignId: draftDesign?.id ?? null,
              productId: draftProductId,
              designStoragePath: designPath ?? "",
              cachedImageId: draftImageId,
              title: listing.title,
              description: listing.descriptionHtml,
              blueprintId: template?.printifyBlueprintId ?? 0,
              printProviderId: template?.printifyPrintProviderId ?? 0,
              variantIds,
              variants: printifyVariantsPayload,
              placementData,
              printAreaByView,
              imageGroups,
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
              designPath: designPath ?? undefined,
              placementMm: resolvePlacement(placementData, "front") ?? undefined,
              printAreaMm: printAreaForView(printAreaByView, "front"),
              imageGroups,
            });
          },
          printifyJob.id,
          "PRINTIFY",
        );
      }
    } catch (err) {
      console.error("[PublishWorker] Printify stage failed fast:", err);
      await prisma.publishJob.update({
        where: { id: printifyJob.id },
        data: { status: "FAILED", lastError: err instanceof Error ? err.message : "Fail fast error", completedAt: new Date() },
      });
      printifyResult = null;
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

    emitEvent("publish.complete", {
      status: "ACTIVE",
      printifyProductId: printifyResult.printifyProductId,
    });
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

async function runPrintifyShopifyChannelPublish(input: {
  listingId: string;
  listing: any;
  draft: any;
  store: any;
  mockupImages: ShopifyMockupImage[];
  listingColorNames: string[];
  shopifyAccessToken: string;
  isDryRun: boolean;
  emitEvent: (type: string, data?: Record<string, unknown>) => void;
}): Promise<void> {
  const { listingId, listing, draft, store, mockupImages, listingColorNames, shopifyAccessToken, isDryRun, emitEvent } = input;
  const printifyJob = listing.publishJobs.find((job: any) => job.stage === "PRINTIFY");
  const shopifyJob = listing.publishJobs.find((job: any) => job.stage === "SHOPIFY");

  if (!printifyJob) throw new Error("Printify publish job not found");
  if (!shopifyJob) throw new Error("Shopify publish job not found");

  await prisma.publishJob.update({
    where: { id: printifyJob.id },
    data: { status: "RUNNING" },
  });
  await prisma.publishJob.update({
    where: { id: shopifyJob.id },
    data: { status: "PENDING", lastError: "Waiting for Printify Shopify-channel sync" },
  });
  emitEvent("publish.printify.start", { stage: "PRINTIFY" });

  if (isDryRun) {
    await prisma.listing.update({
      where: { id: listingId },
      data: {
        printifyProductId: `dry-run-printify-${Date.now()}`,
        shopifyProductId: `gid://shopify/Product/dry-run-${Date.now()}`,
        status: "ACTIVE",
        publishedAt: new Date(),
      },
    });
    await prisma.publishJob.update({
      where: { id: printifyJob.id },
      data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null },
    });
    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null },
    });
    emitEvent("publish.complete", { status: "ACTIVE" });
    return;
  }

  const startedAtIso = new Date().toISOString();
  const { client: printifyClient, externalShopId } = await getClientForStore(store.id);
  const draftDesign = listing.wizardDraftDesignId
    ? (draft.draftDesigns?.find((entry: any) => entry.id === listing.wizardDraftDesignId) ?? null)
    : null;
  const publishInput = await resolvePrintifyProductPublishInput({
    listing,
    draft,
    draftDesign,
    printifyClient,
    externalShopId,
    productId:
      draftDesign?.printifyDraftProductId ??
      draft.printifyDraftProductId ??
      listing.printifyProductId ??
      null,
  });

  let productIdForAttempt = publishInput.productId;
  let printifyProductResult: { productId: string; images: unknown[] } | null = null;
  try {
    printifyProductResult = await retryWithBackoff(
      async () => {
        try {
          return await createOrUpdatePrintifyProduct({
            client: printifyClient,
            shopId: externalShopId,
            productId: productIdForAttempt,
            blueprintId: publishInput.blueprintId,
            printProviderId: publishInput.printProviderId,
            variantIds: publishInput.variantIds,
            variants: publishInput.variants,
            imageId: publishInput.imageId,
            imageGroups: publishInput.imageGroups,
            placementData: publishInput.placementData,
            printAreaByView: publishInput.printAreaByView,
            title: listing.title,
            description: listing.descriptionHtml,
            tags: normalizeExternalTags(listing.tags),
            salesChannelCollections: normalizeOrganizationCollections(listing.organizationCollections),
          });
        } catch (err) {
          if (isTransientPrintifyCreateError(err) && !productIdForAttempt) {
            let candidate: { id: string } | null = null;
            try {
              candidate = await findRecentPrintifyProductCandidate({
                client: printifyClient,
                shopId: externalShopId,
                title: listing.title,
                blueprintId: publishInput.blueprintId,
                printProviderId: publishInput.printProviderId,
              });
            } catch (candidateErr) {
              console.warn("[PublishWorker] Failed to check recent Printify product after transient create error:", {
                listingId,
                shopId: externalShopId,
                error: candidateErr instanceof Error ? candidateErr.message : String(candidateErr),
              });
            }
            if (candidate) {
              productIdForAttempt = candidate.id;
              return createOrUpdatePrintifyProduct({
                client: printifyClient,
                shopId: externalShopId,
                productId: candidate.id,
                blueprintId: publishInput.blueprintId,
                printProviderId: publishInput.printProviderId,
                variantIds: publishInput.variantIds,
                variants: publishInput.variants,
                imageId: publishInput.imageId,
                imageGroups: publishInput.imageGroups,
                placementData: publishInput.placementData,
                printAreaByView: publishInput.printAreaByView,
                title: listing.title,
                description: listing.descriptionHtml,
                tags: normalizeExternalTags(listing.tags),
                salesChannelCollections: normalizeOrganizationCollections(listing.organizationCollections),
              });
            }
          }
          throw err;
        }
      },
      printifyJob.id,
      "PRINTIFY",
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : "Printify product create/update failed";
    await prisma.publishJob.update({
      where: { id: printifyJob.id },
      data: { status: "FAILED", lastError: error, completedAt: new Date() },
    });
    await prisma.listing.update({ where: { id: listingId }, data: { status: "FAILED" } });
    emitEvent("publish.failed", { stage: "PRINTIFY", error });
    return;
  }

  if (!printifyProductResult) {
    await prisma.listing.update({ where: { id: listingId }, data: { status: "FAILED" } });
    emitEvent("publish.failed", {
      stage: "PRINTIFY",
      error: "Printify product create/update failed",
    });
    return;
  }

  await persistPrintifyProductRefs({
    listingId,
    draftId: draft.id,
    draftDesignId: draftDesign?.id ?? null,
    productId: printifyProductResult.productId,
  });

  let printifyRows: ReturnType<typeof extractEnabledPrintifyVariantMatrix>;
  try {
    const printifyProduct = await printifyClient.getProduct(
      externalShopId,
      printifyProductResult.productId,
    );
    printifyRows = extractEnabledPrintifyVariantMatrix(printifyProduct);
    await printifyClient.publishProduct(externalShopId, printifyProductResult.productId, {
      title: true,
      description: true,
      images: false,
      variants: true,
      tags: true,
      keyFeatures: true,
      shipping_template: true,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Printify publish failed";
    await prisma.publishJob.update({
      where: { id: printifyJob.id },
      data: { status: "FAILED", lastError: error, completedAt: new Date() },
    });
    await prisma.listing.update({ where: { id: listingId }, data: { status: "FAILED" } });
    emitEvent("publish.failed", { stage: "PRINTIFY", error });
    return;
  }

  await prisma.listing.update({
    where: { id: listingId },
    data: { printifyProductId: printifyProductResult.productId },
  });
  await prisma.publishJob.update({
    where: { id: printifyJob.id },
    data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null },
  });
  emitEvent("publish.printify.done", { printifyProductId: printifyProductResult.productId });

  emitEvent("publish.shopify.start", { stage: "SHOPIFY" });
  await prisma.publishJob.update({
    where: { id: shopifyJob.id },
    data: { status: "RUNNING", lastError: null },
  });

  let syncMatch: ShopifySyncMatch;
  try {
    syncMatch = await waitForShopifyProductSync({
      client: new ShopifyClient(store.shopifyDomain!, shopifyAccessToken),
      printifyRows,
      updatedAfterIso: startedAtIso,
      title: listing.title,
      timeoutMs: 120_000,
      intervalMs: 5_000,
    });
  } catch (err) {
    const message = "Printify published but Shopify sync was not confirmed";
    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: {
        status: "FAILED",
        lastError: err instanceof Error ? `${message}: ${err.message}` : message,
        completedAt: new Date(),
      },
    });
    await prisma.listing.update({ where: { id: listingId }, data: { status: "PARTIAL_FAILURE" } });
    emitEvent("publish.complete", { status: "PARTIAL_FAILURE", reason: message });
    return;
  }

  const shopifyClient = new ShopifyClient(store.shopifyDomain!, shopifyAccessToken);
  const primaryColorName = pickPrimaryColorName(mockupImages);

  try {
    const channelResult = await publishToAllChannels(shopifyClient, syncMatch.shopifyProductId);
    if (channelResult.attempted === 0 || channelResult.failed.length > 0) {
      const failures = channelResult.failed
        .map((failure) => `${failure.publicationId}: ${failure.message}`)
        .join("; ");
      throw new Error(
        failures ||
          `No Shopify publications were available for product ${syncMatch.shopifyProductId}`,
      );
    }
  } catch (err) {
    const message =
      err instanceof Error
        ? `Shopify sales-channel publish failed: ${err.message}`
        : "Shopify sales-channel publish failed";
    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: {
        status: "FAILED",
        lastError: message,
        completedAt: new Date(),
      },
    });
    await prisma.listing.update({ where: { id: listingId }, data: { status: "PARTIAL_FAILURE" } });
    emitEvent("publish.complete", { status: "PARTIAL_FAILURE", reason: message });
    return;
  }

  try {
    await updateProductCategory({
      client: shopifyClient,
      productId: syncMatch.shopifyProductId,
      productType: draft.template?.blueprintTitle ?? draft.productType,
    });
  } catch (err) {
    console.warn("[PublishWorker] Shopify category post-sync failed (non-fatal):", {
      listingId,
      shopifyProductId: syncMatch.shopifyProductId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await attachProductToManualCollections({
      client: shopifyClient,
      productId: syncMatch.shopifyProductId,
      collections: listing.organizationCollections ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Shopify collection attach failed";
    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: {
        status: "FAILED",
        lastError: message,
        completedAt: new Date(),
      },
    });
    await prisma.listing.update({ where: { id: listingId }, data: { status: "PARTIAL_FAILURE" } });
    emitEvent("publish.complete", { status: "PARTIAL_FAILURE", reason: message });
    return;
  }

  try {
    await reorderProductOptionsByPrimaryColor({
      client: shopifyClient,
      productId: syncMatch.shopifyProductId,
      primaryColorName,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? `Shopify color option reorder failed: ${err.message}`
        : "Shopify color option reorder failed";
    await prisma.publishJob.update({
      where: { id: shopifyJob.id },
      data: {
        status: "FAILED",
        lastError: message,
        completedAt: new Date(),
      },
    });
    await prisma.listing.update({ where: { id: listingId }, data: { status: "PARTIAL_FAILURE" } });
    emitEvent("publish.complete", { status: "PARTIAL_FAILURE", reason: message });
    return;
  }

  try {
    const alreadyHasWebp = await productHasWebpMedia(shopifyClient, syncMatch.shopifyProductId);
    if (!alreadyHasWebp && mockupImages.length > 0) {
      const orderedMockupImages = orderMockupImagesByPrimary(
        mockupImages,
        listingColorNames,
        primaryColorName,
      );
      const uploadedMedia = await uploadProductImages(
        shopifyClient,
        syncMatch.shopifyProductId,
        orderedMockupImages,
      );
      if (uploadedMedia.length > 0 && primaryColorName) {
        const primaryMedia = uploadedMedia.find(
          (media) => media.colorName?.toLowerCase() === primaryColorName.toLowerCase(),
        );
        if (primaryMedia) {
          await reorderPrimaryMedia(shopifyClient, syncMatch.shopifyProductId, primaryMedia.mediaId);
        }
      }
    }
  } catch (err) {
    console.warn("[PublishWorker] Shopify WebP media post-sync failed (non-fatal):", {
      listingId,
      shopifyProductId: syncMatch.shopifyProductId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await persistPrintifyShopifyVariantMapping({
    listingId,
    shopifyProductId: syncMatch.shopifyProductId,
    printifyProductId: printifyProductResult.productId,
    printifyRows,
    variantsBySku: syncMatch.variantsBySku,
  });

  if (store.printifyShop?.unpublishAfterShopifySync) {
    try {
      await printifyClient.unpublishProduct(externalShopId, printifyProductResult.productId);
      emitEvent("publish.printify.unpublished", {
        printifyProductId: printifyProductResult.productId,
        shopifyProductId: syncMatch.shopifyProductId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[PublishWorker] Printify post-sync unpublish failed (non-fatal):", {
        listingId,
        storeId: store.id,
        printifyProductId: printifyProductResult.productId,
        shopifyProductId: syncMatch.shopifyProductId,
        error: message,
      });
      emitEvent("publish.printify.unpublish_failed", {
        printifyProductId: printifyProductResult.productId,
        shopifyProductId: syncMatch.shopifyProductId,
        error: message,
      });
    }
  }

  await prisma.publishJob.update({
    where: { id: shopifyJob.id },
    data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null },
  });
  await prisma.listing.update({
    where: { id: listingId },
    data: { status: "ACTIVE", publishedAt: new Date() },
  });
  emitEvent("publish.shopify.done", { shopifyProductId: syncMatch.shopifyProductId });
  emitEvent("publish.complete", {
    status: "ACTIVE",
    printifyProductId: printifyProductResult.productId,
    shopifyProductId: syncMatch.shopifyProductId,
  });
}

async function persistPrintifyProductRefs(input: {
  listingId: string;
  draftId: string;
  draftDesignId: string | null;
  productId: string;
}): Promise<void> {
  await prisma.listing.update({
    where: { id: input.listingId },
    data: { printifyProductId: input.productId },
  });

  if (input.draftDesignId) {
    await prisma.wizardDraftDesign.update({
      where: { id: input.draftDesignId },
      data: { printifyDraftProductId: input.productId, lastError: null },
    });
    return;
  }

  await prisma.wizardDraft.update({
    where: { id: input.draftId },
    data: { printifyDraftProductId: input.productId },
  });
}

async function persistPrintifyShopifyVariantMapping(input: {
  listingId: string;
  shopifyProductId: string;
  printifyProductId: string;
  printifyRows: Array<{
    printifyVariantId: number;
    sku: string;
    colorName: string;
    colorHex: string | null;
    size: string;
  }>;
  variantsBySku: Map<string, { shopifyVariantId: string }>;
}): Promise<void> {
  const rows = input.printifyRows.map((row) => {
    const shopify = input.variantsBySku.get(row.sku);
    if (!shopify) throw new Error(`Missing Shopify variant for SKU ${row.sku}`);
    return {
      listingId: input.listingId,
      colorName: row.colorName,
      colorHex: row.colorHex ?? "",
      size: row.size,
      sku: row.sku,
      printifyVariantId: String(row.printifyVariantId),
      shopifyVariantId: shopify.shopifyVariantId,
    };
  });

  await prisma.$transaction([
    prisma.listingVariant.deleteMany({ where: { listingId: input.listingId } }),
    prisma.listingVariant.createMany({ data: rows }),
    prisma.listing.update({
      where: { id: input.listingId },
      data: {
        shopifyProductId: input.shopifyProductId,
        printifyProductId: input.printifyProductId,
      },
    }),
  ]);
}

function isTransientPrintifyCreateError(error: unknown): boolean {
  return error instanceof PrintifyApiError && error.status >= 500 && error.status < 600;
}

async function findRecentPrintifyProductCandidate(input: {
  client: Awaited<ReturnType<typeof getClientForStore>>["client"];
  shopId: number;
  title: string;
  blueprintId: number;
  printProviderId: number;
}): Promise<{ id: string } | null> {
  for (let page = 1; page <= 3; page += 1) {
    const result = await input.client.getProducts(input.shopId, page);
    const candidate = (result.data ?? []).find((product) => {
      const title = product.title?.trim();
      return (
        (title === input.title || title === `Copy of ${input.title}`) &&
        Number(product.blueprint_id) === input.blueprintId &&
        Number(product.print_provider_id) === input.printProviderId
      );
    });
    if (candidate) return { id: candidate.id };
  }
  return null;
}

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  jobId: string,
  stage: string,
  onAuthError?: () => Promise<void>,
): Promise<T | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await prisma.publishJob.update({
        where: { id: jobId },
        data: { attempts: attempt },
      });
      return await fn();
    } catch (error) {
      const isPrintifyValidationError =
        error instanceof PrintifyApiError ||
        (error instanceof Error && error.name === "PrintifyApiError");

      if (isPrintifyValidationError) {
        const status = (error as any).status;
        if (status === 400 || status === 422) {
          throw error; // Fail fast without retry
        }
      }

      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[PublishWorker] ${stage} attempt ${attempt}/${MAX_RETRIES} failed:`, errorMsg);

      if (isShopifyAuthError(error)) {
        await onAuthError?.();
      }

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

function isShopifyAuthError(error: unknown): boolean {
  return (
    error instanceof ShopifyAuthError ||
    (error instanceof Error &&
      (error.name === "ShopifyAuthError" || error.message.includes("Token expired or invalid")))
  );
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

async function resolvePrintifyProductPublishInput(input: {
  listing: any;
  draft: any;
  draftDesign: any;
  printifyClient: Awaited<ReturnType<typeof getClientForStore>>["client"];
  externalShopId: number;
  productId: string | null;
}): Promise<{
  productId: string | null;
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
  imageId: string;
  imageGroups?: Array<{ imageId: string; variantIds: number[] }>;
  placementData: PlacementData;
  printAreaByView: PrintAreaByView;
}> {
  const pair =
    input.listing.wizardDraftDesignPair ??
    (input.listing.wizardDraftDesignPairId
      ? await prisma.wizardDraftDesignPair.findUnique({
          where: { id: input.listing.wizardDraftDesignPairId },
        })
      : null);
  const template =
    input.draft.template ??
    (input.draft.storeId
      ? await prisma.storeMockupTemplate.findFirst({
          where: { storeId: input.draft.storeId, isDefault: true },
        })
      : null);

  if (!template?.printifyBlueprintId || !template?.printifyPrintProviderId) {
    throw new Error("Printify template is not configured for this store");
  }

  const cachedVariants = await ensureVariantCostCache({
    client: input.printifyClient,
    shopId: input.externalShopId,
    blueprintId: template.printifyBlueprintId,
    printProviderId: template.printifyPrintProviderId,
  });

  const enabledColorIdSet = new Set(input.draft.enabledColorIds ?? []);
  const storeColors = (input.draft.store as any)?.colors ?? [];
  const selectedColorNames =
    storeColors.length > 0
      ? storeColors
          .filter((color: any) => enabledColorIdSet.has(color.id))
          .map((color: any) => color.name)
      : Array.from(new Set((input.listing.variants ?? []).map((variant: any) => variant.colorName)));
  if (selectedColorNames.length === 0) {
    throw new Error("No selected colors for Printify publish");
  }

  const { effectiveVariantIds, effectiveSizesForPayload } = computeEnabledVariantSelection(
    cachedVariants,
    selectedColorNames,
    input.draft.enabledSizesByColor as Record<string, string[]> | null,
    input.draft.enabledSizes ?? [],
  );
  if (effectiveVariantIds.length === 0) {
    throw new Error("No selected Printify variants for publish");
  }

  const baseRetailPriceUSD = resolveBaseTemplatePrice({
    templateBasePriceUsd: template.basePriceUsd,
    storeDefaultPriceUsd: (input.draft.store as any)?.defaultPriceUsd,
  });
  const priceBySizeOverride = mergeDraftAndTemplatePriceMaps({
    draftPriceBySizeOverride: input.draft.priceBySizeOverride,
    templatePriceBySizeDefault: template.priceBySizeDefault,
  });
  const enabledSet = new Set(effectiveVariantIds);
  const variants = buildVariantPayload(
    cachedVariants,
    selectedColorNames,
    effectiveSizesForPayload,
    baseRetailPriceUSD,
    priceBySizeOverride,
  ).map((variant) => ({
    ...variant,
    is_enabled: enabledSet.has(variant.id),
  }));

  const targetDesign = input.draftDesign?.design ?? input.draft.design ?? null;
  let imageId = "";
  let imageGroups: Array<{ imageId: string; variantIds: number[] }> | undefined;

  if (pair) {
    const lightDraftDesign = input.draft.draftDesigns.find(
      (entry: any) => entry.id === pair.lightDraftDesignId,
    );
    const darkDraftDesign = input.draft.draftDesigns.find(
      (entry: any) => entry.id === pair.darkDraftDesignId,
    );
    if (!lightDraftDesign?.design || !darkDraftDesign?.design) {
      throw new Error("Pair design files not found in draft");
    }

    const lightImageId = await ensurePrintifyImage({
      client: input.printifyClient,
      designStoragePath: lightDraftDesign.design.storagePath,
      cachedImageId: lightDraftDesign.printifyImageId,
    });
    const darkImageId = await ensurePrintifyImage({
      client: input.printifyClient,
      designStoragePath: darkDraftDesign.design.storagePath,
      cachedImageId: darkDraftDesign.printifyImageId,
    });

    await prisma.wizardDraftDesign.update({
      where: { id: lightDraftDesign.id },
      data: { printifyImageId: lightImageId },
    });
    await prisma.wizardDraftDesign.update({
      where: { id: darkDraftDesign.id },
      data: { printifyImageId: darkImageId },
    });

    const colorNameToId = new Map<string, string>();
    for (const color of storeColors) {
      colorNameToId.set(color.name.trim().toLowerCase(), color.id);
    }
    const colorGroups = resolveColorGroups(storeColors);
    const lightVariantIds: number[] = [];
    const darkVariantIds: number[] = [];

    for (const variant of cachedVariants) {
      const colorId = colorNameToId.get(variant.colorName.trim().toLowerCase());
      const group = (() => {
        if (colorId) return colorGroups.get(colorId);
        const hex = variant.colorHex ?? "";
        if (/^#[0-9a-fA-F]{6}$/.test(hex.trim())) {
          try {
            return classifyColorHex(hex);
          } catch {
            return "light";
          }
        }
        return "light";
      })();

      if (group === "dark") darkVariantIds.push(variant.variantId);
      else lightVariantIds.push(variant.variantId);
    }

    imageGroups = [
      { imageId: lightImageId, variantIds: lightVariantIds },
      { imageId: darkImageId, variantIds: darkVariantIds },
    ];
  } else if (targetDesign?.storagePath) {
    imageId = await ensurePrintifyImage({
      client: input.printifyClient,
      designStoragePath: targetDesign.storagePath,
      cachedImageId: input.draftDesign?.printifyImageId ?? input.draft.printifyImageId,
    });
  } else {
    throw new Error("Design file not found");
  }

  const effectivePlacementData = resolveEffectivePlacementData(
    input.draft.placementOverride,
    template.defaultPlacement,
  );
  const printAreaByView = await resolvePrintAreaByView({
    blueprintId: template.printifyBlueprintId,
    views: effectivePlacementData ? resolvePlacementViews(effectivePlacementData) : ["front"],
  });
  const customMockupPlacementData = !effectivePlacementData
    ? await resolveCustomMockupPlacementData({
        draftId: input.draft.id,
        colorIds: input.draft.enabledColorIds ?? [],
        design: targetDesign
          ? { width: targetDesign.width, height: targetDesign.height }
          : null,
        printAreaByView,
      })
    : null;

  return {
    productId: input.productId,
    blueprintId: template.printifyBlueprintId,
    printProviderId: template.printifyPrintProviderId,
    variantIds: effectiveVariantIds,
    variants,
    imageId,
    imageGroups,
    placementData:
      effectivePlacementData ??
      customMockupPlacementData ??
      (targetDesign
        ? buildListingReadyPlacementData({
            design: { widthPx: targetDesign.width, heightPx: targetDesign.height },
            printArea: printAreaForView(printAreaByView, "front"),
            template: {
              productType: input.draft.productType,
              blueprintTitle: template.blueprintTitle,
              blueprintBrand: template.blueprintBrand,
            },
          })
        : defaultPlacementData()),
    printAreaByView,
  };
}

async function publishExistingPrintifyDraftProduct(input: {
  storeId: string;
  draftId: string;
  draftDesignId?: string | null;
  productId: string;
  designStoragePath?: string;
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
  printAreaByView?: PrintAreaByView;
  imageGroups?: Array<{ imageId: string; variantIds: number[] }>;
}): Promise<{ printifyProductId: string }> {
  const { client, externalShopId } = await getClientForStore(input.storeId);
  const imageId = input.imageGroups?.length
    ? ""
    : await ensurePrintifyImage({
        client,
        designStoragePath: input.designStoragePath!,
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
    printAreaByView: input.printAreaByView,
    title: input.title,
    description: input.description,
    imageGroups: input.imageGroups,
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
    // Draft product was deleted on Printify — clear stale ref and CREATE new.
    // 5xx can happen after Printify creates a product, so retrying CREATE would duplicate.
    const isNotFound = err instanceof PrintifyNotFoundError;
    if (isNotFound) {
      console.warn(
        `[PublishWorker] Draft product ${input.productId} not found (404). Clearing stale ref and creating new product.`,
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
  const mockupImages: ShopifyMockupImage[] = [];

  for (const image of input.images) {
    const colorKey = normalizeColorName(image.colorName);
    if (!selectedColorKeys.has(colorKey)) continue;

    const source = image.compositeUrl ?? image.sourceUrl;
    if (!source) continue;

    if (isRemoteUrl(source)) {
      if (!isAllowedRemoteMockupUrl(source)) continue;
      mockupImages.push({
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
      parsedSource.kind === "custom" ||
      parsedSource.kind === "library";
    if (input.requireRealPrintifyMockups && !hasRealPrintifySource) continue;

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

/**
 * Pick a random Primary Color among the colors that actually have mockup media.
 * Its media is moved to the front of the upload list (and to position 0 via
 * productReorderMedia) so consecutively published products rotate thumbnails.
 * Returns null when no mockup carries a color name.
 */
export function pickPrimaryColorName(
  mockupImages: ShopifyMockupImage[],
  rng: () => number = Math.random,
): string | null {
  const colors = [
    ...new Set(
      mockupImages
        .map((m) => m.colorName)
        .filter((c): c is string => typeof c === "string" && c.trim().length > 0),
    ),
  ];
  if (colors.length === 0) return null;
  return colors[Math.floor(rng() * colors.length)] ?? colors[0];
}

/**
 * Reorder mockup images so the primary color group is first, with the remaining
 * groups following the original storefront color order (stable within a group).
 * The colors array passed to Shopify keeps its original order, so the storefront
 * dropdown is unchanged — only upload/media order is affected.
 */
export function orderMockupImagesByPrimary(
  mockupImages: ShopifyMockupImage[],
  colorOrder: string[],
  primaryColorName: string | null,
): ShopifyMockupImage[] {
  if (!primaryColorName) return mockupImages;
  const primaryKey = primaryColorName.trim().toLowerCase();
  const orderRank = new Map(colorOrder.map((name, i) => [name.trim().toLowerCase(), i] as const));
  const rankOf = (name?: string): number => {
    if (!name) return colorOrder.length + 1;
    const key = name.trim().toLowerCase();
    if (key === primaryKey) return -1;
    return orderRank.get(key) ?? colorOrder.length;
  };

  return mockupImages
    .map((img, index) => ({ img, index }))
    .sort((a, b) => {
      const ra = rankOf(a.img.colorName);
      const rb = rankOf(b.img.colorName);
      if (ra !== rb) return ra - rb;
      return a.index - b.index; // stable within a color group
    })
    .map((entry) => entry.img);
}

export function orderColorsByPrimary<T extends { name: string }>(
  colors: T[],
  primaryColorName: string | null,
): T[] {
  if (!primaryColorName) return colors;
  const primaryKey = normalizeColorName(primaryColorName);
  return colors
    .map((color, index) => ({ color, index }))
    .sort((a, b) => {
      const ar = normalizeColorName(a.color.name) === primaryKey ? -1 : a.index;
      const br = normalizeColorName(b.color.name) === primaryKey ? -1 : b.index;
      return ar - br;
    })
    .map((entry) => entry.color);
}

export function orderVariantsByPrimary<T extends { colorName: string }>(
  variants: T[] | undefined,
  primaryColorName: string | null,
): T[] | undefined {
  if (!variants || !primaryColorName) return variants;
  const primaryKey = normalizeColorName(primaryColorName);
  return variants
    .map((variant, index) => ({ variant, index }))
    .sort((a, b) => {
      const ar = normalizeColorName(a.variant.colorName) === primaryKey ? -1 : a.index;
      const br = normalizeColorName(b.variant.colorName) === primaryKey ? -1 : b.index;
      return ar - br;
    })
    .map((entry) => entry.variant);
}

/**
 * Validate variant SKUs before sending to Shopify.
 * Throws on duplicate SKUs, or when SKUs are present on some variants but
 * missing on others (inconsistent catalog). A catalog where no variant has a
 * SKU is allowed (warning only) so SKU-less blueprints can still publish.
 */
export function validateVariantSkus(variants: ShopifyVariantPlanItem[]): void {
  if (variants.length === 0) return;
  const withSku = variants.filter((v) => v.sku && v.sku.trim().length > 0);

  if (withSku.length === 0) {
    console.warn("[PublishWorker] No SKUs present on any variant — publishing without SKUs");
    return;
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const v of withSku) {
    const sku = v.sku!.trim();
    if (seen.has(sku)) duplicates.add(sku);
    seen.add(sku);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate SKU(s) detected, aborting publish: ${[...duplicates].join(", ")}`);
  }

  if (withSku.length < variants.length) {
    const missing = variants
      .filter((v) => !v.sku || v.sku.trim().length === 0)
      .map((v) => `${v.colorName}${v.size ? ` / ${v.size}` : ""}`);
    throw new Error(`Missing SKU for variant(s), aborting publish: ${missing.join(", ")}`);
  }
}

/**
 * Read the Printify variant catalog/cache and build the full Shopify variant
 * plan (Color + Size + SKU + price) BEFORE the Shopify productSet call.
 * Returns null when the catalog cannot be resolved (missing blueprint/provider
 * or no enabled variants) so the caller falls back to colors-only variants.
 */
async function resolveShopifyVariantPlan(
  // biome-ignore lint/suspicious/noExplicitAny: prisma draft shape, matches runPrintifyStage convention
  draft: any,
  storeId: string,
): Promise<ShopifyVariantPlanItem[] | null> {
  const template = draft.template;
  const blueprintId = template?.printifyBlueprintId ?? 0;
  const printProviderId = template?.printifyPrintProviderId ?? 0;
  const productType = template?.blueprintTitle ?? draft.productType;
  if (!blueprintId || !printProviderId || !productType) return null;

  const { client: printifyClient, externalShopId } = await getClientForStore(storeId);
  if (!externalShopId) return null;

  const baseRetailPriceUSD = resolveBaseTemplatePrice({
    templateBasePriceUsd: template?.basePriceUsd,
    storeDefaultPriceUsd: (draft.store as { defaultPriceUsd?: unknown } | null)?.defaultPriceUsd,
  });

  const cachedVariants = await ensureVariantCostCache({
    client: printifyClient,
    shopId: externalShopId,
    blueprintId,
    printProviderId,
  });

  const enabledColorIdSet = new Set(draft.enabledColorIds ?? []);
  const storeColors =
    (draft.store as { colors?: Array<{ id: string; name: string }> } | null)?.colors ?? [];
  const selectedColorNames = storeColors
    .filter((c) => enabledColorIdSet.has(c.id))
    .map((c) => c.name);
  if (selectedColorNames.length === 0) return null;

  const sizesByColor = draft.enabledSizesByColor as Record<string, string[]> | null;
  const { effectiveVariantIds, effectiveSizesForPayload } = computeEnabledVariantSelection(
    cachedVariants,
    selectedColorNames,
    sizesByColor,
    draft.enabledSizes ?? [],
  );
  if (effectiveVariantIds.length === 0) return null;

  const priceBySizeOverride = mergeDraftAndTemplatePriceMaps({
    draftPriceBySizeOverride: draft.priceBySizeOverride,
    templatePriceBySizeDefault: template?.priceBySizeDefault,
  });
  const variantPayload = buildVariantPayload(
    cachedVariants,
    selectedColorNames,
    effectiveSizesForPayload,
    baseRetailPriceUSD,
    priceBySizeOverride,
  );

  const plan = buildShopifyVariantInputs(
    cachedVariants,
    variantPayload,
    effectiveVariantIds,
    selectedColorNames,
  );
  return plan.length > 0 ? plan : null;
}
