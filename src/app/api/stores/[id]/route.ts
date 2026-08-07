/**
 * GET  /api/stores/:id — fetch single store with templates + colors
 * DELETE /api/stores/:id — soft delete store
 * PATCH  /api/stores/:id — update store preset fields
 */

import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { fetchInkhubShopStats } from "@/lib/inkhub/orders-client";
import { enqueueInkhubInitialSync } from "@/lib/inkhub/queue";
import { enrichColorHex } from "@/lib/printify/color-hex";
import { getPresetStatusSync } from "@/lib/stores/preset";
import { deleteStore } from "@/lib/stores/store-service";

/**
 * GET /api/stores/[id]
 * Fetches a single store with full template + color data.
 * Used by /stores/[id]/config to avoid loading the entire store list.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const store = await prisma.store.findUnique({
    where: { id, tenantId: session.tenantId },
    include: {
      credentials: {
        select: { shopifyGrantedScopes: true },
      },
      printifyShop: true,
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

  const { credentials, ...storeWithoutCredentials } = store;

  return NextResponse.json({
    ...storeWithoutCredentials,
    templates: enrichedTemplates,
    defaultPriceUsd: Number(store.defaultPriceUsd),
    presetStatus: getPresetStatusSync(store),
    shopifyGrantedScopes: credentials?.shopifyGrantedScopes ?? [],
    shopifyReportAccessReady: credentials?.shopifyGrantedScopes.includes("read_reports") ?? false,
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

async function resolveInkhubMapping(
  body: Record<string, unknown>,
  store: { inkhubShopId: number | null },
  tenantId: string,
  storeId: string,
): Promise<{
  updateData: Record<string, unknown>;
  changed: boolean;
  nextShopId: number | null | undefined;
  response?: NextResponse;
}> {
  if (body.inkhubShopId === undefined) {
    return { updateData: {}, changed: false, nextShopId: undefined };
  }

  if (body.inkhubShopId === null || body.inkhubShopId === "") {
    return {
      updateData: { inkhubShopId: null, inkhubShopLabel: null },
      changed: store.inkhubShopId !== null,
      nextShopId: null,
    };
  }

  const parsedShopId = Number(body.inkhubShopId);
  if (!Number.isInteger(parsedShopId) || parsedShopId < 0) {
    return {
      updateData: {},
      changed: false,
      nextShopId: undefined,
      response: NextResponse.json(
        { error: "inkhubShopId must be a non-negative integer" },
        { status: 400 },
      ),
    };
  }

  const duplicate = await prisma.store.findFirst({
    where: {
      tenantId,
      inkhubShopId: parsedShopId,
      id: { not: storeId },
      deletedAt: null,
    },
    select: { id: true },
  });
  if (duplicate) {
    return {
      updateData: {},
      changed: false,
      nextShopId: undefined,
      response: NextResponse.json(
        { error: "This Inkhub shop is already mapped to another store" },
        { status: 409 },
      ),
    };
  }

  try {
    const shop = (await fetchInkhubShopStats(tenantId)).find(
      (candidate) => candidate.id === parsedShopId,
    );
    if (!shop) {
      return {
        updateData: {},
        changed: false,
        nextShopId: undefined,
        response: NextResponse.json({ error: "Inkhub shop not found" }, { status: 400 }),
      };
    }
    return {
      updateData: { inkhubShopId: parsedShopId, inkhubShopLabel: shop.label },
      changed: store.inkhubShopId !== parsedShopId,
      nextShopId: parsedShopId,
    };
  } catch (error) {
    console.error("[Stores] Failed to validate Inkhub shop mapping:", error);
    return {
      updateData: {},
      changed: false,
      nextShopId: undefined,
      response: NextResponse.json(
        { error: "Unable to validate Inkhub shop right now" },
        { status: 502 },
      ),
    };
  }
}

/**
 * PATCH /api/stores/:id — Update store preset fields
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const inkhubMapping = await resolveInkhubMapping(body, store, session.tenantId, id);
  if (inkhubMapping.response) return inkhubMapping.response;
  Object.assign(updateData, inkhubMapping.updateData);

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    updateData.name = body.name.trim();
  }

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
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await prisma.store.update({
    where: { id },
    data: updateData,
  });

  let inkhubInitialSyncQueued = false;
  if (
    inkhubMapping.changed &&
    inkhubMapping.nextShopId !== null &&
    inkhubMapping.nextShopId !== undefined
  ) {
    try {
      await enqueueInkhubInitialSync({
        tenantId: session.tenantId,
        storeId: id,
        shopIds: [inkhubMapping.nextShopId],
      });
      inkhubInitialSyncQueued = true;
    } catch (error) {
      console.error("[Stores] Failed to enqueue Inkhub initial sync:", error);
    }
  }

  return NextResponse.json({ ...updated, inkhubInitialSyncQueued });
}
