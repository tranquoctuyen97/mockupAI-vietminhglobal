import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    select: { id: true },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const pairs = await prisma.wizardDraftDesignPair.findMany({
    where: { draftId },
    orderBy: { sortOrder: "asc" },
    include: {
      lightDesign: { include: { design: true } },
      darkDesign: { include: { design: true } },
      listing: true,
    },
  });

  return NextResponse.json({ pairs });
}
