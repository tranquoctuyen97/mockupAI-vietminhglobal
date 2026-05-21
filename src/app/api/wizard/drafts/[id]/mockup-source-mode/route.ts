import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

const VALID_MODES = new Set(["AUTO", "TEMPLATE_PRINTIFY", "DRAFT_CUSTOM"]);

/**
 * PATCH /api/wizard/drafts/[id]/mockup-source-mode
 * Set the mockup source mode. Non-destructive: does NOT delete uploads or picks.
 * Body: { mode: "AUTO" | "TEMPLATE_PRINTIFY" | "DRAFT_CUSTOM" }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { id: draftId } = await params;
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    select: { id: true, mockupSourceMode: true },
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const body = await request.json();
  const { mode } = body;

  if (!VALID_MODES.has(mode)) {
    return NextResponse.json(
      { error: `Invalid mode. Must be one of: ${[...VALID_MODES].join(", ")}` },
      { status: 400 },
    );
  }

  const previousMode = draft.mockupSourceMode;

  await prisma.wizardDraft.update({
    where: { id: draftId },
    data: { mockupSourceMode: mode },
  });

  const requestInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "wizard_draft.mockup_source_mode_changed",
    resourceType: "wizard_draft",
    resourceId: draftId,
    metadata: { previousMode, newMode: mode } as Prisma.InputJsonValue,
    ...requestInfo,
  });

  return NextResponse.json({ ok: true, mode });
}
