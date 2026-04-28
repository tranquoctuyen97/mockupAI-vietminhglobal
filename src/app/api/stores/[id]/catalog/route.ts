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

/**
 * Smarter color name to hex mapping for Printify
 */
function colorToHex(colorName: string): string {
  const map: Record<string, string> = {
    white: "#FFFFFF",
    black: "#111111",
    navy: "#131E3A",
    "midnight navy": "#131E3A",
    red: "#C41E3A",
    "cardinal red": "#8A0303",
    "dark red": "#8B0000",
    "sport grey": "#9B9B9B",
    "dark heather": "#414141",
    "heather grey": "#9B9B9B",
    "athletic heather": "#9B9B9B",
    heather: "#B7C9E2",
    "royal blue": "#4169E1",
    royal: "#4169E1",
    "forest green": "#228B22",
    "kelly green": "#4CBB17",
    "irish green": "#008000",
    "military green": "#4B5320",
    "dark green": "#006400",
    green: "#008000",
    maroon: "#800000",
    purple: "#800080",
    "purple rush": "#7851A9",
    orange: "#FFA500",
    "light blue": "#ADD8E6",
    "light pink": "#FFB6C1",
    pink: "#FFC0CB",
    gold: "#FFD700",
    yellow: "#FFFF00",
    charcoal: "#36454F",
    "ash grey": "#B2BEB5",
    "heavy metal": "#545454",
    grey: "#808080",
    gray: "#808080",
    "light grey": "#D3D3D3",
    brown: "#8B4513",
    "dark chocolate": "#3B2F2F",
    tan: "#D2B48C",
    sand: "#C2B280",
    natural: "#F5F5DC",
    cream: "#FFFDD0",
    olive: "#808000",
    indigo: "#4B0082",
    coral: "#FF7F50",
    teal: "#008080",
    turquoise: "#40E0D0",
    blue: "#0000FF",
  };

  // 1. Lowercase and trim
  let key = colorName.toLowerCase().trim();

  // 2. Exact match
  if (map[key]) return map[key];

  // 3. Strip common Printify prefixes and try again
  const prefixesToStrip = ["solid ", "vintage ", "heather "];
  for (const prefix of prefixesToStrip) {
    if (key.startsWith(prefix)) {
      const strippedKey = key.slice(prefix.length).trim();
      if (map[strippedKey]) return map[strippedKey];
    }
  }

  // 4. Fallback: Fuzzy search in string (e.g. if it contains "black", return #111111)
  const baseColors = ["black", "white", "navy", "red", "royal", "green", "maroon", "purple", "orange", "yellow", "grey", "gray", "brown", "blue", "pink"];
  for (const base of baseColors) {
    if (key.includes(base)) {
      return map[base];
    }
  }

  // 5. Default fallback
  return "#CCCCCC";
}
