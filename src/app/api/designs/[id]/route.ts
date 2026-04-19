/**
 * GET /api/designs/:id — detail
 * DELETE /api/designs/:id — soft delete
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";
import { logAudit } from "@/lib/audit";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const design = await prisma.design.findFirst({
    where: { id, tenantId: session.tenantId },
  });

  if (!design) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  const storage = getStorage();

  return NextResponse.json({
    ...design,
    previewUrl: design.previewPath ? storage.getPublicUrl(design.previewPath) : null,
    originalUrl: storage.getPublicUrl(design.storagePath),
  });
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

  const design = await prisma.design.findFirst({
    where: { id, tenantId: session.tenantId },
    include: { usages: true },
  });

  if (!design) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  if (design.status === "DELETED") {
    return NextResponse.json({ error: "Design đã bị xóa" }, { status: 400 });
  }

  // Block delete if design is used in active listings
  if (design.usages.length > 0) {
    return NextResponse.json(
      { error: "Design đang được sử dụng trong listing. Không thể xóa." },
      { status: 409 },
    );
  }

  // Soft delete
  await prisma.design.update({
    where: { id },
    data: { status: "DELETED", deletedAt: new Date() },
  });

  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "design.deleted",
    resourceType: "design",
    resourceId: id,
    metadata: { name: design.name },
  });

  return NextResponse.json({ success: true });
}
