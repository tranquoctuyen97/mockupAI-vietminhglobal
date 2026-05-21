/**
 * GET /api/stores/:id/catalog/blueprints
 * Proxy Printify catalog API — fetch blueprints for a store's Printify account
 */

import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { getClientForStore } from "@/lib/printify/account";
import { colorToHex } from "@/lib/printify/color-hex";
import { prisma } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const { id: storeId } = await params;

  // Verify store belongs to tenant
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId },
  });

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  // Phase 6.5: Get Printify client via workspace-level account
  let client;
  try {
    const result = await getClientForStore(storeId);
    client = result.client;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Printify chưa được kết nối cho store này" },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "blueprints";
  const blueprintId = searchParams.get("blueprintId");
  const printProviderId = searchParams.get("printProviderId");

  try {
    switch (action) {
      case "blueprints": {
        const blueprints = await client.getBlueprints();
        return NextResponse.json({ blueprints });
      }

      case "providers": {
        if (!blueprintId) {
          return NextResponse.json({ error: "blueprintId required" }, { status: 400 });
        }
        const providers = await client.getBlueprintPrintProviders(parseInt(blueprintId, 10));
        return NextResponse.json({ providers });
      }

      case "variants": {
        if (!blueprintId || !printProviderId) {
          return NextResponse.json(
            { error: "blueprintId and printProviderId required" },
            { status: 400 },
          );
        }
        const { variants } = await client.getBlueprintVariants(
          parseInt(blueprintId, 10),
          parseInt(printProviderId, 10),
        );

        // Group variants by color for Store Config color tab
        const groupMap = new Map<string, {
          color: string;
          colorHex: string;
          printifyColorId: string;
          sizes: string[];
          variants: typeof variants;
        }>();

        for (const variant of variants) {
          const colorTitle = variant.options?.color || variant.title;
          const sizeTitle = variant.options?.size || "";
          if (!colorTitle) continue;

          if (!groupMap.has(colorTitle)) {
            groupMap.set(colorTitle, {
              color: colorTitle,
              colorHex: colorToHex(colorTitle),
              printifyColorId: colorTitle.toLowerCase().replace(/\s+/g, "-"),
              sizes: [],
              variants: [],
            });
          }
          const group = groupMap.get(colorTitle)!;
          if (sizeTitle && !group.sizes.includes(sizeTitle)) {
            group.sizes.push(sizeTitle);
          }
          group.variants.push(variant);
        }

        const variantGroups = Array.from(groupMap.values());

        // Enrich colorHex from PrintifyVariantCache (real hex from Printify product API)
        const bpId = parseInt(blueprintId, 10);
        const ppId = parseInt(printProviderId, 10);
        const cachedColors = await prisma.printifyVariantCache.findMany({
          where: { blueprintId: bpId, printProviderId: ppId },
          distinct: ["colorName"],
          select: { colorName: true, colorHex: true },
        });
        if (cachedColors.length > 0) {
          const cacheMap = new Map(cachedColors.map((c) => [c.colorName, c.colorHex]));
          for (const g of variantGroups) {
            const cached = cacheMap.get(g.color);
            if (cached) g.colorHex = cached;
          }
        }

        // Also keep flat colors for backward compat
        const colors = variantGroups.map(g => ({
          title: g.color,
          hex: g.colorHex,
        }));

        return NextResponse.json({
          variants,
          colors,
          variantGroups,
        });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Catalog] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Catalog fetch failed" },
      { status: 500 },
    );
  }
}

