/**
 * GET/POST /api/stores/:id/colors
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { upsertStoreColors } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const colors = await prisma.storeColor.findMany({
    where: { storeId: id, store: { tenantId: session.tenantId } },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(colors);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify store belongs to tenant
  const store = await prisma.store.findFirst({
    where: { id, tenantId: session.tenantId, deletedAt: null },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const body = await request.json();
  const { colors } = body as {
    colors: Array<{ name: string; hex: string; printifyColorId?: string; sortOrder?: number }>;
  };

  if (!colors || !Array.isArray(colors)) {
    return NextResponse.json({ error: "colors array required" }, { status: 400 });
  }

  const result = await upsertStoreColors(id, colors);
  return NextResponse.json(result);
}
