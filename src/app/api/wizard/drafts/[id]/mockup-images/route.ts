import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getMockupCompositeQueue } from "@/lib/mockup/queue";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { imageIds, included, retryImageId } = body;

  if (typeof retryImageId === "string") {
    const image = await prisma.mockupImage.findFirst({
      where: {
        id: retryImageId,
        mockupJob: {
          draftId: id,
          draft: { tenantId: session.tenantId },
        },
      },
      include: {
        mockupJob: {
          include: {
            draft: {
              include: {
                design: { select: { storagePath: true } },
              },
            },
          },
        },
      },
    });
    if (!image) return NextResponse.json({ error: "Image not found" }, { status: 404 });
    if (!image.mockupJob.draft.design?.storagePath) {
      return NextResponse.json({ error: "Draft design not found" }, { status: 400 });
    }

    const wasFailed = image.compositeStatus === "failed";
    await prisma.$transaction(async (tx) => {
      await tx.mockupImage.update({
        where: { id: retryImageId },
        data: {
          compositeStatus: "pending",
          compositeError: null,
          compositeUrl: null,
        },
      });
      await tx.mockupJob.update({
        where: { id: image.mockupJobId },
        data: {
          status: "running",
          errorMessage: null,
          ...(wasFailed && image.mockupJob.failedImages > 0
            ? { failedImages: { decrement: 1 } }
            : {}),
        },
      });
    });

    await getMockupCompositeQueue().add("retry-composite-image", {
      mockupImageId: image.id,
      sourceUrl: image.sourceUrl,
      designStoragePath: image.mockupJob.draft.design.storagePath,
      placementData: image.mockupJob.placementSnapshot,
    });

    return NextResponse.json({ success: true });
  }

  if (!Array.isArray(imageIds) || typeof included !== "boolean") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Verify draft exists
  const draft = await prisma.wizardDraft.findFirst({ where: { id, tenantId: session.tenantId } });
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
