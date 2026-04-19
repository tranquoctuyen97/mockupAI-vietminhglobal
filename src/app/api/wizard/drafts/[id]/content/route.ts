import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * POST /api/wizard/drafts/:draftId/content
 * Save manually edited AI content back to draft
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;

  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const body = await request.json();
  const { title, description, tags, altText } = body;

  const aiContent = {
    title: title ?? "",
    description: description ?? "",
    tags: Array.isArray(tags) ? tags : [],
    altText: altText ?? "",
  };

  await prisma.wizardDraft.update({
    where: { id: draftId },
    data: { aiContent },
  });

  return NextResponse.json({ ok: true, aiContent });
}
