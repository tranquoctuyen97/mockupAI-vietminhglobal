import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

/**
 * PUT /api/wizard/drafts/[id]/mockup-library-picks
 * Replace all library picks in a transaction.
 * Body: { sourceIds: string[] }
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
  if (!Array.isArray(sourceIds)) {
    return NextResponse.json({ error: "sourceIds must be an array" }, { status: 400 });
  }

  // Validate that all sources are TEMPLATE scope, active, and belong to this template
  if (sourceIds.length > 0) {
    const sources = await prisma.customMockupSource.findMany({
      where: {
        id: { in: sourceIds },
        scope: "TEMPLATE",
        isActive: true,
        deletedAt: null,
        ...(draft.templateId ? { templateId: draft.templateId } : {}),
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

    // Replace all picks atomically
    await prisma.$transaction(async (tx) => {
      await tx.wizardDraftMockupLibraryPick.deleteMany({ where: { draftId } });
      await tx.wizardDraftMockupLibraryPick.createMany({
        data: sources.map((source, index) => ({
          draftId,
          sourceId: source.id,
          colorId: source.colorId,
          sortOrder: index,
        })),
      });
    });
  } else {
    // Clear all picks
    await prisma.wizardDraftMockupLibraryPick.deleteMany({ where: { draftId } });
  }

  const requestInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "custom_mockup.library_picks_updated",
    resourceType: "wizard_draft",
    resourceId: draftId,
    metadata: { sourceIds, count: sourceIds.length } as Prisma.InputJsonValue,
    ...requestInfo,
  });

  return NextResponse.json({ ok: true, count: sourceIds.length });
}
