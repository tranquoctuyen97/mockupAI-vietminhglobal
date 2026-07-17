/**
 * POST /api/listings/:id/retry-printify — Retry Printify stage
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getClientForStore } from "@/lib/printify/account";
import { resolvePublishStrategy } from "@/lib/publish/strategy";
import { runPrintifyStage, runPublishWorker } from "@/lib/publish/worker";
import { getStorage } from "@/lib/storage/local-disk";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const listing = await prisma.listing.findFirst({
    where: { id, tenantId: session.tenantId },
    include: { variants: true, publishJobs: true },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  if (!["PARTIAL_FAILURE", "FAILED"].includes(listing.status)) {
    return NextResponse.json(
      { error: `Listing status is ${listing.status}. Retry only allowed for PARTIAL_FAILURE or FAILED.` },
      { status: 400 },
    );
  }

  // Load draft for blueprint info
  const draft = listing.wizardDraftId
    ? await prisma.wizardDraft.findUnique({
        where: { id: listing.wizardDraftId },
        include: {
          design: true,
          draftDesigns: {
            orderBy: { sortOrder: "asc" },
            include: {
              design: true,
            },
          },
          mockupJobs: {
            include: {
              images: {
                orderBy: { sortOrder: "asc" },
              },
            },
          },
          template: true,
          store: true,
        },
      })
    : null;

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 400 });
  }

  if (!listing.storeId) {
    return NextResponse.json({ error: "Listing has no store" }, { status: 400 });
  }

  // Get store + Printify connection (Phase 6.5: workspace-level)
  const store = await prisma.store.findUnique({
    where: { id: listing.storeId },
    include: { printifyShop: true },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 400 });
  }

  if (resolvePublishStrategy(store) === "PRINTIFY_SHOPIFY_CHANNEL") {
    const hasRunningJob = listing.publishJobs.some(
      (job) => job.status === "PENDING" || job.status === "RUNNING",
    );
    if (hasRunningJob) {
      return NextResponse.json({ ok: true, status: "already_running" });
    }

    const printifyJob = listing.publishJobs.find((job) => job.stage === "PRINTIFY");
    const shopifyJob = listing.publishJobs.find((job) => job.stage === "SHOPIFY");
    const resumeAfterPrintify =
      printifyJob?.status === "SUCCEEDED" &&
      typeof listing.printifyProductId === "string" &&
      listing.printifyProductId.length > 0;

    if (!resumeAfterPrintify && printifyJob) {
      await prisma.publishJob.update({
        where: { id: printifyJob.id },
        data: { status: "PENDING", attempts: 0, lastError: null, completedAt: null },
      });
    }
    if (shopifyJob) {
      await prisma.publishJob.update({
        where: { id: shopifyJob.id },
        data: { status: "PENDING", attempts: 0, lastError: null, completedAt: null },
      });
    }

    void runPublishWorker({
      listingId: listing.id,
      draftId: draft.id,
      tenantId: session.tenantId,
    }).catch((err) => console.error("[RetryPrintify] Full worker error:", err));

    return NextResponse.json({
      ok: true,
      status: resumeAfterPrintify ? "resuming_shopify_sync" : "retrying",
      printifyProductId: resumeAfterPrintify ? listing.printifyProductId : null,
    });
  }

  let printifyApiKey: string;
  let externalShopId: number;
  try {
    const result = await getClientForStore(listing.storeId!);
    printifyApiKey = (result.client as any).apiKey;
    externalShopId = result.externalShopId;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Printify not linked" }, { status: 400 });
  }

  // Reset Printify job
  const printifyJob = listing.publishJobs.find((j) => j.stage === "PRINTIFY");
  if (printifyJob) {
    await prisma.publishJob.update({
      where: { id: printifyJob.id },
      data: { status: "PENDING", attempts: 0, lastError: null, completedAt: null },
    });
  }

  const storage = getStorage();
  const channelId = `publish:${listing.id}`;

  // Run async
  runPrintifyStage(listing.id, listing, draft, store, printifyApiKey, externalShopId, storage, false, channelId, draft.id).catch(
    (err) => console.error("[RetryPrintify] Error:", err),
  );

  return NextResponse.json({ ok: true, status: "retrying" });
}
