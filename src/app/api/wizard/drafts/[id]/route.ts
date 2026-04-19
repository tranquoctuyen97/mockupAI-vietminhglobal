/**
 * GET    /api/wizard/drafts/:id — Get draft
 * PATCH  /api/wizard/drafts/:id — Update draft (auto-save)
 * DELETE /api/wizard/drafts/:id — Delete draft
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getDraft, updateDraft, deleteDraft } from "@/lib/wizard/state";

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

  return NextResponse.json(draft);
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
    const draft = await updateDraft(id, session.tenantId, body);
    return NextResponse.json(draft);
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
