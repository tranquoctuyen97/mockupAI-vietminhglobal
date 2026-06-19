import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";
import { buildTemplateMockupPickPlan } from "@/lib/mockup/template-mockup-matching";

/**
 * GET /api/wizard/drafts/[id]/mockup-library-picks
 * Returns current picks for the draft, auto-populating when empty.
 *
 * When the draft has no picks yet and the template is CUSTOM,
 * the handler automatically creates picks from eligible template mockup items
 * using exact-then-generic color matching. This prevents a cold-start
 * scenario where Step 3 loads with all mockups unselected and
 * mockup generation fails with NO_CUSTOM_MOCKUP_SELECTED.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { id: draftId } = await params;

  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    select: {
      id: true,
      templateId: true,
      enabledColorIds: true,
      template: { select: { defaultMockupSource: true } },
    },
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const existingPicks = await prisma.wizardDraftMockupLibraryPick.findMany({
    where: { draftId },
    select: { id: true },
  });

  // Auto-populate only when picks are empty and template is CUSTOM
  if (
    existingPicks.length === 0 &&
    draft.templateId &&
    draft.template?.defaultMockupSource === "CUSTOM" &&
    (draft.enabledColorIds?.length ?? 0) > 0
  ) {
    const templateMockupItems = await prisma.templateMockupItem.findMany({
      where: {
        templateId: draft.templateId,
        mockup: { renderMode: "COMPOSITE", isActive: true, deletedAt: null },
      },
      include: { mockup: true },
    });

    if (templateMockupItems.length > 0) {
      const plan = buildTemplateMockupPickPlan({
        selectedColorIds: draft.enabledColorIds ?? [],
        templateMockupItems: templateMockupItems.map((item) => ({
          id: item.id,
          appliesToColorIds: item.appliesToColorIds,
          sortOrder: item.sortOrder,
          isPrimary: item.isPrimary,
          createdAt: item.createdAt,
        })),
        existingPicks: [], // empty — all picks are new
      });

      if (plan.create.length > 0) {
        await prisma.wizardDraftMockupLibraryPick.createMany({
          data: plan.create.map((entry) => ({
            draftId,
            templateMockupItemId: entry.templateMockupItemId,
            colorId: entry.colorId,
            sortOrder: entry.sortOrder,
            isPrimary: entry.isPrimary,
          })),
        });
      }
    }
  }

  const picks = await prisma.wizardDraftMockupLibraryPick.findMany({
    where: { draftId },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      color: true,
      templateMockupItem: { include: { mockup: true } },
    },
  });

  return NextResponse.json({ picks });
}

/**
 * PUT /api/wizard/drafts/[id]/mockup-library-picks
 * Replace selected template mockup items for enabled colors,
 * and optionally update compositeRegionPx on specific picks.
 *
 * Body: {
 *   templateMockupItemIds?: string[],
 *   placementsByPickId?: Record<string, { x, y, width, height, rotationDeg, imageWidth, imageHeight }>
 * }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { id: draftId } = await params;
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    select: { id: true, templateId: true, enabledColorIds: true },
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const body = await request.json();
  const templateMockupItemIds: string[] | undefined = body.templateMockupItemIds;
  const placementsByPickId: Record<string, unknown> | undefined = body.placementsByPickId;

  await prisma.$transaction(async (tx) => {
    // Apply placement updates if provided
    if (placementsByPickId && typeof placementsByPickId === "object") {
      for (const [pickId, raw] of Object.entries(placementsByPickId)) {
        const normalized = normalizeCompositeRegionPx(raw);
        if (normalized) {
          await tx.wizardDraftMockupLibraryPick.update({
            where: { id: pickId },
            data: { compositeRegionPx: normalized as unknown as Prisma.InputJsonValue },
          });
        }
      }
    }

    // Rebuild picks from templateMockupItemIds if provided
    if (Array.isArray(templateMockupItemIds) && templateMockupItemIds.length > 0) {
      const uniqueTemplateMockupItemIds = [...new Set(templateMockupItemIds)];

      const templateMockupItems = await tx.templateMockupItem.findMany({
        where: {
          id: { in: uniqueTemplateMockupItemIds },
          templateId: draft.templateId ?? "",
          template: { store: { tenantId: session.tenantId } },
          mockup: { renderMode: "COMPOSITE", isActive: true, deletedAt: null },
        },
        include: { mockup: true },
      });

      const foundIds = new Set(templateMockupItems.map((item) => item.id));
      const invalid = uniqueTemplateMockupItemIds.filter((id) => !foundIds.has(id));
      if (invalid.length > 0) {
        throw new Error(`Invalid or ineligible template mockup item IDs: ${invalid.join(", ")}`);
      }

      const existingPicks = await tx.wizardDraftMockupLibraryPick.findMany({
        where: { draftId },
        select: { id: true, templateMockupItemId: true, colorId: true, compositeRegionPx: true },
      });

      const plan = buildTemplateMockupPickPlan({
        selectedColorIds: draft.enabledColorIds ?? [],
        templateMockupItems: templateMockupItems.map((item) => ({
          id: item.id,
          appliesToColorIds: item.appliesToColorIds,
          sortOrder: item.sortOrder,
          isPrimary: item.isPrimary,
          createdAt: item.createdAt,
        })),
        existingPicks: existingPicks.map((pick) => ({
          id: pick.id,
          templateMockupItemId: pick.templateMockupItemId,
          colorId: pick.colorId,
          compositeRegionPx: pick.compositeRegionPx,
        })),
      });

      if (plan.deleteIds.length > 0) {
        await tx.wizardDraftMockupLibraryPick.deleteMany({ where: { id: { in: plan.deleteIds } } });
      }
      for (const entry of plan.update) {
        await tx.wizardDraftMockupLibraryPick.update({
          where: { id: entry.id },
          data: { sortOrder: entry.sortOrder, isPrimary: entry.isPrimary },
        });
      }
      if (plan.create.length > 0) {
        await tx.wizardDraftMockupLibraryPick.createMany({
          data: plan.create.map((entry) => ({
            draftId,
            templateMockupItemId: entry.templateMockupItemId,
            colorId: entry.colorId,
            sortOrder: entry.sortOrder,
            isPrimary: entry.isPrimary,
          })),
        });
      }
    }
  });

  // Return updated picks
  const updatedPicks = await prisma.wizardDraftMockupLibraryPick.findMany({
    where: { draftId },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      color: true,
      templateMockupItem: { include: { mockup: true } },
    },
  });

  await logAudit({
    tenantId: session.tenantId,
    action: "wizard.mockup-picks.updated",
    resourceType: "wizard_draft",
    resourceId: draftId,
    actorUserId: session.id,
    metadata: { templateMockupItemIds },
  });

  return NextResponse.json({ picks: updatedPicks });
}
