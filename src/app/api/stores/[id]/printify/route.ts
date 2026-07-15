/**
 * POST /api/stores/:id/printify — Link/unlink Printify shop to store
 * Phase 6.5: No longer saves API key per-store. Instead links a PrintifyShop.
 */

import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { linkPrintifyShop, unlinkPrintifyShop } from "@/lib/printify/account";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const { id } = await params;

  // Verify store belongs to tenant
  const store = await prisma.store.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const body = await request.json();
  const { printifyShopId, unpublishAfterShopifySync } = body as {
    printifyShopId?: string | null;
    unpublishAfterShopifySync?: boolean;
  };

  try {
    if (typeof unpublishAfterShopifySync === "boolean") {
      const linkedStore = await prisma.store.findFirst({
        where: { id, tenantId: session.tenantId },
        include: {
          printifyShop: {
            include: { account: { select: { tenantId: true } } },
          },
        },
      });
      const linkedShop = linkedStore?.printifyShop;
      if (!linkedShop || linkedShop.account.tenantId !== session.tenantId) {
        return NextResponse.json({ error: "Printify shop is not linked" }, { status: 400 });
      }
      const isShopifyChannel =
        linkedShop.salesChannel?.trim().toLowerCase() === "shopify" &&
        linkedShop.disconnected !== true;
      if (unpublishAfterShopifySync && !isShopifyChannel) {
        return NextResponse.json(
          { error: "This setting is only available for active Printify Shopify-channel shops" },
          { status: 400 },
        );
      }

      await prisma.printifyShop.update({
        where: { id: linkedShop.id },
        data: { unpublishAfterShopifySync },
      });

      const reqInfo = getRequestInfo(request);
      await logAudit({
        tenantId: session.tenantId,
        actorUserId: session.id,
        action: "printify_shop.unpublish_after_shopify_sync.updated",
        resourceType: "store",
        resourceId: id,
        metadata: { printifyShopId: linkedShop.id, unpublishAfterShopifySync },
        ...reqInfo,
      });
    } else if (printifyShopId) {
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
    } else if (printifyShopId === null) {
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
    } else {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
