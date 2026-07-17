/**
 * POST /api/wizard/drafts/:id/publish — Trigger publish pipeline
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { formatDescriptionHtml } from "@/lib/content/description-html";
import { prisma } from "@/lib/db";
import { normalizeMoneyValue, resolveBaseTemplatePrice } from "@/lib/pricing/template-pricing";
import { generateIdempotencyKey, runPublishWorker } from "@/lib/publish/worker";
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";
import {
  getIndependentDraftDesigns,
  hasAiTitle,
} from "@/lib/wizard/publish-units";

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
  wizardDraftDesignId: string | null;
  designId: string | null;
  publishJobs?: Array<{ stage: string; status: string }>;
};

function hasRunningPublishJob(listing: ExistingListingForPublish): boolean {
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

  const listings: PublishListingResponse[] = [];
  const workersToStart: Array<{ listingId: string }> = [];

  const independentDraftDesigns = getIndependentDraftDesigns(selectedDraftDesigns, draft.designPairs);

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

  for (const pair of draft.designPairs) {
    const pairContent = pair.aiContent as {
      title?: string;
      description?: string;
      tags?: string[];
      collections?: string[];
    };

    const existingListing = await prisma.listing.findUnique({
      where: { wizardDraftDesignPairId: pair.id },
      include: { publishJobs: { select: { stage: true, status: true } } },
    });

    if (existingListing) {
      const retryExisting = shouldRetryExistingListing(existingListing);
      listings.push({
        listingId: existingListing.id,
        designPairId: pair.id,
        draftDesignId: existingListing.wizardDraftDesignId ?? null,
        designId: existingListing.designId ?? pair.lightDesign.designId,
        designName: pair.baseName,
        status: statusForExistingListing(existingListing),
        alreadyPublished: !retryExisting,
      });
      if (retryExisting) workersToStart.push({ listingId: existingListing.id });
      continue;
    }

    const listing = await prisma.listing.create({
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
        publishJobs: {
          create: [
            {
              idempotencyKey: `${generateIdempotencyKey(draftId, session.tenantId, pair.id)}-shopify`,
              stage: "SHOPIFY",
            },
            {
              idempotencyKey: `${generateIdempotencyKey(draftId, session.tenantId, pair.id)}-printify`,
              stage: "PRINTIFY",
            },
          ],
        },
      },
    });

    listings.push({
      listingId: listing.id,
      designPairId: pair.id,
      draftDesignId: listing.wizardDraftDesignId ?? null,
      designId: pair.lightDesign.designId,
      designName: pair.baseName,
      status: "PUBLISHING",
      alreadyPublished: false,
    });
    workersToStart.push({ listingId: listing.id });
  }

  for (const draftDesign of independentDraftDesigns) {
    const independentContent = draftDesign.aiContent as {
      title?: string;
      description?: string;
      tags?: string[];
      collections?: string[];
    };

    const existingListing = await prisma.listing.findUnique({
      where: { wizardDraftDesignId: draftDesign.id },
      include: { publishJobs: { select: { stage: true, status: true } } },
    });

    if (existingListing) {
      const retryExisting = shouldRetryExistingListing(existingListing);
      listings.push({
        listingId: existingListing.id,
        designPairId: null,
        draftDesignId: existingListing.wizardDraftDesignId ?? null,
        designId: existingListing.designId ?? draftDesign.designId,
        designName: draftDesign.design?.name ?? "Design",
        status: statusForExistingListing(existingListing),
        alreadyPublished: !retryExisting,
      });
      if (retryExisting) workersToStart.push({ listingId: existingListing.id });
      continue;
    }

    const listing = await prisma.listing.create({
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
        publishJobs: {
          create: [
            {
              idempotencyKey: `${generateIdempotencyKey(draftId, session.tenantId, draftDesign.id)}-shopify`,
              stage: "SHOPIFY",
            },
            {
              idempotencyKey: `${generateIdempotencyKey(draftId, session.tenantId, draftDesign.id)}-printify`,
              stage: "PRINTIFY",
            },
          ],
        },
      },
    });

    listings.push({
      listingId: listing.id,
      designPairId: null,
      draftDesignId: listing.wizardDraftDesignId ?? null,
      designId: draftDesign.designId,
      designName: draftDesign.design?.name ?? "Design",
      status: "PUBLISHING",
      alreadyPublished: false,
    });
    workersToStart.push({ listingId: listing.id });
  }

  await prisma.wizardDraft.update({
    where: { id: draftId },
    data: { status: "PUBLISHED" },
  });

  void runPublishWorkersWithConcurrency({
    workers: workersToStart,
    draftId,
    tenantId: session.tenantId,
  });

  return NextResponse.json({ listings });
}

async function runPublishWorkersWithConcurrency(input: {
  workers: Array<{ listingId: string }>;
  draftId: string;
  tenantId: string;
}) {
  let index = 0;
  async function runNext(): Promise<void> {
    const worker = input.workers[index];
    index += 1;
    if (!worker) return;

    try {
      await runPublishWorker({
        listingId: worker.listingId,
        draftId: input.draftId,
        tenantId: input.tenantId,
      });
    } catch (err) {
      console.error(`[Publish API] Worker error for listing ${worker.listingId}:`, err);
    }

    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(3, input.workers.length) }, () => runNext()));
}
