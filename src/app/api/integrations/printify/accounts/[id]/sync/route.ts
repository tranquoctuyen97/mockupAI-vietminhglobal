/**
 * POST /api/integrations/printify/accounts/:id/sync — Force resync shops
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { syncPrintifyShops } from "@/lib/printify/account";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Verify account belongs to tenant
  const account = await prisma.printifyAccount.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  try {
    const shops = await syncPrintifyShops(id);

    const reqInfo = getRequestInfo(request);
    await logAudit({
      tenantId: session.tenantId,
      actorUserId: session.id,
      action: "printify_shops.synced",
      resourceType: "printify_account",
      resourceId: id,
      metadata: { shopsCount: shops.length },
      ...reqInfo,
    });

    return NextResponse.json({ shops });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
