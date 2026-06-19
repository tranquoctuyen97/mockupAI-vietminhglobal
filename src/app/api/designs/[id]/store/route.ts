import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { storeId?: string | null };

  const design = await prisma.design.findFirst({
    where: { id, tenantId: session.tenantId, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });

  if (!design) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  let storeId: string | null = null;
  if (body.storeId) {
    const store = await prisma.store.findFirst({
      where: { id: body.storeId, tenantId: session.tenantId, status: "ACTIVE" },
      select: { id: true },
    });

    if (!store) {
      return NextResponse.json({ error: "Store not found" }, { status: 400 });
    }

    storeId = store.id;
  }

  const updated = await prisma.design.update({
    where: { id },
    data: { storeId },
    select: { id: true, storeId: true, store: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ design: updated });
}
