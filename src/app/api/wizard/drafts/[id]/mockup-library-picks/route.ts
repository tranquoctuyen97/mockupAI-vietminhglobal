import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";

/**
 * PUT /api/wizard/drafts/[id]/mockup-library-picks
 * Replace selected mockup sources in a transaction.
 * Body: { sourceIds: string[], primarySourceId?: string | null, placementsBySourceId?: Record<string, CompositeRegionPx> }
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
  const sourceIds: string[] = body.sourceIds;
  const primarySourceId: string | null | undefined = body.primarySourceId;
  if (!Array.isArray(sourceIds)) {
    return NextResponse.json({ error: "sourceIds must be an array" }, { status: 400 });
  }

  // Dedupe sourceIds: giữ order xuất hiện đầu tiên
  const uniqueSourceIds = [...new Set(sourceIds)];

  if (uniqueSourceIds.length === 0) {
    return NextResponse.json({ error: "At least one mockup must be selected" }, { status: 400 });
  }

  // Validate primarySourceId must be one of uniqueSourceIds
  if (primarySourceId !== undefined && primarySourceId !== null) {
    if (!uniqueSourceIds.includes(primarySourceId)) {
      return NextResponse.json(
        { error: "primarySourceId must be one of sourceIds" },
        { status: 400 },
      );
    }
  }

  // Validate placementsBySourceId entries (structure only, not bounds)
  const placementsBySourceId: Record<string, unknown> | undefined = body.placementsBySourceId;
  const normalizedPlacements = new Map<string, ReturnType<typeof normalizeCompositeRegionPx>>();
  if (placementsBySourceId && typeof placementsBySourceId === "object") {
    for (const [sourceId, raw] of Object.entries(placementsBySourceId)) {
      if (!uniqueSourceIds.includes(sourceId)) {
        return NextResponse.json(
          { error: `placementsBySourceId key "${sourceId}" is not in sourceIds` },
          { status: 400 },
        );
      }
      const normalized = normalizeCompositeRegionPx(raw);
      if (!normalized) {
        return NextResponse.json(
          { error: `Invalid placement for sourceId "${sourceId}"` },
          { status: 400 },
        );
      }
      normalizedPlacements.set(sourceId, normalized);
    }
  }

  const sources = await prisma.customMockupSource.findMany({
    where: {
      id: { in: uniqueSourceIds },
      isActive: true,
      deletedAt: null,
      OR: [
        { scope: "DRAFT" as const, draftId },
        ...(draft.templateId ? [{ scope: "TEMPLATE" as const, templateId: draft.templateId }] : []),
      ],
    },
    select: { id: true, colorId: true },
  });

  const foundIds = new Set(sources.map((s) => s.id));
  const invalid = uniqueSourceIds.filter((id) => !foundIds.has(id));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid or ineligible source IDs: ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  const normalizedPrimaryId =
    primarySourceId && uniqueSourceIds.includes(primarySourceId)
      ? primarySourceId
      : uniqueSourceIds[0];

  await prisma.$transaction(async (tx) => {
    // Fetch existing picks to preserve compositeRegionPx
    const existingPicks = await tx.wizardDraftMockupLibraryPick.findMany({
      where: { draftId },
      select: { sourceId: true, compositeRegionPx: true },
    });
    const existingPlacementBySourceId = new Map(
      existingPicks
        .filter((p) => p.compositeRegionPx != null)
        .map((p) => [p.sourceId, p.compositeRegionPx]),
    );

    await tx.wizardDraftMockupLibraryPick.deleteMany({ where: { draftId } });

    await tx.wizardDraftMockupLibraryPick.createMany({
      data: uniqueSourceIds.map((sourceId, index) => {
        const source = sources.find((entry) => entry.id === sourceId)!;

        // Placement precedence: request mới > existing cũ > null
        const compositeRegionPx =
          normalizedPlacements.get(sourceId) ??
          existingPlacementBySourceId.get(sourceId) ??
          null;

        return {
          draftId,
          sourceId: source.id,
          colorId: source.colorId,               // derived from CustomMockupSource
          isPrimary: source.id === normalizedPrimaryId,
          sortOrder: index,
          compositeRegionPx: (compositeRegionPx ?? undefined) as Prisma.InputJsonValue,
        };
      }),
    });

    if (normalizedPlacements.size > 0) {
      await tx.wizardDraft.update({
        where: { id: draftId },
        data: { mockupsStale: true, mockupsStaleReason: "placement_changed" },
      });
    }
  });

  const requestInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "custom_mockup.library_picks_updated",
    resourceType: "wizard_draft",
    resourceId: draftId,
    metadata: { sourceIds: uniqueSourceIds, primarySourceId: normalizedPrimaryId, count: uniqueSourceIds.length } as Prisma.InputJsonValue,
    ...requestInfo,
  });

  return NextResponse.json({
    ok: true,
    count: uniqueSourceIds.length,
    ...(sourceIds.length !== uniqueSourceIds.length
      ? { deduped: sourceIds.length - uniqueSourceIds.length }
      : {}),
  });
}
