/**
 * Wizard draft state management — server-side CRUD
 */

import { prisma } from "@/lib/db";
import type { DraftStatus } from "@prisma/client";

export interface DraftPatch {
  designId?: string;
  storeId?: string;
  productType?: string;
  blueprintId?: number;
  printProviderId?: number;
  selectedColors?: unknown;
  placement?: unknown;
  aiContent?: unknown;
  currentStep?: number;
  status?: DraftStatus;
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
      mockupJobs: {
        orderBy: { createdAt: "asc" },
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

  return prisma.wizardDraft.update({
    where: { id },
    data: {
      ...patch,
      selectedColors: patch.selectedColors !== undefined
        ? (patch.selectedColors as object)
        : undefined,
      placement: patch.placement !== undefined
        ? (patch.placement as object)
        : undefined,
      aiContent: patch.aiContent !== undefined
        ? (patch.aiContent as object)
        : undefined,
    },
  });
}

export async function deleteDraft(id: string, tenantId: string) {
  const draft = await prisma.wizardDraft.findFirst({
    where: { id, tenantId },
  });
  if (!draft) throw new Error("Draft not found");

  return prisma.wizardDraft.delete({ where: { id } });
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
