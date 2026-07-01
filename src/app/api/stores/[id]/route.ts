/**
 * GET  /api/stores/:id — fetch single store with templates + colors
 * DELETE /api/stores/:id — soft delete store
 * PATCH  /api/stores/:id — update store preset fields
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { requireFeature } from "@/lib/auth/guards";
import { deleteStore, testStoreConnection } from "@/lib/stores/store-service";
import { getPresetStatusSync } from "@/lib/stores/preset";
import { enrichColorHex } from "@/lib/printify/color-hex";
import { logAudit, getRequestInfo } from "@/lib/audit";
import { prisma } from "@/lib/db";

/**
 * GET /api/stores/[id]
 * Fetches a single store with full template + color data.
 * Used by /stores/[id]/config to avoid loading the entire store list.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const store = await prisma.store.findUnique({
    where: { id, tenantId: session.tenantId },
    include: {
      colors: { orderBy: { sortOrder: "asc" } },
      templates: {
        orderBy: { sortOrder: "asc" },
        include: {
          colors: {
            orderBy: { sortOrder: "asc" },
            include: { color: true },
          },
          mockupItems: {
            include: { mockup: true },
          },
        },
      },
    },
  });

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  // Enrich template color hex from PrintifyVariantCache (batched — 1 query)
  const bpPairs = new Set<string>();
  for (const t of store.templates) {
    bpPairs.add(`${t.printifyBlueprintId}:${t.printifyPrintProviderId}`);
  }

  const cacheHexMap = new Map<string, string>();
  if (bpPairs.size > 0) {
    const allCached = await prisma.printifyVariantCache.findMany({
      where: {
        OR: [...bpPairs].map((pair) => {
          const [bpId, ppId] = pair.split(":").map(Number);
          return { blueprintId: bpId, printProviderId: ppId };
        }),
      },
      select: { colorName: true, colorHex: true },
    });
    for (const c of allCached) {
      if (c.colorHex && !cacheHexMap.has(c.colorName)) {
        cacheHexMap.set(c.colorName, c.colorHex);
      }
    }
  }

  const enrichedTemplates = store.templates.map((t) => ({
    ...t,
    basePriceUsd: t.basePriceUsd ? Number(t.basePriceUsd) : null,
    colors: t.colors.map((tc) => ({
      ...tc,
      color: {
        ...tc.color,
        hex: cacheHexMap.get(tc.color.name) || enrichColorHex(tc.color.name, tc.color.hex),
      },
    })),
  }));

  return NextResponse.json({
    ...store,
    templates: enrichedTemplates,
    defaultPriceUsd: Number(store.defaultPriceUsd),
    presetStatus: getPresetStatusSync(store),
  });
}



export async function DELETE(
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

  await deleteStore(id);

  const reqInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "store.deleted",
    resourceType: "store",
    resourceId: id,
    ...reqInfo,
  });

  return NextResponse.json({ success: true });
}

/**
 * PATCH /api/stores/:id — Update store preset fields
 */
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

  const body = await request.json();

  // Phase 6.10: Accept Store-level preset fields (price/publish only)
  // Product template details live on StoreMockupTemplate.
  const updateData: Record<string, unknown> = {};

  if (body.defaultPriceUsd !== undefined) {
    updateData.defaultPriceUsd = body.defaultPriceUsd;
  }
  if (body.publishMode !== undefined) {
    if (!["draft", "active"].includes(body.publishMode)) {
      return NextResponse.json(
        { error: "publishMode must be 'draft' or 'active'" },
        { status: 400 },
      );
    }
    updateData.publishMode = body.publishMode;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  const updated = await prisma.store.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(updated);
}
