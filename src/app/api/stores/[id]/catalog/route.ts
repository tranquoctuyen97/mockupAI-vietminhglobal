/**
 * GET /api/stores/:id/catalog/blueprints
 * Proxy Printify catalog API — fetch blueprints for a store's Printify account
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getClientForStore } from "@/lib/printify/account";
import { prisma } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: storeId } = await params;

  // Verify store belongs to tenant
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId, deletedAt: null },
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

        // Extract unique colors from variants
        const colorMap = new Map<string, { title: string; hex: string }>();
        for (const variant of variants) {
          const colorTitle = variant.options?.color || variant.title;
          if (colorTitle && !colorMap.has(colorTitle)) {
            colorMap.set(colorTitle, {
              title: colorTitle,
              hex: colorToHex(colorTitle),
            });
          }
        }

        return NextResponse.json({
          variants,
          colors: Array.from(colorMap.values()),
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

/**
 * Best-effort color name to hex mapping
 */
function colorToHex(colorName: string): string {
  const map: Record<string, string> = {
    white: "#FFFFFF",
    black: "#000000",
    navy: "#001F3F",
    red: "#FF0000",
    "sport grey": "#9B9B9B",
    "dark heather": "#414141",
    "royal blue": "#4169E1",
    "forest green": "#228B22",
    maroon: "#800000",
    purple: "#800080",
    "irish green": "#008000",
    orange: "#FFA500",
    "light blue": "#ADD8E6",
    "light pink": "#FFB6C1",
    gold: "#FFD700",
    yellow: "#FFFF00",
    charcoal: "#36454F",
    "ash grey": "#B2BEB5",
    brown: "#8B4513",
    tan: "#D2B48C",
    sand: "#C2B280",
    heather: "#B7C9E2",
    olive: "#808000",
    indigo: "#4B0082",
    coral: "#FF7F50",
    teal: "#008080",
    "dark green": "#006400",
    "dark red": "#8B0000",
    gray: "#808080",
    grey: "#808080",
    pink: "#FFC0CB",
    blue: "#0000FF",
    green: "#008000",
  };

  const key = colorName.toLowerCase().trim();
  return map[key] || "#CCCCCC";
}
