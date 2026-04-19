/**
 * POST /api/stores/:id/test-connection
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { testStoreConnection } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
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

  const result = await testStoreConnection(id);
  return NextResponse.json(result);
}
