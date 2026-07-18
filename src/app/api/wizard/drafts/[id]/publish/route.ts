/**
 * POST /api/wizard/drafts/:id/publish — Trigger publish pipeline
 */

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { formatDescriptionHtml } from "@/lib/content/description-html";
import { prisma } from "@/lib/db";
import { normalizeMoneyValue, resolveBaseTemplatePrice } from "@/lib/pricing/template-pricing";
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";
import { getIndependentDraftDesigns, hasAiTitle } from "@/lib/wizard/publish-units";

type DraftDesignSelection = {
  id: string;
  designId: string;
  sortOrder: number;
  aiContent?: unknown | null;
  design?: {
    id: string;
    name: string;
    storagePath: string;
    previewPath?: string | null;
  } | null;
};

type PublishListingResponse = {
  listingId: string;
  designPairId?: string | null;
  draftDesignId: string | null;
  designId: string;
  designName: string;
  status: string;
  alreadyPublished: boolean;
};

type ExistingListingForPublish = {
  id: string;
  status: string;
  activePublishAttemptId?: string | null;
  wizardDraftDesignId: string | null;
  designId: string | null;
  shopifyProductId?: string | null;
  printifyProductId?: string | null;
  publishJobs?: Array<{
    stage: string;
    status: string;
    publishAttemptId?: string | null;
  }>;
};

function hasRunningPublishJob(listing: ExistingListingForPublish): boolean {
  if (listing.activePublishAttemptId) return true;
  return Boolean(
    listing.publishJobs?.some((job) => job.status === "PENDING" || job.status === "RUNNING"),
  );
}

function shouldRetryExistingListing(listing: ExistingListingForPublish): boolean {
  if (!["FAILED", "PARTIAL_FAILURE"].includes(listing.status)) return false;
  return !hasRunningPublishJob(listing);
}

function statusForExistingListing(listing: ExistingListingForPublish): string {
  if (hasRunningPublishJob(listing)) return "PUBLISHING";
  return shouldRetryExistingListing(listing) ? "PUBLISHING" : listing.status;
}

function nextAttemptNo(listing: { publishAttempts?: Array<{ attemptNo: number }> }): number {
  const attempts = listing.publishAttempts ?? [];
  if (attempts.length === 0) return 1;
  return Math.max(...attempts.map((attempt) => attempt.attemptNo)) + 1;
}

function shouldCarryForwardStage(input: {
  listing: ExistingListingForPublish;
  stage: "SHOPIFY" | "PRINTIFY";
}): boolean {
  const previousJob = input.listing.publishJobs?.find((job) => job.stage === input.stage);
  if (previousJob?.status !== "SUCCEEDED") return false;

  if (input.stage === "SHOPIFY") {
    return Boolean(input.listing.shopifyProductId);
  }
  return Boolean(input.listing.printifyProductId);
}

async function createPublishAttemptForListing(input: {
  tx: Prisma.TransactionClient;
  listing: ExistingListingForPublish & {
    publishAttempts?: Array<{ id: string; attemptNo: number }>;
  };
  draftId: string;
  tenantId: string;
}) {
  const attempt = await input.tx.publishAttempt.create({
    data: {
      listingId: input.listing.id,
      tenantId: input.tenantId,
      attemptNo: nextAttemptNo(input.listing),
      status: "PENDING",
      baselineListingStatus: input.listing.status,
      resumeFromAttemptId: null,
    },
  });

  const shopifyStatus = shouldCarryForwardStage({ listing: input.listing, stage: "SHOPIFY" })
    ? "SUCCEEDED"
    : "PENDING";
  const printifyStatus = shouldCarryForwardStage({ listing: input.listing, stage: "PRINTIFY" })
    ? "SUCCEEDED"
    : "PENDING";
  const resumedFromAttemptId =
    shopifyStatus === "SUCCEEDED" || printifyStatus === "SUCCEEDED"
      ? (input.listing.publishJobs?.find((job) => job.status === "SUCCEEDED")?.publishAttemptId ??
        null)
      : null;

  if (resumedFromAttemptId) {
    await input.tx.publishAttempt.update({
      where: { id: attempt.id },
      data: { resumeFromAttemptId: resumedFromAttemptId },
    });
  }

  await input.tx.publishJob.createMany({
    data: [
      {
        listingId: input.listing.id,
        publishAttemptId: attempt.id,
        idempotencyKey: `${input.listing.id}:${attempt.id}:SHOPIFY`,
        stage: "SHOPIFY",
        status: shopifyStatus,
        completedAt: shopifyStatus === "SUCCEEDED" ? new Date() : null,
        progressData: resumedFromAttemptId ? { resumedFromAttemptId } : Prisma.DbNull,
      },
      {
        listingId: input.listing.id,
        publishAttemptId: attempt.id,
        idempotencyKey: `${input.listing.id}:${attempt.id}:PRINTIFY`,
        stage: "PRINTIFY",
        status: printifyStatus,
        completedAt: printifyStatus === "SUCCEEDED" ? new Date() : null,
        progressData: resumedFromAttemptId ? { resumedFromAttemptId } : Prisma.DbNull,
      },
    ],
  });

  await input.tx.publishOutbox.create({
    data: {
      listingId: input.listing.id,
      draftId: input.draftId,
      tenantId: input.tenantId,
      publishAttemptId: attempt.id,
    },
  });

  await input.tx.listing.update({
    where: { id: input.listing.id },
    data: {
      status: "PUBLISHING",
      activePublishAttemptId: attempt.id,
    },
  });

  return attempt;
}

function resolveSelectedDraftDesigns(draft: any): DraftDesignSelection[] {
  if (Array.isArray(draft.draftDesigns) && draft.draftDesigns.length > 0) {
    return [...draft.draftDesigns]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((entry) => ({
        id: entry.id,
        designId: entry.designId,
        sortOrder: entry.sortOrder ?? 0,
        aiContent: entry.aiContent ?? null,
        design: entry.design ?? null,
      }));
  }

  if (!draft.designId) return [];

  return [
    {
      id: draft.designId,
      designId: draft.designId,
      sortOrder: 0,
      aiContent: null,
      design: draft.design
        ? {
            id: draft.design.id ?? draft.designId,
            name: draft.design.name ?? "Design",
            storagePath: draft.design.storagePath ?? "",
            previewPath: draft.design.previewPath ?? null,
          }
        : null,
    },
  ];
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;
  const body = (await request.json().catch(() => ({}))) as { priceUsd?: number | string | null };

  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    include: {
      design: true,
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        include: {
          design: true,
        },
      },
      designPairs: {
        orderBy: { sortOrder: "asc" },
        include: {
          lightDesign: { include: { design: true } },
          darkDesign: { include: { design: true } },
        },
      },
      template: true,
      store: { include: { colors: true } },
    },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (!draft.storeId) {
    return NextResponse.json({ error: "Store not selected" }, { status: 400 });
  }

  if (!draft.store) {
    return NextResponse.json(
      { error: "Store không tồn tại. Vui lòng chọn lại store." },
      { status: 400 },
    );
  }

  const selectedDraftDesigns = resolveSelectedDraftDesigns(draft);
  if (selectedDraftDesigns.length === 0) {
    return NextResponse.json({ error: "Design not selected" }, { status: 400 });
  }

  let template = draft.template;
  if (!template && draft.storeId) {
    template = await prisma.storeMockupTemplate.findFirst({
      where: { storeId: draft.storeId, isDefault: true },
    });
  }

  const priceUsd =
    normalizeMoneyValue(body.priceUsd) ??
    resolveBaseTemplatePrice({
      templateBasePriceUsd: template?.basePriceUsd,
      storeDefaultPriceUsd: draft.store?.defaultPriceUsd,
    });

  const colors =
    draft.store?.colors
      ?.filter((c: any) => (draft.enabledColorIds ?? []).includes(c.id))
      .map((c: any) => ({
        name: c.name,
        hex: c.hex,
      })) || [];

  const independentDraftDesigns = getIndependentDraftDesigns(
    selectedDraftDesigns,
    draft.designPairs,
  );

  const pairMissingContent = draft.designPairs.find((pair) => !hasAiTitle(pair.aiContent));
  if (pairMissingContent) {
    return NextResponse.json(
      { error: `Thiếu nội dung cho cặp ${pairMissingContent.baseName || pairMissingContent.id}` },
      { status: 400 },
    );
  }

  const independentMissingContent = independentDraftDesigns.find(
    (draftDesign) => !hasAiTitle(draftDesign.aiContent),
  );
  if (independentMissingContent) {
    return NextResponse.json(
      {
        error: `Thiếu nội dung cho design ${
          independentMissingContent.design?.name || independentMissingContent.id
        }`,
      },
      { status: 400 },
    );
  }

  const listings = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${session.tenantId}), hashtext(${draftId}))`,
    );

    const createdListings: PublishListingResponse[] = [];

    for (const pair of draft.designPairs) {
      const pairContent = pair.aiContent as {
        title?: string;
        description?: string;
        tags?: string[];
        collections?: string[];
      };

      const existingListing = await tx.listing.findUnique({
        where: { wizardDraftDesignPairId: pair.id },
        include: {
          publishAttempts: { select: { id: true, attemptNo: true } },
          publishJobs: { select: { stage: true, status: true, publishAttemptId: true } },
        },
      });

      if (existingListing) {
        const retryExisting = shouldRetryExistingListing(existingListing);
        createdListings.push({
          listingId: existingListing.id,
          designPairId: pair.id,
          draftDesignId: existingListing.wizardDraftDesignId ?? null,
          designId: existingListing.designId ?? pair.lightDesign.designId,
          designName: pair.baseName,
          status: statusForExistingListing(existingListing),
          alreadyPublished: !retryExisting,
        });
        if (retryExisting) {
          await createPublishAttemptForListing({
            tx,
            listing: existingListing,
            draftId,
            tenantId: session.tenantId,
          });
        }
        continue;
      }

      const listing = await tx.listing.create({
        data: {
          tenantId: session.tenantId,
          storeId: draft.storeId,
          designId: pair.lightDesign.designId,
          templateId: template?.id || null,
          wizardDraftId: draftId,
          wizardDraftDesignId: pair.lightDraftDesignId,
          wizardDraftDesignPairId: pair.id,
          title: pairContent.title || "",
          descriptionHtml: formatDescriptionHtml(pairContent.description),
          tags: pairContent.tags || [],
          organizationCollections: normalizeOrganizationCollections(pairContent.collections),
          priceUsd,
          createdBy: session.id,
          variants: {
            create: colors.map((c) => ({
              colorName: c.name,
              colorHex: c.hex,
            })),
          },
        },
      });

      await createPublishAttemptForListing({
        tx,
        listing: { ...listing, publishJobs: [], publishAttempts: [] },
        draftId,
        tenantId: session.tenantId,
      });

      createdListings.push({
        listingId: listing.id,
        designPairId: pair.id,
        draftDesignId: listing.wizardDraftDesignId ?? null,
        designId: pair.lightDesign.designId,
        designName: pair.baseName,
        status: "PUBLISHING",
        alreadyPublished: false,
      });
    }

    for (const draftDesign of independentDraftDesigns) {
      const independentContent = draftDesign.aiContent as {
        title?: string;
        description?: string;
        tags?: string[];
        collections?: string[];
      };

      const existingListing = await tx.listing.findUnique({
        where: { wizardDraftDesignId: draftDesign.id },
        include: {
          publishAttempts: { select: { id: true, attemptNo: true } },
          publishJobs: { select: { stage: true, status: true, publishAttemptId: true } },
        },
      });

      if (existingListing) {
        const retryExisting = shouldRetryExistingListing(existingListing);
        createdListings.push({
          listingId: existingListing.id,
          designPairId: null,
          draftDesignId: existingListing.wizardDraftDesignId ?? null,
          designId: existingListing.designId ?? draftDesign.designId,
          designName: draftDesign.design?.name ?? "Design",
          status: statusForExistingListing(existingListing),
          alreadyPublished: !retryExisting,
        });
        if (retryExisting) {
          await createPublishAttemptForListing({
            tx,
            listing: existingListing,
            draftId,
            tenantId: session.tenantId,
          });
        }
        continue;
      }

      const listing = await tx.listing.create({
        data: {
          tenantId: session.tenantId,
          storeId: draft.storeId,
          designId: draftDesign.designId,
          templateId: template?.id || null,
          wizardDraftId: draftId,
          wizardDraftDesignId: draftDesign.id,
          wizardDraftDesignPairId: null,
          title: independentContent.title || "",
          descriptionHtml: formatDescriptionHtml(independentContent.description),
          tags: independentContent.tags || [],
          organizationCollections: normalizeOrganizationCollections(independentContent.collections),
          priceUsd,
          createdBy: session.id,
          variants: {
            create: colors.map((c) => ({
              colorName: c.name,
              colorHex: c.hex,
            })),
          },
        },
      });

      await createPublishAttemptForListing({
        tx,
        listing: { ...listing, publishJobs: [], publishAttempts: [] },
        draftId,
        tenantId: session.tenantId,
      });

      createdListings.push({
        listingId: listing.id,
        designPairId: null,
        draftDesignId: listing.wizardDraftDesignId ?? null,
        designId: draftDesign.designId,
        designName: draftDesign.design?.name ?? "Design",
        status: "PUBLISHING",
        alreadyPublished: false,
      });
    }

    await tx.wizardDraft.update({
      where: { id: draftId },
      data: { status: "PUBLISHED" },
    });

    return createdListings;
  });

  return NextResponse.json({ listings });
}
