/**
 * DELETE /api/stores/:id — soft delete store
 * POST /api/stores/:id/test-connection — test Shopify + Printify
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { deleteStore, testStoreConnection } from "@/lib/stores/store-service";
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
    where: { id, tenantId: session.tenantId },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  await deleteStore(id);

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

/**
 * PATCH /api/stores/:id — Update store preset fields
 */
export async function PATCH(
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
    where: { id, tenantId: session.tenantId },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const body = await request.json();

  // Phase 6.10: Accept Store-level preset fields (price/publish only)
  // enabledVariantIds + defaultPromptVersion moved to StoreMockupTemplate
  const updateData: Record<string, unknown> = {};

  if (body.defaultPriceUsd !== undefined) {
    updateData.defaultPriceUsd = body.defaultPriceUsd;
  }
  if (body.publishMode !== undefined) {
    if (!["draft", "active"].includes(body.publishMode)) {
      return NextResponse.json(
        { error: "publishMode must be 'draft' or 'active'" },
        { status: 400 },
      );
    }
    updateData.publishMode = body.publishMode;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  const updated = await prisma.store.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(updated);
}
