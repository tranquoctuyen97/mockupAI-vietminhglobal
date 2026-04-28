import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { imageIds, included } = body;

  if (!Array.isArray(imageIds) || typeof included !== "boolean") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Verify draft exists
  const draft = await prisma.wizardDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  // Update included status for all requested images
  await prisma.mockupImage.updateMany({
    where: {
      id: { in: imageIds },
      mockupJob: { draftId: id } // Ensure images belong to this draft
    },
    data: {
      included
    }
  });

  return NextResponse.json({ success: true });
}
