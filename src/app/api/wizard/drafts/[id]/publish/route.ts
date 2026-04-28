/**
 * POST /api/wizard/drafts/:id/publish — Trigger publish pipeline
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { generateIdempotencyKey, runPublishWorker } from "@/lib/publish/worker";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;

  // Load draft with all data
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    include: { design: true, mockupJobs: true, store: { include: { template: true, colors: true } } },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  // Validate completeness
  if (!draft.designId) {
    return NextResponse.json({ error: "Design not selected" }, { status: 400 });
  }
  if (!draft.storeId) {
    return NextResponse.json({ error: "Store not selected" }, { status: 400 });
  }
  // Validate store still exists (prevent dangling refs after hard-delete)
  if (!draft.store) {
    return NextResponse.json({ error: "Store không tồn tại. Vui lòng chọn lại store." }, { status: 400 });
  }
  const productType = draft.store?.template?.blueprintTitle || draft.store?.name || "T-Shirt";

  const aiContent = draft.aiContent as { title?: string; description?: string; tags?: string[] } | null;
  if (!aiContent?.title) {
    return NextResponse.json({ error: "AI content not generated" }, { status: 400 });
  }

  // Check idempotency — prevent duplicate publish
  const idempotencyKey = generateIdempotencyKey(draftId, session.tenantId);
  const existingListing = await prisma.listing.findUnique({
    where: { wizardDraftId: draftId },
  });

  if (existingListing) {
    // Already published — return existing listing
    return NextResponse.json({
      listingId: existingListing.id,
      status: existingListing.status,
      alreadyPublished: true,
    });
  }

  const pricingTemplate = await prisma.productPricingTemplate.findFirst({
    where: { tenantId: session.tenantId, productType },
  });
  const priceUsd = pricingTemplate?.basePriceUsd || draft.store?.defaultPriceUsd?.toNumber() || 24.99;

  const colors = draft.store?.colors?.filter((c: any) => draft.enabledColorIds.includes(c.id)).map((c: any) => ({ title: c.name, hex: c.hex })) || [];

  // Create listing
  const listing = await prisma.listing.create({
    data: {
      tenantId: session.tenantId,
      storeId: draft.storeId,
      designId: draft.designId,
      wizardDraftId: draftId,
      title: aiContent.title || "",
      descriptionHtml: aiContent.description || "",
      tags: aiContent.tags || [],
      priceUsd,
      createdBy: session.id,
      variants: {
        create: colors.map((c) => ({
          colorName: c.title,
          colorHex: c.hex,
        })),
      },
      publishJobs: {
        create: [
          {
            idempotencyKey: `${idempotencyKey}-shopify`,
            stage: "SHOPIFY",
          },
          {
            idempotencyKey: `${idempotencyKey}-printify`,
            stage: "PRINTIFY",
          },
        ],
      },
    },
  });

  // Update draft status
  await prisma.wizardDraft.update({
    where: { id: draftId },
    data: { status: "PUBLISHED" },
  });

  // Trigger async publish
  runPublishWorker({
    listingId: listing.id,
    draftId,
    tenantId: session.tenantId,
  }).catch((err) => {
    console.error("[Publish API] Worker error:", err);
  });

  return NextResponse.json({
    listingId: listing.id,
    status: "PUBLISHING",
    alreadyPublished: false,
  });
}
