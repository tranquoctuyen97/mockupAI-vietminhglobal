/**
 * POST /api/wizard/drafts — Create new draft
 * GET  /api/wizard/drafts — List user drafts
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { createDraft, listDrafts } from "@/lib/wizard/state";

export async function POST() {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const draft = await createDraft(session.tenantId);

  return NextResponse.json(draft, { status: 201 });
}

export async function GET() {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const drafts = await listDrafts(session.tenantId);

  return NextResponse.json({ drafts });
}
