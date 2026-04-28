/**
 * POST /api/stores/:id/variant-cache/refresh
 * Force-refresh the PrintifyVariantCache for this store's blueprint.
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getClientForStore } from "@/lib/printify/account";
import { ensureVariantCostCache } from "@/lib/printify/variant-catalog";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: storeId } = await params;

  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId },
    include: { template: true },
  });
  if (!store?.template) {
    return NextResponse.json(
      { error: "Store template not found" },
      { status: 404 },
    );
  }

  try {
    const { client, externalShopId } = await getClientForStore(storeId);

    const variants = await ensureVariantCostCache({
      client,
      shopId: externalShopId,
      blueprintId: store.template.printifyBlueprintId,
      printProviderId: store.template.printifyPrintProviderId,
      forceRefresh: true,
    });

    return NextResponse.json({
      success: true,
      variantsCount: variants.length,
      message: "Variant cost cache refreshed successfully",
    });
  } catch (err) {
    console.error(`[variant-cache-refresh] Failed for store ${storeId}:`, err);
    return NextResponse.json(
      {
        error: "Failed to refresh variant cache",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
