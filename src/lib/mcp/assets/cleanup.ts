import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_MOCKUP_STATUSES = new Set(["pending", "running", "processing"]);
const ACTIVE_LISTING_STATUSES = new Set(["PUBLISHING"]);
const ACTIVE_PUBLISH_STATUSES = new Set(["PENDING", "RUNNING", "RETRY_SCHEDULED"]);

export type TemporaryAssetRetentionInput = {
  attached: boolean;
  expiresAt: Date;
  draftStatus: string | null;
  draftUpdatedAt: Date | null;
  mockupJobStatuses: string[];
  listingStatuses: string[];
  publishStatuses: string[];
  terminalAt: Date | null;
};

export type TemporaryAssetRetentionDecision = {
  delete: boolean;
  reason:
    | "not_expired"
    | "active_work"
    | "unattached_expired"
    | "terminal_publish_7d"
    | "draft_inactive_30d"
    | "retained";
};

export function shouldDeleteTemporaryAsset(
  asset: TemporaryAssetRetentionInput,
  now = new Date(),
): TemporaryAssetRetentionDecision {
  const hasActiveWork =
    asset.draftStatus === "GENERATING" ||
    asset.mockupJobStatuses.some((status) => ACTIVE_MOCKUP_STATUSES.has(status.toLowerCase())) ||
    asset.listingStatuses.some((status) => ACTIVE_LISTING_STATUSES.has(status.toUpperCase())) ||
    asset.publishStatuses.some((status) => ACTIVE_PUBLISH_STATUSES.has(status.toUpperCase()));
  if (hasActiveWork) return { delete: false, reason: "active_work" };
  if (asset.expiresAt.getTime() > now.getTime()) {
    return { delete: false, reason: "not_expired" };
  }
  if (!asset.attached) {
    return { delete: true, reason: "unattached_expired" };
  }

  if (
    asset.terminalAt &&
    asset.listingStatuses.length > 0 &&
    asset.terminalAt.getTime() <= now.getTime() - 7 * DAY_MS
  ) {
    return { delete: true, reason: "terminal_publish_7d" };
  }

  if (
    asset.draftUpdatedAt &&
    ["DRAFT", "READY", "ABANDONED"].includes(asset.draftStatus ?? "") &&
    asset.draftUpdatedAt.getTime() <= now.getTime() - 30 * DAY_MS
  ) {
    return { delete: true, reason: "draft_inactive_30d" };
  }
  return { delete: false, reason: "retained" };
}

export async function purgeStorageThenRecord(input: {
  paths: string[];
  deleteStorage(path: string): Promise<void>;
  deleteRecord(): Promise<void>;
}): Promise<{ deleted: boolean; error: string | null }> {
  try {
    for (const path of input.paths) {
      await input.deleteStorage(path);
    }
  } catch (error) {
    return {
      deleted: false,
      error: error instanceof Error ? error.message : "Storage deletion failed",
    };
  }
  await input.deleteRecord();
  return { deleted: true, error: null };
}

type DraftRetentionShape = {
  status: string;
  updatedAt: Date;
  mockupJobs: Array<{ status: string }>;
  listings: Array<{
    status: string;
    createdAt: Date;
    publishedAt: Date | null;
    publishAttempts: Array<{
      status: string;
      completedAt: Date | null;
      jobs: Array<{ status: string; completedAt: Date | null }>;
    }>;
  }>;
};

function latestDate(values: Array<Date | null | undefined>): Date | null {
  const dates = values.filter((value): value is Date => value instanceof Date);
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((value) => value.getTime())));
}

function retentionForDraft(
  draft: DraftRetentionShape,
  expiresAt: Date,
): TemporaryAssetRetentionInput {
  return {
    attached: true,
    expiresAt,
    draftStatus: draft.status,
    draftUpdatedAt: draft.updatedAt,
    mockupJobStatuses: draft.mockupJobs.map((job) => job.status),
    listingStatuses: draft.listings.map((listing) => listing.status),
    publishStatuses: draft.listings.flatMap((listing) =>
      listing.publishAttempts.flatMap((attempt) => [
        attempt.status,
        ...attempt.jobs.map((job) => job.status),
      ]),
    ),
    terminalAt: latestDate(
      draft.listings.flatMap((listing) => [
        listing.publishedAt,
        listing.createdAt,
        ...listing.publishAttempts.flatMap((attempt) => [
          attempt.completedAt,
          ...attempt.jobs.map((job) => job.completedAt),
        ]),
      ]),
    ),
  };
}

const draftRetentionInclude = {
  mockupJobs: { select: { status: true } },
  listings: {
    select: {
      status: true,
      createdAt: true,
      publishedAt: true,
      publishAttempts: {
        select: {
          status: true,
          completedAt: true,
          jobs: { select: { status: true, completedAt: true } },
        },
      },
    },
  },
} as const;

export async function cleanupMcpTemporaryAssets(now = new Date()): Promise<{
  designsDeleted: number;
  mockupsDeleted: number;
  storageErrors: string[];
}> {
  let designsDeleted = 0;
  let mockupsDeleted = 0;
  const storageErrors: string[] = [];
  const storage = getStorage();

  const unattached = await prisma.mcpAssetTransfer.findMany({
    where: {
      attachedResourceId: null,
      expiresAt: { lte: now },
    },
  });
  for (const transfer of unattached) {
    const result = await purgeStorageThenRecord({
      paths: [transfer.storagePath, transfer.previewPath].filter((path): path is string =>
        Boolean(path),
      ),
      deleteStorage: (path) => storage.delete(path),
      deleteRecord: async () => {
        await prisma.mcpAssetTransfer.delete({ where: { id: transfer.id } });
      },
    });
    if (!result.deleted) {
      storageErrors.push(`transfer:${transfer.id}: ${result.error}`);
      continue;
    }
    if (transfer.kind === "DESIGN") designsDeleted += 1;
    else mockupsDeleted += 1;
    await logAudit({
      tenantId: transfer.tenantId,
      action: "mcp.temporary_asset.purged",
      resourceType: "mcp_asset_transfer",
      resourceId: transfer.id,
      metadata: {
        kind: transfer.kind,
        reason: "unattached_expired",
      },
    });
  }

  const designs = await prisma.design.findMany({
    where: {
      scope: "TEMPORARY_MCP",
      expiresAt: { lte: now },
    },
    include: {
      draftDesigns: {
        include: {
          draft: { include: draftRetentionInclude },
        },
      },
    },
  });
  for (const design of designs) {
    const draft = design.draftDesigns[0]?.draft;
    if (!design.expiresAt || !draft) continue;
    const decision = shouldDeleteTemporaryAsset(retentionForDraft(draft, design.expiresAt), now);
    if (!decision.delete) continue;
    const result = await purgeStorageThenRecord({
      paths: [design.storagePath, design.previewPath].filter((path): path is string =>
        Boolean(path),
      ),
      deleteStorage: (path) => storage.delete(path),
      deleteRecord: async () => {
        await prisma.$transaction([
          prisma.design.delete({ where: { id: design.id } }),
          prisma.mcpAssetTransfer.deleteMany({
            where: { attachedResourceId: design.id },
          }),
        ]);
      },
    });
    if (!result.deleted) {
      storageErrors.push(`design:${design.id}: ${result.error}`);
      continue;
    }
    designsDeleted += 1;
    await logAudit({
      tenantId: design.tenantId,
      action: "mcp.temporary_asset.purged",
      resourceType: "design",
      resourceId: design.id,
      metadata: { kind: "DESIGN", reason: decision.reason },
    });
  }

  const mockups = await prisma.wizardDraftMockupSource.findMany({
    where: {
      storagePath: { not: null },
      expiresAt: { lte: now },
    },
    include: {
      draft: { include: draftRetentionInclude },
    },
  });
  for (const mockup of mockups) {
    if (!mockup.expiresAt || !mockup.storagePath) continue;
    const decision = shouldDeleteTemporaryAsset(
      retentionForDraft(mockup.draft, mockup.expiresAt),
      now,
    );
    if (!decision.delete) continue;
    const result = await purgeStorageThenRecord({
      paths: [mockup.storagePath],
      deleteStorage: (path) => storage.delete(path),
      deleteRecord: async () => {
        await prisma.$transaction([
          prisma.wizardDraftMockupSource.delete({
            where: { id: mockup.id },
          }),
          prisma.mcpAssetTransfer.deleteMany({
            where: { attachedResourceId: mockup.id },
          }),
        ]);
      },
    });
    if (!result.deleted) {
      storageErrors.push(`mockup:${mockup.id}: ${result.error}`);
      continue;
    }
    mockupsDeleted += 1;
    await logAudit({
      tenantId: mockup.draft.tenantId,
      action: "mcp.temporary_asset.purged",
      resourceType: "wizard_draft_mockup_source",
      resourceId: mockup.id,
      metadata: { kind: "MOCKUP", reason: decision.reason },
    });
  }

  return { designsDeleted, mockupsDeleted, storageErrors };
}
