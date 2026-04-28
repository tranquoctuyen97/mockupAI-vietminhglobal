/**
 * GET /api/stores/:id/sizes
 * Returns grouped size options with cost data from PrintifyVariantCache.
 * Lazy-loads cache via dummy product strategy if needed.
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getClientForStore } from "@/lib/printify/account";
import {
  ensureVariantCostCache,
  groupSizes,
} from "@/lib/printify/variant-catalog";

export async function GET(
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

    // Lazy-load cost cache (creates dummy product if cache is stale/missing)
    const variants = await ensureVariantCostCache({
      client,
      shopId: externalShopId,
      blueprintId: store.template.printifyBlueprintId,
      printProviderId: store.template.printifyPrintProviderId,
    });

    const sizes = groupSizes(variants);

    return NextResponse.json({
      sizes,
      enabledSizes: store.template.enabledSizes,
    });
  } catch (err) {
    // Fallback: return catalog-based sizes without cost data
    console.error(`[sizes] Cost cache failed for store ${storeId}:`, err);

    const { client } = await getClientForStore(storeId);
    const catalogResponse = await client.getBlueprintVariants(
      store.template.printifyBlueprintId,
      store.template.printifyPrintProviderId,
    );

    // Extract unique sizes from catalog variant titles
    const sizeSet = new Map<string, number>();
    for (const v of catalogResponse.variants) {
      const size = v.options.size ?? "ONE_SIZE";
      sizeSet.set(size, (sizeSet.get(size) ?? 0) + 1);
    }

    const sizes = Array.from(sizeSet.entries()).map(([size, count]) => ({
      size,
      availableColors: count,
      isAvailable: true,
      costCents: 0,
      costDeltaCents: 0,
    }));

    return NextResponse.json({
      sizes,
      enabledSizes: store.template.enabledSizes,
      pricing: "unavailable",
      warning:
        "Không lấy được giá Printify. Variants vẫn dùng được, nhưng size delta sẽ = $0.",
    });
  }
}
