/**
 * DELETE /api/stores/:id — soft delete store
 * POST /api/stores/:id/test-connection — test Shopify + Printify
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { softDeleteStore, testStoreConnection } from "@/lib/stores/store-service";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { prisma } from "@/lib/db";

export async function DELETE(
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

  await softDeleteStore(id);

  const reqInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "store.deleted",
    resourceType: "store",
    resourceId: id,
    ...reqInfo,
  });

  return NextResponse.json({ success: true });
}
