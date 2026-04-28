/**
 * Wizard draft state management — server-side CRUD
 */

import { prisma } from "@/lib/db";
import { Prisma, type DraftStatus } from "@prisma/client";
import { deleteDraftWithPrintifyCleanup } from "./cleanup";

export interface DraftPatch {
  designId?: string | null;
  storeId?: string | null;
  enabledColorIds?: string[];
  enabledSizes?: string[];
  enabledVariantIdsOverride?: number[];
  placementOverride?: unknown | null;
  aiContent?: unknown | null;
  currentStep?: number;
  status?: DraftStatus;
}

const draftPatchKeys = [
  "designId",
  "storeId",
  "enabledColorIds",
  "enabledSizes",
  "enabledVariantIdsOverride",
  "placementOverride",
  "aiContent",
  "currentStep",
  "status",
] as const;

export function sanitizeDraftPatch(patch: DraftPatch | Record<string, unknown>): DraftPatch {
  const sanitized: Record<string, unknown> = {};
  const source = patch as Record<string, unknown>;

  for (const key of draftPatchKeys) {
    if (source[key] !== undefined) {
      sanitized[key] = source[key];
    }
  }

  return sanitized as DraftPatch;
}

export async function createDraft(tenantId: string) {
  return prisma.wizardDraft.create({
    data: { tenantId },
  });
}

export async function getDraft(id: string, tenantId: string) {
  return prisma.wizardDraft.findFirst({
    where: { id, tenantId },
    include: {
      design: true,
      store: {
        include: {
          colors: {
            orderBy: { sortOrder: "asc" },
          },
          template: true,
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

export async function updateDraft(id: string, tenantId: string, patch: DraftPatch) {
  // Verify ownership
  const draft = await prisma.wizardDraft.findFirst({
    where: { id, tenantId },
  });
  if (!draft) throw new Error("Draft not found");

  const sanitized = sanitizeDraftPatch(patch);

  return prisma.wizardDraft.update({
    where: { id },
    data: {
      ...sanitized,
      placementOverride: sanitized.placementOverride !== undefined
        ? sanitized.placementOverride === null
          ? Prisma.JsonNull
          : (sanitized.placementOverride as Prisma.InputJsonValue)
        : undefined,
      aiContent: sanitized.aiContent !== undefined
        ? sanitized.aiContent === null
          ? Prisma.JsonNull
          : (sanitized.aiContent as Prisma.InputJsonValue)
        : undefined,
    },
  });
}

export async function deleteDraft(id: string, tenantId: string) {
  return deleteDraftWithPrintifyCleanup(id, tenantId);
}

export async function listDrafts(tenantId: string) {
  return prisma.wizardDraft.findMany({
    where: {
      tenantId,
      status: { notIn: ["ABANDONED"] },
    },
    orderBy: { updatedAt: "desc" },
    include: {
      mockupJobs: {
        select: { id: true, status: true },
      },
    },
  });
}
