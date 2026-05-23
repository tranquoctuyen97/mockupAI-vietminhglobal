/**
 * GET    /api/wizard/drafts/:id — Get draft + readiness checklist
 * PATCH  /api/wizard/drafts/:id — Update draft (auto-save) + trigger regen if stale
 * DELETE /api/wizard/drafts/:id — Delete draft
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getDraft, updateDraft, deleteDraft } from "@/lib/wizard/state";
import { prisma } from "@/lib/db";
import { hasActiveMockupJob, regenerateMockupsForDraft } from "@/lib/mockup/regenerate";
import { buildChecklist } from "./checklist";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const draft = await getDraft(id, session.tenantId);

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  // Build pre-publish checklist
  const checklist = await buildChecklist(draft);

  return NextResponse.json({ ...draft, checklist });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  try {
    const updated = await updateDraft(id, session.tenantId, body);

    // DB trigger sets mockupsStale if colors/design/placement changed.
    // After PATCH, check flag and enqueue regeneration if not already running.
    const freshDraft = await prisma.wizardDraft.findUnique({
      where: { id },
      select: { mockupsStale: true },
    });

    if (freshDraft?.mockupsStale) {
      const active = await hasActiveMockupJob(id);
      if (!active) {
        // Fire-and-forget — same pattern as initial generation
        regenerateMockupsForDraft(id).catch((err) =>
          console.error(`[PATCH] Regen failed for draft ${id}:`, err),
        );
      }
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteDraft(id, session.tenantId);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
}
