/**
 * GET /api/stores/:id/wizard-config — Wizard configuration endpoint
 *
 * Combines templates + store-level colors into a single response, eliminating
 * the sequential waterfall of 2 API calls on step-3 page load. Sizes come
 * from the template's `enabledSizes` string array (cost data still fetched
 * lazily via /api/stores/:id/sizes when needed — that route calls Printify
 * cache which can't be inlined here).
 *
 * Next.js best practices:
 * - Route Handler (not Server Action) — client component needs a GET endpoint
 * - async params pattern per Next.js 15+
 * - Node.js runtime — needs Prisma
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { enrichColorHex } from "@/lib/printify/color-hex";
import {
  getTemplateReadiness,
  getTemplateReadinessLabel,
} from "@/lib/stores/template-readiness";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: storeId } = await params;

  // Single query: store + templates (with colors) + store colors
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId },
    include: {
      templates: {
        orderBy: { sortOrder: "asc" },
        include: {
          colors: {
            orderBy: { sortOrder: "asc" },
            include: { color: true },
          },
          customMockupSources: {
            where: {
              scope: "TEMPLATE",
              isActive: true,
              deletedAt: null,
            },
            select: { colorId: true },
          },
        },
      },
      colors: {
        where: { enabled: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  // Build hex lookup in parallel — one query per unique blueprint+provider pair
  const bpPairs = new Set<string>();
  for (const t of store.templates) {
    bpPairs.add(`${t.printifyBlueprintId}:${t.printifyPrintProviderId}`);
  }
  const cacheHexMap = new Map<string, string>();
  await Promise.all(
    Array.from(bpPairs).map(async (pair) => {
      const [bpId, ppId] = pair.split(":").map(Number);
      const cachedColors = await prisma.printifyVariantCache.findMany({
        where: { blueprintId: bpId, printProviderId: ppId },
        distinct: ["colorName"],
        select: { colorName: true, colorHex: true },
      });
      for (const c of cachedColors) {
        if (c.colorHex) cacheHexMap.set(c.colorName, c.colorHex);
      }
    }),
  );

  // Shape templates
  const templates = store.templates.map((template) => {
    const readiness = getTemplateReadiness(template);
    const customSourceCountByColorId = new Map<string, number>();
    for (const source of template.customMockupSources) {
      customSourceCountByColorId.set(
        source.colorId,
        (customSourceCountByColorId.get(source.colorId) ?? 0) + 1,
      );
    }

    return {
      id: template.id,
      name: template.name,
      isDefault: template.isDefault,
      sortOrder: template.sortOrder,
      printifyBlueprintId: template.printifyBlueprintId,
      printifyPrintProviderId: template.printifyPrintProviderId,
      blueprintTitle: template.blueprintTitle,
      printProviderTitle: template.printProviderTitle,
      defaultMockupSource: template.defaultMockupSource,
      enabledVariantIds: template.enabledVariantIds,
      enabledSizes: template.enabledSizes,
      // Per-color size map; null means use enabledSizes as global fallback
      enabledSizesByColor: (template.enabledSizesByColor ?? null) as Record<string, string[]> | null,
      defaultPlacement: template.defaultPlacement,
      readiness: {
        ready: readiness.ready,
        missing: readiness.missing,
        label: getTemplateReadinessLabel(template),
      },
      colors: template.colors.map((entry) => ({
        id: entry.color.id,
        name: entry.color.name,
        hex:
          cacheHexMap.get(entry.color.name) ||
          enrichColorHex(entry.color.name, entry.color.hex),
        enabled: entry.color.enabled,
        sortOrder: entry.sortOrder,
        customMockupCount: customSourceCountByColorId.get(entry.color.id) ?? 0,
        hasCustomMockup:
          (customSourceCountByColorId.get(entry.color.id) ?? 0) > 0,
      })),
    };
  });

  // Shape store-level colors (used as a fallback color list)
  const colors = store.colors.map((c) => ({
    id: c.id,
    name: c.name,
    hex: enrichColorHex(c.name, c.hex),
    enabled: c.enabled,
    sortOrder: c.sortOrder,
  }));

  return NextResponse.json({ templates, colors });
}
