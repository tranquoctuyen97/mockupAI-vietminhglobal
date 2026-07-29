import { prisma } from "@/lib/db";
import type { NormalizedWizard } from "@/lib/wizard/contracts";
import { getNormalizedWizard } from "@/lib/wizard/query";
import {
  assertWizardRevisionToken,
  createWizardRevisionToken,
  type WizardRevisionPayload,
} from "@/lib/wizard/revision";
import { submitWizardPublish } from "@/lib/wizard/publish-submission";
import type { McpAuthContext } from "../contracts";
import type { McpToolPayload } from "./discovery";

type ReviewInput = {
  draftId: string;
  includePreview?: boolean;
  includePublishPlan?: boolean;
};
type PublishInput = {
  draftId: string;
  revisionToken: string;
};
type StatusSelector = {
  draftId?: string;
  listingId?: string;
  publishAttemptId?: string;
};
type PublishStatus = {
  overallStatus: "PUBLISHING" | "ACTIVE" | "PARTIAL_FAILURE" | "FAILED";
  listings: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  nextRetryAt: string | null;
};

type ReviewPublishDependencies = {
  getWizard(input: {
    tenantId: string;
    draftId: string;
  }): Promise<NormalizedWizard>;
  createRevision(
    tenantId: string,
    draftId: string,
  ): Promise<{ token: string; payload: WizardRevisionPayload }>;
  assertRevision(token: string, tenantId: string, draftId: string): Promise<void>;
  submitPublish(input: {
    tenantId: string;
    actorUserId: string;
    draftId: string;
  }): ReturnType<typeof submitWizardPublish>;
  getPreview(
    tenantId: string,
    draftId: string,
  ): Promise<Array<Record<string, unknown>>>;
  getStatus(tenantId: string, selector: StatusSelector): Promise<PublishStatus>;
};

export function buildReviewPublishUnits(wizard: {
  designs: Array<Record<string, unknown>>;
  designPairs: Array<Record<string, unknown>>;
}) {
  const pairedIds = new Set(
    wizard.designPairs.flatMap((pair) => [
      String(pair.lightDraftDesignId),
      String(pair.darkDraftDesignId),
    ]),
  );
  return [
    ...wizard.designPairs.map((pair) => ({
      type: "PAIR" as const,
      id: String(pair.id),
      name: String(pair.baseName),
      draftDesignIds: [
        String(pair.lightDraftDesignId),
        String(pair.darkDraftDesignId),
      ],
    })),
    ...wizard.designs
      .filter((design) => !pairedIds.has(String(design.draftDesignId)))
      .map((design) => ({
        type: "DESIGN" as const,
        id: String(design.draftDesignId),
        name: String(design.name),
        draftDesignIds: [String(design.draftDesignId)],
      })),
  ];
}

async function loadReviewPreview(
  tenantId: string,
  draftId: string,
): Promise<Array<Record<string, unknown>>> {
  const images = await prisma.mockupImage.findMany({
    where: {
      included: true,
      mockupJob: {
        draftId,
        draft: { tenantId },
      },
    },
    orderBy: [
      { mockupJob: { createdAt: "desc" } },
      { sortOrder: "asc" },
    ],
    select: {
      id: true,
      mockupJobId: true,
      colorName: true,
      viewPosition: true,
      compositeUrl: true,
      compositeStatus: true,
      included: true,
      isDefault: true,
      sortOrder: true,
    },
  });
  return images;
}

function aggregateListingStatus(
  statuses: string[],
): PublishStatus["overallStatus"] {
  if (statuses.some((status) => status === "PUBLISHING")) return "PUBLISHING";
  if (statuses.some((status) => status === "PARTIAL_FAILURE")) {
    return "PARTIAL_FAILURE";
  }
  if (statuses.length > 0 && statuses.every((status) => status === "ACTIVE")) {
    return "ACTIVE";
  }
  return "FAILED";
}

async function getPersistedPublishStatus(
  tenantId: string,
  selector: StatusSelector,
): Promise<PublishStatus> {
  const provided = [
    selector.draftId,
    selector.listingId,
    selector.publishAttemptId,
  ].filter(Boolean);
  if (provided.length !== 1) {
    throw new Error(
      "Exactly one of draftId, listingId, or publishAttemptId is required",
    );
  }
  const listings = await prisma.listing.findMany({
    where: {
      tenantId,
      ...(selector.draftId ? { wizardDraftId: selector.draftId } : {}),
      ...(selector.listingId ? { id: selector.listingId } : {}),
      ...(selector.publishAttemptId
        ? {
            publishAttempts: {
              some: { id: selector.publishAttemptId },
            },
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      wizardDraftId: true,
      wizardDraftDesignId: true,
      wizardDraftDesignPairId: true,
      status: true,
      shopifyProductId: true,
      printifyProductId: true,
      activePublishAttemptId: true,
      publishedAt: true,
      publishAttempts: {
        orderBy: { attemptNo: "asc" },
        select: {
          id: true,
          attemptNo: true,
          status: true,
          startedAt: true,
          completedAt: true,
          jobs: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              stage: true,
              status: true,
              nextRetryAt: true,
              reasonCode: true,
              lastErrorCode: true,
              lastError: true,
            },
          },
        },
      },
    },
  });
  if (listings.length === 0) throw new Error("Publish resource not found");

  const attempts = listings.flatMap((listing) =>
    listing.publishAttempts.map(({ jobs: _jobs, ...attempt }) => ({
      ...attempt,
      listingId: listing.id,
      startedAt: attempt.startedAt?.toISOString() ?? null,
      completedAt: attempt.completedAt?.toISOString() ?? null,
    })),
  );
  const jobs = listings.flatMap((listing) =>
    listing.publishAttempts.flatMap((attempt) =>
      attempt.jobs.map((job) => ({
        ...job,
        listingId: listing.id,
        publishAttemptId: attempt.id,
        nextRetryAt: job.nextRetryAt?.toISOString() ?? null,
      })),
    ),
  );
  const retryDates = listings.flatMap((listing) =>
    listing.publishAttempts.flatMap((attempt) =>
      attempt.jobs.flatMap((job) => (job.nextRetryAt ? [job.nextRetryAt] : [])),
    ),
  );
  return {
    overallStatus: aggregateListingStatus(
      listings.map((listing) => listing.status),
    ),
    listings: listings.map(({ publishAttempts: _attempts, ...listing }) => ({
      ...listing,
      publishedAt: listing.publishedAt?.toISOString() ?? null,
    })),
    attempts,
    jobs,
    nextRetryAt:
      retryDates.length > 0
        ? new Date(
            Math.min(...retryDates.map((date) => date.getTime())),
          ).toISOString()
        : null,
  };
}

export function createReviewPublishToolService(
  dependencies: ReviewPublishDependencies,
) {
  async function review(auth: McpAuthContext, input: ReviewInput) {
    const wizard = await dependencies.getWizard({
      tenantId: auth.tenantId,
      draftId: input.draftId,
    });
    const revision = await dependencies.createRevision(
      auth.tenantId,
      input.draftId,
    );
    return {
      draftId: input.draftId,
      revisionToken: revision.token,
      reviewedAt: revision.payload.reviewedAt,
      readyToPublish: wizard.checklist.readyToPublish,
      checklist: wizard.checklist,
      preview:
        input.includePreview === false
          ? []
          : await dependencies.getPreview(auth.tenantId, input.draftId),
      publishUnits:
        input.includePublishPlan === false
          ? []
          : buildReviewPublishUnits(wizard),
      warnings: wizard.warnings,
    };
  }

  async function publish(auth: McpAuthContext, input: PublishInput) {
    await dependencies.assertRevision(
      input.revisionToken,
      auth.tenantId,
      input.draftId,
    );
    const result = await dependencies.submitPublish({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      draftId: input.draftId,
    });
    return {
      draftId: result.draftId,
      overallStatus: result.submissions.every(
        (submission) => submission.status === "ACTIVE",
      )
        ? "ACTIVE"
        : "PUBLISHING",
      submissions: result.submissions,
    };
  }

  async function status(auth: McpAuthContext, selector: StatusSelector) {
    return dependencies.getStatus(auth.tenantId, selector);
  }

  return { review, publish, status };
}

const reviewPublishService = createReviewPublishToolService({
  getWizard: getNormalizedWizard,
  createRevision: createWizardRevisionToken,
  assertRevision: assertWizardRevisionToken,
  submitPublish: submitWizardPublish,
  getPreview: loadReviewPreview,
  getStatus: getPersistedPublishStatus,
});

export async function executeReviewPublishTool(
  name: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
): Promise<McpToolPayload | null> {
  if (name === "review_wizard") {
    const result = await reviewPublishService.review(auth, {
      draftId: String(args.draftId),
      includePreview: args.includePreview as boolean,
      includePublishPlan: args.includePublishPlan as boolean,
    });
    return {
      data: result,
      warnings: result.warnings,
      nextActions: result.readyToPublish
        ? ["Ask the user to approve this exact review", "publish_listing"]
        : ["get_listing_wizard", "set_wizard_content", "generate_wizard_assets"],
    };
  }
  if (name === "publish_listing") {
    const result = await reviewPublishService.publish(auth, {
      draftId: String(args.draftId),
      revisionToken: String(args.revisionToken),
    });
    return {
      data: result,
      warnings: [],
      nextActions: ["get_publish_status"],
    };
  }
  if (name === "get_publish_status") {
    const result = await reviewPublishService.status(auth, {
      draftId: args.draftId as string | undefined,
      listingId: args.listingId as string | undefined,
      publishAttemptId: args.publishAttemptId as string | undefined,
    });
    return {
      data: {
        ...result,
        jobs: args.includeJobs === false ? [] : result.jobs,
      },
      warnings: [],
      nextActions:
        result.overallStatus === "PUBLISHING"
          ? ["get_publish_status"]
          : [],
    };
  }
  return null;
}
