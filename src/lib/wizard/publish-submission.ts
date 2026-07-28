import { Prisma } from "@prisma/client";
import { formatDescriptionHtml } from "@/lib/content/description-html";
import { prisma } from "@/lib/db";
import { normalizeMoneyValue, resolveBaseTemplatePrice } from "@/lib/pricing/template-pricing";
import { buildChecklist, type WizardChecklist } from "@/lib/wizard/checklist";
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

export type PublishSubmissionInput = {
  tenantId: string;
  actorUserId: string;
  draftId: string;
  priceUsd?: number | string | null;
};

export type PublishSubmission = {
  listingId: string;
  publishAttemptId: string | null;
  pairId: string | null;
  draftDesignId: string | null;
  designId: string;
  designName: string;
  status: string;
  alreadyPublished: boolean;
};

export class PublishSubmissionError extends Error {
  constructor(
    public readonly code: "RESOURCE_NOT_FOUND" | "VALIDATION_FAILED" | "CHECKLIST_NOT_READY",
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PublishSubmissionError";
  }
}

type PublishSubmissionDependencies = {
  loadDraft(input: PublishSubmissionInput): Promise<any | null>;
  buildChecklist(draft: any): Promise<WizardChecklist>;
  executeTransaction(input: PublishSubmissionInput, draft: any): Promise<PublishSubmission[]>;
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

function isTerminalListingStatus(status: string): boolean {
  return ["ACTIVE", "FAILED", "PARTIAL_FAILURE"].includes(status);
}

function hasRunningPublishJob(listing: ExistingListingForPublish): boolean {
  if (isTerminalListingStatus(listing.status)) return false;
  if (listing.activePublishAttemptId) return true;
  return Boolean(
    listing.publishJobs?.some((job) =>
      ["PENDING", "RUNNING", "RETRY_SCHEDULED"].includes(job.status),
    ),
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
  const previousJob = latestSucceededJobForStage(input.listing, input.stage);
  if (previousJob?.status !== "SUCCEEDED") return false;

  if (input.stage === "SHOPIFY") {
    return Boolean(input.listing.shopifyProductId);
  }
  return Boolean(input.listing.printifyProductId);
}

function latestSucceededJobForStage(
  listing: ExistingListingForPublish,
  stage: "SHOPIFY" | "PRINTIFY",
): NonNullable<ExistingListingForPublish["publishJobs"]>[number] | null {
  return (
    listing.publishJobs?.find(
      (job) =>
        job.stage === stage &&
        job.status === "SUCCEEDED" &&
        (stage === "SHOPIFY" ? listing.shopifyProductId : listing.printifyProductId),
    ) ?? null
  );
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
  const shopifyResumeFromAttemptId =
    shopifyStatus === "SUCCEEDED"
      ? latestSucceededJobForStage(input.listing, "SHOPIFY")?.publishAttemptId
      : null;
  const printifyResumeFromAttemptId =
    printifyStatus === "SUCCEEDED"
      ? latestSucceededJobForStage(input.listing, "PRINTIFY")?.publishAttemptId
      : null;
  const resumedFromAttemptId = shopifyResumeFromAttemptId ?? printifyResumeFromAttemptId ?? null;

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
        progressData: shopifyResumeFromAttemptId
          ? { resumedFromAttemptId: shopifyResumeFromAttemptId }
          : Prisma.DbNull,
      },
      {
        listingId: input.listing.id,
        publishAttemptId: attempt.id,
        idempotencyKey: `${input.listing.id}:${attempt.id}:PRINTIFY`,
        stage: "PRINTIFY",
        status: printifyStatus,
        completedAt: printifyStatus === "SUCCEEDED" ? new Date() : null,
        progressData: printifyResumeFromAttemptId
          ? { resumedFromAttemptId: printifyResumeFromAttemptId }
          : Prisma.DbNull,
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

async function loadPublishDraft(input: PublishSubmissionInput) {
  return prisma.wizardDraft.findFirst({
    where: { id: input.draftId, tenantId: input.tenantId },
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
      store: {
        include: {
          colors: true,
          templates: {
            orderBy: { sortOrder: "asc" },
          },
        },
      },
      mockupJobs: {
        orderBy: { createdAt: "asc" },
        include: {
          images: {
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });
}

export function createPublishSubmissionService(deps: PublishSubmissionDependencies): (
  input: PublishSubmissionInput,
) => Promise<{
  draftId: string;
  submissions: PublishSubmission[];
}> {
  return async (input) => {
    const draft = await deps.loadDraft(input);
    if (!draft) {
      throw new PublishSubmissionError("RESOURCE_NOT_FOUND", "Draft not found", 404);
    }

    const checklist = await deps.buildChecklist(draft);
    if (!checklist.readyToPublish) {
      throw new PublishSubmissionError(
        "CHECKLIST_NOT_READY",
        "Wizard is not ready to publish",
        409,
        { checklist },
      );
    }

    const submissions = await deps.executeTransaction(input, draft);
    return {
      draftId: input.draftId,
      submissions,
    };
  };
}

async function executePublishTransaction(
  input: PublishSubmissionInput,
  draft: any,
): Promise<PublishSubmission[]> {
  const draftId = input.draftId;

  if (!draft.storeId) {
    throw new PublishSubmissionError("VALIDATION_FAILED", "Store not selected", 400);
  }

  if (!draft.store) {
    throw new PublishSubmissionError(
      "VALIDATION_FAILED",
      "Store không tồn tại. Vui lòng chọn lại store.",
      400,
    );
  }

  const selectedDraftDesigns = resolveSelectedDraftDesigns(draft);
  if (selectedDraftDesigns.length === 0) {
    throw new PublishSubmissionError("VALIDATION_FAILED", "Design not selected", 400);
  }

  let template = draft.template;
  if (!template && draft.storeId) {
    template = await prisma.storeMockupTemplate.findFirst({
      where: { storeId: draft.storeId, isDefault: true },
    });
  }

  const priceUsd =
    normalizeMoneyValue(input.priceUsd) ??
    resolveBaseTemplatePrice({
      templateBasePriceUsd: template?.basePriceUsd,
      storeDefaultPriceUsd: draft.store?.defaultPriceUsd,
    });

  const colors =
    draft.store?.colors
      ?.filter((c: { id: string }) => (draft.enabledColorIds ?? []).includes(c.id))
      .map((c: { name: string; hex: string }) => ({
        name: c.name,
        hex: c.hex,
      })) || [];

  const independentDraftDesigns = getIndependentDraftDesigns(
    selectedDraftDesigns,
    draft.designPairs,
  );

  const pairMissingContent = draft.designPairs.find(
    (pair: { aiContent?: unknown }) => !hasAiTitle(pair.aiContent),
  );
  if (pairMissingContent) {
    throw new PublishSubmissionError(
      "VALIDATION_FAILED",
      `Thiếu nội dung cho cặp ${pairMissingContent.baseName || pairMissingContent.id}`,
      400,
    );
  }

  const independentMissingContent = independentDraftDesigns.find(
    (draftDesign) => !hasAiTitle(draftDesign.aiContent),
  );
  if (independentMissingContent) {
    throw new PublishSubmissionError(
      "VALIDATION_FAILED",
      `Thiếu nội dung cho design ${
        independentMissingContent.design?.name || independentMissingContent.id
      }`,
      400,
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.tenantId}), hashtext(${draftId}))`,
    );

    const createdListings: PublishSubmission[] = [];

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
          publishJobs: {
            select: { stage: true, status: true, publishAttemptId: true },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (existingListing) {
        const retryExisting = shouldRetryExistingListing(existingListing);
        let publishAttemptId = hasRunningPublishJob(existingListing)
          ? (existingListing.activePublishAttemptId ?? null)
          : null;
        if (retryExisting) {
          const attempt = await createPublishAttemptForListing({
            tx,
            listing: existingListing,
            draftId,
            tenantId: input.tenantId,
          });
          publishAttemptId = attempt.id;
        }
        createdListings.push({
          listingId: existingListing.id,
          publishAttemptId,
          pairId: pair.id,
          draftDesignId: existingListing.wizardDraftDesignId ?? null,
          designId: existingListing.designId ?? pair.lightDesign.designId,
          designName: pair.baseName,
          status: statusForExistingListing(existingListing),
          alreadyPublished: !retryExisting,
        });
        continue;
      }

      const listing = await tx.listing.create({
        data: {
          tenantId: input.tenantId,
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
          createdBy: input.actorUserId,
          variants: {
            create: colors.map((c: { name: string; hex: string }) => ({
              colorName: c.name,
              colorHex: c.hex,
            })),
          },
        },
      });

      const attempt = await createPublishAttemptForListing({
        tx,
        listing: { ...listing, publishJobs: [], publishAttempts: [] },
        draftId,
        tenantId: input.tenantId,
      });

      createdListings.push({
        listingId: listing.id,
        publishAttemptId: attempt.id,
        pairId: pair.id,
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
          publishJobs: {
            select: { stage: true, status: true, publishAttemptId: true },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (existingListing) {
        const retryExisting = shouldRetryExistingListing(existingListing);
        let publishAttemptId = hasRunningPublishJob(existingListing)
          ? (existingListing.activePublishAttemptId ?? null)
          : null;
        if (retryExisting) {
          const attempt = await createPublishAttemptForListing({
            tx,
            listing: existingListing,
            draftId,
            tenantId: input.tenantId,
          });
          publishAttemptId = attempt.id;
        }
        createdListings.push({
          listingId: existingListing.id,
          publishAttemptId,
          pairId: null,
          draftDesignId: existingListing.wizardDraftDesignId ?? null,
          designId: existingListing.designId ?? draftDesign.designId,
          designName: draftDesign.design?.name ?? "Design",
          status: statusForExistingListing(existingListing),
          alreadyPublished: !retryExisting,
        });
        continue;
      }

      const listing = await tx.listing.create({
        data: {
          tenantId: input.tenantId,
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
          createdBy: input.actorUserId,
          variants: {
            create: colors.map((c: { name: string; hex: string }) => ({
              colorName: c.name,
              colorHex: c.hex,
            })),
          },
        },
      });

      const attempt = await createPublishAttemptForListing({
        tx,
        listing: { ...listing, publishJobs: [], publishAttempts: [] },
        draftId,
        tenantId: input.tenantId,
      });

      createdListings.push({
        listingId: listing.id,
        publishAttemptId: attempt.id,
        pairId: null,
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
}

const defaultPublishSubmissionService = createPublishSubmissionService({
  loadDraft: loadPublishDraft,
  buildChecklist,
  executeTransaction: executePublishTransaction,
});

export async function submitWizardPublish(
  input: PublishSubmissionInput,
): Promise<{ draftId: string; submissions: PublishSubmission[] }> {
  return defaultPublishSubmissionService(input);
}
