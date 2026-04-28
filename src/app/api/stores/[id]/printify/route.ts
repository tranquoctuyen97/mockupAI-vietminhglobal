/**
 * POST /api/stores/:id/printify — Link/unlink Printify shop to store
 * Phase 6.5: No longer saves API key per-store. Instead links a PrintifyShop.
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { linkPrintifyShop, unlinkPrintifyShop } from "@/lib/printify/account";
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

  // Verify store belongs to tenant
  const store = await prisma.store.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const body = await request.json();
  const { printifyShopId } = body as { printifyShopId: string | null };

  try {
    if (printifyShopId) {
      // Link
      await linkPrintifyShop(id, printifyShopId, session.tenantId);

      const reqInfo = getRequestInfo(request);
      await logAudit({
        tenantId: session.tenantId,
        actorUserId: session.id,
        action: "printify_shop.linked",
        resourceType: "store",
        resourceId: id,
        metadata: { printifyShopId },
        ...reqInfo,
      });
    } else {
      // Unlink
      await unlinkPrintifyShop(id);

      const reqInfo = getRequestInfo(request);
      await logAudit({
        tenantId: session.tenantId,
        actorUserId: session.id,
        action: "printify_shop.unlinked",
        resourceType: "store",
        resourceId: id,
        ...reqInfo,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
