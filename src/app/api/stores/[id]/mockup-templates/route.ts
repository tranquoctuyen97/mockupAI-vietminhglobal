/**
 * GET /api/stores/:id/mockup-templates — List templates for wizard/settings
 * POST /api/stores/:id/mockup-templates — Create template (1:N)
 * PATCH /api/stores/:id/mockup-templates — Update default template placement
 */

import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { validateSession } from "@/lib/auth/session";
import { createTemplate, updateTemplatePlacement } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";
import { enrichColorHex } from "@/lib/printify/color-hex";
import {
  getTemplateReadiness,
  getTemplateReadinessLabel,
} from "@/lib/stores/template-readiness";
import type { Prisma } from "@prisma/client";

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
    },
  });

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  // Collect unique blueprint+provider pairs to query cache for real hex
  const bpPairs = new Set<string>();
  for (const t of store.templates) {
    bpPairs.add(`${t.printifyBlueprintId}:${t.printifyPrintProviderId}`);
  }
  const cacheHexMap = new Map<string, string>();
  for (const pair of bpPairs) {
    const [bpId, ppId] = pair.split(":").map(Number);
    const cachedColors = await prisma.printifyVariantCache.findMany({
      where: { blueprintId: bpId, printProviderId: ppId },
      distinct: ["colorName"],
      select: { colorName: true, colorHex: true },
    });
    for (const c of cachedColors) {
      if (c.colorHex) cacheHexMap.set(c.colorName, c.colorHex);
    }
  }

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
      defaultPlacement: template.defaultPlacement,
      readiness: {
        ready: readiness.ready,
        missing: readiness.missing,
        label: getTemplateReadinessLabel(template),
      },
      colors: template.colors.map((entry) => ({
        id: entry.color.id,
        name: entry.color.name,
        hex: cacheHexMap.get(entry.color.name) || enrichColorHex(entry.color.name, entry.color.hex),
        enabled: entry.color.enabled,
        sortOrder: entry.sortOrder,
        customMockupCount: customSourceCountByColorId.get(entry.color.id) ?? 0,
        hasCustomMockup: (customSourceCountByColorId.get(entry.color.id) ?? 0) > 0,
      })),
    };
  });

  return NextResponse.json({ templates });
}

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

  const data = body as {
    name: string;
    printifyBlueprintId: number;
    printifyPrintProviderId: number;
    previewUrl?: string;
    position?: "FRONT" | "BACK" | "SLEEVE";
    defaultPlacement?: Record<string, unknown>;
    colorIds?: string[];
    defaultMockupSource?: "PRINTIFY" | "CUSTOM";
    blueprintTitle?: string;
    printProviderTitle?: string;
    enabledVariantIds?: number[];
    enabledSizes?: string[];
    defaultAspectRatio?: string;
    blueprintImageUrl?: string;
    blueprintBrand?: string;
  };

  if (!data.name || !data.printifyBlueprintId || !data.printifyPrintProviderId) {
    return NextResponse.json(
      { error: "name, printifyBlueprintId, and printifyPrintProviderId required" },
      { status: 400 },
    );
  }

  const result = await createTemplate(id, {
    ...data,
    defaultPlacement: data.defaultPlacement as Prisma.InputJsonValue,
    defaultMockupSource: data.defaultMockupSource,
  });
  return NextResponse.json(result);
}

export async function PATCH(
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

  // Find default template
  const defaultTemplate = await prisma.storeMockupTemplate.findFirst({
    where: { storeId: id, isDefault: true },
  });

  if (!defaultTemplate) {
    return NextResponse.json(
      { error: "Template not configured. Set up Blueprint & Provider first." },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { defaultPlacement } = body as {
    defaultPlacement: Record<string, unknown>;
  };

  if (!defaultPlacement) {
    return NextResponse.json(
      { error: "defaultPlacement required" },
      { status: 400 },
    );
  }

  const result = await updateTemplatePlacement(defaultTemplate.id, defaultPlacement as Prisma.InputJsonValue);
  return NextResponse.json(result);
}
