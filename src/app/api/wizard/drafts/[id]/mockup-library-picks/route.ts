import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

/**
 * PUT /api/wizard/drafts/[id]/mockup-library-picks
 * Replace selected mockup sources in a transaction.
 * Body: { sourceIds: string[], primarySourceId?: string | null }
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
  if (sourceIds.length === 0) {
    return NextResponse.json({ error: "At least one mockup must be selected" }, { status: 400 });
  }

  const sources = await prisma.customMockupSource.findMany({
    where: {
      id: { in: sourceIds },
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
  const invalid = sourceIds.filter((id) => !foundIds.has(id));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid or ineligible source IDs: ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  const normalizedPrimaryId = sourceIds.includes(primarySourceId ?? "") ? primarySourceId ?? sourceIds[0] : sourceIds[0];

  await prisma.$transaction(async (tx) => {
    await tx.wizardDraftMockupLibraryPick.deleteMany({ where: { draftId } });
    await tx.wizardDraftMockupLibraryPick.createMany({
      data: sourceIds.map((sourceId, index) => {
        const source = sources.find((entry) => entry.id === sourceId)!;
        return {
          draftId,
          sourceId: source.id,
          colorId: source.colorId,
          isPrimary: source.id === normalizedPrimaryId,
          sortOrder: index,
        };
      }),
    });
  });

  const requestInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "custom_mockup.library_picks_updated",
    resourceType: "wizard_draft",
    resourceId: draftId,
    metadata: { sourceIds, primarySourceId: normalizedPrimaryId, count: sourceIds.length } as Prisma.InputJsonValue,
    ...requestInfo,
  });

  return NextResponse.json({ ok: true, count: sourceIds.length });
}
