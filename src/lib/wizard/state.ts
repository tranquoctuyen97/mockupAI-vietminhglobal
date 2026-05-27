/**
 * Wizard draft state management — server-side CRUD
 */

import { prisma } from "@/lib/db";
import { Prisma, type DraftStatus } from "@prisma/client";
import { deleteDraftWithPrintifyCleanup } from "./cleanup";
import {
  getDraftDesignIds,
  normalizeDesignIds,
  sameDesignSelection,
} from "./design-selection";

export interface DraftPatch {
  designId?: string | null;
  designIds?: string[];
  storeId?: string | null;
  templateId?: string | null;
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
  "designIds",
  "storeId",
  "templateId",
  "enabledColorIds",
  "enabledSizes",
  "enabledVariantIdsOverride",
  "placementOverride",
  "aiContent",
  "currentStep",
  "status",
] as const;

const draftDesignsWithRelationsInclude = {
  orderBy: { sortOrder: "asc" },
  where: {
    design: {
      status: "ACTIVE",
      deletedAt: null,
    },
  },
  include: {
    design: true,
    jobs: {
      orderBy: { createdAt: "asc" },
      include: {
        images: {
          orderBy: { sortOrder: "asc" },
        },
      },
    },
  },
} satisfies Prisma.WizardDraft$draftDesignsArgs;

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
          templates: {
            orderBy: { sortOrder: "asc" },
          },
        },
      },
      template: true,
      draftDesigns: draftDesignsWithRelationsInclude,
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
    include: {
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        select: { designId: true, sortOrder: true },
      },
    },
  });
  if (!draft) throw new Error("Draft not found");

  const sanitized = sanitizeDraftPatch(patch);
  const {
    designId: sanitizedDesignId,
    designIds: sanitizedDesignIds,
    ...draftDataPatch
  } = sanitized;
  const nextDesignIds =
    sanitizedDesignIds !== undefined
      ? normalizeDesignIds(sanitizedDesignIds)
      : sanitizedDesignId !== undefined
        ? normalizeDesignIds(sanitizedDesignId === null ? [] : [sanitizedDesignId])
        : undefined;
  const currentDesignIds = getDraftDesignIds(draft);
  const designsChanged =
    nextDesignIds !== undefined && !sameDesignSelection(currentDesignIds, nextDesignIds);
  const templateChanged =
    sanitized.templateId !== undefined && sanitized.templateId !== draft.templateId;
  const enabledSizesChanged =
    sanitized.enabledSizes !== undefined &&
    JSON.stringify(sanitized.enabledSizes ?? []) !== JSON.stringify(draft.enabledSizes ?? []);
  const staleDraftPatch = templateChanged
    ? {
        mockupsStale: true,
        mockupsStaleReason: "template_changed",
      }
    : designsChanged
      ? {
          mockupsStale: true,
          mockupsStaleReason: "design_changed",
        }
    : enabledSizesChanged
      ? {
          mockupsStale: true,
          mockupsStaleReason: "colors_changed",
        }
      : {};

  if (sanitized.templateId) {
    const storeId = sanitized.storeId ?? draft.storeId;
    const template = await prisma.storeMockupTemplate.findFirst({
      where: {
        id: sanitized.templateId,
        storeId: storeId ?? undefined,
        store: { tenantId },
      },
      select: { id: true },
    });

    if (!template) {
      throw new Error("Template not found for draft store");
    }
  }

  if (nextDesignIds !== undefined && nextDesignIds.length > 0) {
    const selectedDesigns = await prisma.design.findMany({
      where: {
        id: { in: nextDesignIds },
        tenantId,
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { id: true },
    });

    if (selectedDesigns.length !== nextDesignIds.length) {
      throw new Error("Selected designs not found");
    }
  }

  return prisma.$transaction(async (tx) => {
    const legacyDesignId =
      nextDesignIds !== undefined ? nextDesignIds[0] ?? null : undefined;

    await tx.wizardDraft.update({
      where: { id },
      data: {
        ...draftDataPatch,
        ...staleDraftPatch,
        designId: legacyDesignId,
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

    // When template changes, clear cached Printify product IDs.
    // Old products belong to a different blueprint/provider — reusing them
    // via PUT would cause Printify error 8251 "Variants do not match".
    if (templateChanged) {
      await tx.wizardDraftDesign.updateMany({
        where: { draftId: id },
        data: { printifyDraftProductId: null },
      });
    }

    if (nextDesignIds !== undefined) {
      if (nextDesignIds.length > 0) {
        await tx.wizardDraftDesign.deleteMany({
          where: {
            draftId: id,
            designId: { notIn: nextDesignIds },
          },
        });
      } else {
        await tx.wizardDraftDesign.deleteMany({
          where: { draftId: id },
        });
      }

      for (const [sortOrder, designId] of nextDesignIds.entries()) {
        await tx.wizardDraftDesign.upsert({
          where: {
            draftId_designId: {
              draftId: id,
              designId,
            },
          },
          update: { sortOrder },
          create: {
            draftId: id,
            designId,
            sortOrder,
          },
        });
      }
    }

    return tx.wizardDraft.findUniqueOrThrow({
      where: { id },
      include: {
        draftDesigns: draftDesignsWithRelationsInclude,
        mockupJobs: {
          orderBy: { createdAt: "asc" as const },
          include: { images: { orderBy: { sortOrder: "asc" as const } } },
        },
      },
    });
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
