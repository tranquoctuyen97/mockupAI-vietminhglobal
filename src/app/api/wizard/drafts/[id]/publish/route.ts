/**
 * POST /api/wizard/drafts/:id/publish — Trigger publish pipeline
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { formatDescriptionHtml } from "@/lib/content/description-html";
import { prisma } from "@/lib/db";
import { generateIdempotencyKey, runPublishWorker } from "@/lib/publish/worker";
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";

type DraftDesignSelection = {
  id: string;
  designId: string;
  sortOrder: number;
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

function resolveSelectedDraftDesigns(draft: any): DraftDesignSelection[] {
  if (Array.isArray(draft.draftDesigns) && draft.draftDesigns.length > 0) {
    return [...draft.draftDesigns]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((entry) => ({
        id: entry.id,
        designId: entry.designId,
        sortOrder: entry.sortOrder ?? 0,
        design: entry.design ?? null,
      }));
  }

  if (!draft.designId) return [];

  return [
    {
      id: draft.designId,
      designId: draft.designId,
      sortOrder: 0,
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

  const aiContent = draft.aiContent as {
    title?: string;
    description?: string;
    tags?: string[];
    collections?: string[];
  } | null;
  if (!aiContent?.title) {
    return NextResponse.json({ error: "AI content not generated" }, { status: 400 });
  }

  const productType = template?.blueprintTitle || draft.store?.name || "T-Shirt";
  const pricingTemplate = await prisma.productPricingTemplate.findFirst({
    where: { tenantId: session.tenantId, productType },
  });
  const requestedPrice =
    typeof body.priceUsd === "number"
      ? body.priceUsd
      : typeof body.priceUsd === "string" && body.priceUsd.trim()
        ? Number(body.priceUsd)
        : null;
  const priceUsd = Number.isFinite(requestedPrice as number)
    ? (requestedPrice as number)
    : pricingTemplate?.basePriceUsd || draft.store?.defaultPriceUsd?.toNumber() || 24.99;

  const colors =
    draft.store?.colors
      ?.filter((c: any) => (draft.enabledColorIds ?? []).includes(c.id))
      .map((c: any) => ({
        name: c.name,
        hex: c.hex,
      })) || [];

  if (draft.designPairs.length > 0) {
    if (selectedDraftDesigns.length !== draft.designPairs.length * 2) {
      return NextResponse.json(
        { error: "Resolve unpaired light/dark designs before publishing" },
        { status: 400 },
      );
    }

    const listings: PublishListingResponse[] = [];
    const workersToStart: Array<{ listingId: string }> = [];

    for (const pair of draft.designPairs) {
      const pairContent = pair.aiContent as {
        title?: string;
        description?: string;
        tags?: string[];
        collections?: string[];
      } | null;

      if (!pairContent?.title) {
        return NextResponse.json(
          { error: `AI content not generated for ${pair.baseName}` },
          { status: 400 },
        );
      }

      const existingListing = await prisma.listing.findUnique({
        where: { wizardDraftDesignPairId: pair.id },
      });

      if (existingListing) {
        listings.push({
          listingId: existingListing.id,
          designPairId: pair.id,
          draftDesignId: existingListing.wizardDraftDesignId ?? null,
          designId: existingListing.designId ?? pair.lightDesign.designId,
          designName: pair.baseName,
          status: existingListing.status,
          alreadyPublished: true,
        });
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

  const hasDraftDesignRows = (draft.draftDesigns ?? []).length > 0;
  const listings: PublishListingResponse[] = [];
  const workersToStart: Array<{ listingId: string }> = [];

  for (const legacyDraftDesign of selectedDraftDesigns) {
    let existingListing = hasDraftDesignRows
      ? await prisma.listing.findFirst({
          where: { tenantId: session.tenantId, wizardDraftDesignId: legacyDraftDesign.id },
        })
      : null;

    if (!existingListing) {
      existingListing = await prisma.listing.findFirst({
        where: {
          tenantId: session.tenantId,
          wizardDraftId: draftId,
          designId: legacyDraftDesign.designId,
        },
      });
    }

    if (existingListing) {
      listings.push({
        listingId: existingListing.id,
        draftDesignId: existingListing.wizardDraftDesignId ?? null,
        designId: existingListing.designId ?? legacyDraftDesign.designId,
        designName: legacyDraftDesign.design?.name ?? "Design",
        status: existingListing.status,
        alreadyPublished: true,
      });
      continue;
    }

    const listing = await prisma.listing.create({
      data: {
        tenantId: session.tenantId,
        storeId: draft.storeId,
        designId: legacyDraftDesign.designId,
        templateId: template?.id || null,
        wizardDraftId: draftId,
        wizardDraftDesignId: hasDraftDesignRows ? legacyDraftDesign.id : null,
        title: aiContent.title || "",
        descriptionHtml: formatDescriptionHtml(aiContent.description),
        tags: aiContent.tags || [],
        organizationCollections: normalizeOrganizationCollections(aiContent.collections),
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
              idempotencyKey: `${generateIdempotencyKey(draftId, session.tenantId, legacyDraftDesign.id)}-shopify`,
              stage: "SHOPIFY",
            },
            {
              idempotencyKey: `${generateIdempotencyKey(draftId, session.tenantId, legacyDraftDesign.id)}-printify`,
              stage: "PRINTIFY",
            },
          ],
        },
      },
    });

    listings.push({
      listingId: listing.id,
      draftDesignId: listing.wizardDraftDesignId ?? null,
      designId: legacyDraftDesign.designId,
      designName: legacyDraftDesign.design?.name ?? "Design",
      status: "PUBLISHING",
      alreadyPublished: false,
    });
    workersToStart.push({ listingId: listing.id });
  }

  await prisma.wizardDraft.update({
    where: { id: draftId },
    data: { status: "PUBLISHED" },
  });

  void (async () => {
    for (const worker of workersToStart) {
      try {
        await runPublishWorker({
          listingId: worker.listingId,
          draftId,
          tenantId: session.tenantId,
        });
      } catch (err) {
        console.error(`[Publish API] Worker error for listing ${worker.listingId}:`, err);
      }
    }
  })();

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
