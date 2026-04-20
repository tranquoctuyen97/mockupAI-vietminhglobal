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
import { publishToShopify } from "./shopify";
import { publishToPrintify } from "./printify";
import { sseChannels } from "@/lib/sse/channel";
import { getStorage } from "@/lib/storage/local-disk";
import { isEnabled } from "@/lib/feature-flags";

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

export function generateIdempotencyKey(draftId: string, tenantId: string): string {
  return createHash("sha256").update(`${draftId}|${tenantId}`).digest("hex");
}

interface PublishInput {
  listingId: string;
  draftId: string;
  tenantId: string;
}

export async function runPublishWorker(input: PublishInput): Promise<void> {
  const { listingId, draftId, tenantId } = input;
  const channelId = `publish:${listingId}`;

  try {
    // Load listing with all relations
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { variants: true, publishJobs: true },
    });
    if (!listing) throw new Error("Listing not found");

    // Load store
    const store = await prisma.store.findUnique({
      where: { id: listing.storeId },
    });
    if (!store) throw new Error("Store not found");

    // Load credentials
    const creds = await prisma.storeCredentials.findUnique({
      where: { storeId: store.id },
    });
    if (!creds || !creds.shopifyTokenEncrypted) throw new Error("Store credentials not found or Shopify not connected");

    const shopifyAccessToken = decrypt(creds.shopifyTokenEncrypted);

    // Load draft for mockup paths
    const draft = await prisma.wizardDraft.findUnique({
      where: { id: draftId },
      include: { mockupJobs: true, design: true },
    });
    if (!draft) throw new Error("Draft not found");

    const storage = getStorage();
    const succeededMockups = draft.mockupJobs.filter((j) => j.status === "SUCCEEDED" && j.mockupStoragePath);
    const mockupPaths = succeededMockups.map((j) => storage.resolvePath(j.mockupStoragePath!));

    // Check dry-run feature flag
    const isDryRun = await isEnabled("publish_dry_run");

    // ─── Stage 1: Shopify ───────────────────────────────

    const shopifyJob = listing.publishJobs.find((j) => j.stage === "SHOPIFY");
    if (!shopifyJob) throw new Error("Shopify publish job not found");

    sseChannels.emit(channelId, {
      type: "publish.shopify.start",
      data: { stage: "SHOPIFY" },
    });

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
      shopifyResult = await retryWithBackoff(
        async () => {
          const shopifyClient = new ShopifyClient(store.shopifyDomain!, shopifyAccessToken);
          const result = await publishToShopify(shopifyClient, store.shopifyDomain!, {
            title: listing.title,
            descriptionHtml: listing.descriptionHtml,
            tags: listing.tags,
            priceUsd: listing.priceUsd,
            productType: draft.productType || "Apparel",
            colors: listing.variants.map((v) => ({ name: v.colorName, hex: v.colorHex })),
            mockupPaths,
          });
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
      sseChannels.emit(channelId, {
        type: "publish.failed",
        data: { stage: "SHOPIFY", error: "Shopify publish failed after retries" },
      });
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

    sseChannels.emit(channelId, {
      type: "publish.shopify.done",
      data: { shopifyProductId: shopifyResult.shopifyProductId },
    });

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
      sseChannels.emit(channelId, {
        type: "publish.complete",
        data: { status: "PARTIAL_FAILURE", reason: "No Printify shop linked" },
      });
      return;
    }

    await runPrintifyStage(listingId, listing, draft, store, printifyApiKey, storage, isDryRun, channelId);
  } catch (error) {
    console.error("[PublishWorker] Unexpected error:", error);
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "FAILED" },
    });
    sseChannels.emit(channelId, {
      type: "publish.failed",
      data: { error: error instanceof Error ? error.message : "Unknown error" },
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
  storage: any,
  isDryRun: boolean,
  channelId: string,
): Promise<void> {
  const printifyJob = listing.publishJobs.find((j: any) => j.stage === "PRINTIFY");
  if (!printifyJob) return;

  sseChannels.emit(channelId, {
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
      return;
    }

    const variantIds = (draft.selectedColors as Array<{ printifyVariantId?: number }> || [])
      .filter((c: any) => c.printifyVariantId)
      .map((c: any) => c.printifyVariantId as number);

    printifyResult = await retryWithBackoff(
      async () => {
        return publishToPrintify({
          apiKey: printifyApiKey,
          shopId: store?.printifyShopId || "",
          title: listing.title,
          description: listing.descriptionHtml,
          blueprintId: draft.blueprintId || 0,
          printProviderId: draft.printProviderId || 0,
          variantIds: variantIds.length > 0 ? variantIds : [1],
          mockupPaths: [],
          designPath,
        });
      },
      printifyJob.id,
      "PRINTIFY",
    );
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
  } else {
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "PARTIAL_FAILURE" },
    });
    sseChannels.emit(channelId, {
      type: "publish.complete",
      data: { status: "PARTIAL_FAILURE", reason: "Printify publish failed after retries" },
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
