/**
 * Wizard draft state management — server-side CRUD
 */

import { Prisma, type DraftStatus } from "@prisma/client";
import { pairDesigns } from "@/lib/designs/design-pairing";
import { prisma } from "@/lib/db";
import { buildTemplateMockupPickPlan } from "@/lib/mockup/template-mockup-matching";
import { deleteDraftWithPrintifyCleanup } from "./cleanup";
import {
  buildPairRowsFromDraftDesigns,
  stablePairKey,
} from "./design-pairs";
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
  // Per-color sizes: { colorName → string[] }
  enabledSizesByColor?: Record<string, string[]> | null;
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
  "enabledSizesByColor",
  "enabledVariantIdsOverride",
  "placementOverride",
  "aiContent",
  "currentStep",
  "status",
  "mockupsStale",
  "mockupsStaleReason",
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
    relationLoadStrategy: "join", // PostgreSQL LATERAL JOIN — 1 query instead of N+1
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
      designPairs: {
        orderBy: { sortOrder: "asc" },
        include: {
          lightDesign: { include: { design: true } },
          darkDesign: { include: { design: true } },
          listing: true,
        },
      },
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

  return prisma.$transaction(async (tx) => {
    const legacyDesignId =
      nextDesignIds !== undefined ? nextDesignIds[0] ?? null : undefined;

    if (nextDesignIds !== undefined && nextDesignIds.length > 0) {
      if (!draft.storeId) {
        throw new Error("Select a store before selecting designs");
      }

      const selectedDesigns = await tx.design.findMany({
        where: {
          id: { in: nextDesignIds },
          tenantId,
          storeId: draft.storeId,
          status: "ACTIVE",
          deletedAt: null,
        },
        select: { id: true },
      });

      if (selectedDesigns.length !== nextDesignIds.length) {
        throw new Error("Selected designs not found for draft store");
      }
    }

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
        // Per-color size map
        enabledSizesByColor: sanitized.enabledSizesByColor !== undefined
          ? sanitized.enabledSizesByColor === null
            ? Prisma.JsonNull
            : (sanitized.enabledSizesByColor as Prisma.InputJsonValue)
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

      const selectedDraftDesigns = await tx.wizardDraftDesign.findMany({
        where: { draftId: id },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          designId: true,
          design: { select: { id: true, name: true } },
        },
      });
      const pairing = pairDesigns(
        selectedDraftDesigns.map((draftDesign) => ({
          id: draftDesign.design.id,
          name: draftDesign.design.name,
        })),
      );
      const pairRows = buildPairRowsFromDraftDesigns({
        pairing,
        draftDesigns: selectedDraftDesigns.map((draftDesign) => ({
          id: draftDesign.id,
          designId: draftDesign.designId,
        })),
      });
      const existingPairs = await tx.wizardDraftDesignPair.findMany({
        where: { draftId: id },
      });
      const existingByStableKey = new Map(
        existingPairs.map((pair) => [stablePairKey(pair), pair]),
      );
      const nextPairIds: string[] = [];
      const pairRowsToCreate: typeof pairRows = [];

      for (const pairRow of pairRows) {
        const existing = existingByStableKey.get(stablePairKey(pairRow));
        if (existing) {
          const saved = await tx.wizardDraftDesignPair.update({
            where: { id: existing.id },
            data: { sortOrder: pairRow.sortOrder },
          });
          nextPairIds.push(saved.id);
        } else {
          pairRowsToCreate.push(pairRow);
        }
      }

      await tx.wizardDraftDesignPair.deleteMany({
        where: {
          draftId: id,
          ...(nextPairIds.length > 0 ? { id: { notIn: nextPairIds } } : {}),
        },
      });

      for (const pairRow of pairRowsToCreate) {
        const saved = await tx.wizardDraftDesignPair.create({
          data: {
            draftId: id,
            ...pairRow,
          },
        });

        nextPairIds.push(saved.id);
      }
    }

    // ── Đồng bộ mockup library picks khi enabledColorIds thay đổi ──
    // Chỉ chạy khi template là CUSTOM (Printify không dùng picks)
    if (sanitized.enabledColorIds !== undefined) {
      const activeTemplateId = sanitized.templateId ?? draft.templateId;
      if (activeTemplateId) {
        const tmpl = await tx.storeMockupTemplate.findUnique({
          where: { id: activeTemplateId },
          select: { defaultMockupSource: true },
        });

        if (tmpl?.defaultMockupSource === "CUSTOM") {
          const templateMockupItems = await tx.templateMockupItem.findMany({
            where: {
              templateId: activeTemplateId,
              mockup: { renderMode: "COMPOSITE", isActive: true, deletedAt: null },
            },
            select: {
              id: true, appliesToColorIds: true,
              sortOrder: true, isPrimary: true, createdAt: true,
            },
          });

          const existingPicks = await tx.wizardDraftMockupLibraryPick.findMany({
            where: { draftId: id },
            select: { id: true, templateMockupItemId: true, colorId: true, compositeRegionPx: true },
          });

          const plan = buildTemplateMockupPickPlan({
            selectedColorIds: sanitized.enabledColorIds,
            templateMockupItems,
            existingPicks,
          });

          if (plan.deleteIds.length > 0) {
            await tx.wizardDraftMockupLibraryPick.deleteMany({
              where: { id: { in: plan.deleteIds } },
            });
          }
          for (const entry of plan.update) {
            await tx.wizardDraftMockupLibraryPick.update({
              where: { id: entry.id },
              data: { sortOrder: entry.sortOrder, isPrimary: entry.isPrimary },
            });
          }
          if (plan.create.length > 0) {
            await tx.wizardDraftMockupLibraryPick.createMany({
              data: plan.create.map((e) => ({
                draftId: id,
                templateMockupItemId: e.templateMockupItemId,
                colorId: e.colorId,
                sortOrder: e.sortOrder,
                isPrimary: e.isPrimary,
              })),
            });
          }
        }
      }
    }

    return tx.wizardDraft.findUniqueOrThrow({
      where: { id },
      include: {
        designPairs: {
          orderBy: { sortOrder: "asc" },
          include: {
            lightDesign: { include: { design: true } },
            darkDesign: { include: { design: true } },
            listing: true,
          },
        },
        draftDesigns: draftDesignsWithRelationsInclude,
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
    select: {
      id: true,
      currentStep: true,
      status: true,
      updatedAt: true,
      designId: true,
      storeId: true,
      templateId: true,
      enabledColorIds: true,
      mockupsStale: true,
      mockupSourceMode: true,
      mockupJobs: {
        select: { id: true, status: true },
      },
    },
  });
}
