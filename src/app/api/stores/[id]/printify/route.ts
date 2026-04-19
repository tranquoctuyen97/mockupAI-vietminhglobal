/**
 * POST /api/stores/:id/printify — Save Printify API key + shop selection
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { savePrintifyConnection } from "@/lib/stores/store-service";
import { PrintifyClient } from "@/lib/printify/client";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { prisma } from "@/lib/db";

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
  const { apiKey, shopId } = body as { apiKey: string; shopId: string };

  if (!apiKey || !shopId) {
    return NextResponse.json({ error: "apiKey and shopId required" }, { status: 400 });
  }

  // Test connection first
  const client = new PrintifyClient(apiKey);
  const test = await client.testConnection();
  if (!test.ok) {
    return NextResponse.json(
      { error: `Printify connection failed: ${test.error}` },
      { status: 400 },
    );
  }

  // Save encrypted
  await savePrintifyConnection(id, apiKey, shopId);

  const reqInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "store.printify_connected",
    resourceType: "store",
    resourceId: id,
    metadata: { printifyShopId: shopId },
    ...reqInfo,
  });

  return NextResponse.json({ success: true });
}
