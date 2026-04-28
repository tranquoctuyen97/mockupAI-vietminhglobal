/**
 * PATCH /api/stores/:id/template
 * Zod-validated template update
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { PlacementDataSchema } from "@/lib/placement/schema";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getClientForStore } from "@/lib/printify/account";
import { ensureVariantCostCache } from "@/lib/printify/variant-catalog";

const TemplatePatchSchema = z.object({
  name: z.string().optional(),
  printifyBlueprintId: z.number().int().positive().optional(),
  printifyPrintProviderId: z.number().int().positive().optional(),
  blueprintTitle: z.string().optional(),
  printProviderTitle: z.string().optional(),
  enabledVariantIds: z.array(z.number().int().positive()).optional(),
  enabledSizes: z.array(z.string()).optional(),
  defaultPlacement: PlacementDataSchema.optional(),
  defaultPromptVersion: z.string().optional(),
  defaultAspectRatio: z.string().optional(),
  storePresetSnapshot: z.any().optional(),
});

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

  const template = await prisma.storeMockupTemplate.findUnique({
    where: { storeId },
  });

  return NextResponse.json({ template });
}

export async function PATCH(
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

  const body = await request.json();
  const parsed = TemplatePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // Check template exists
  const existing = await prisma.storeMockupTemplate.findUnique({
    where: { storeId },
  });

  if (!existing) {
    // Create with required fields
    if (!data.printifyBlueprintId || !data.printifyPrintProviderId) {
      return NextResponse.json(
        { error: "blueprintId and printProviderId required for first save" },
        { status: 400 },
      );
    }

    const template = await prisma.storeMockupTemplate.create({
      data: {
        storeId,
        name: data.name ?? "Default",
        printifyBlueprintId: data.printifyBlueprintId,
        printifyPrintProviderId: data.printifyPrintProviderId,
        blueprintTitle: data.blueprintTitle ?? "",
        printProviderTitle: data.printProviderTitle ?? "",
        enabledVariantIds: data.enabledVariantIds ?? [],
        enabledSizes: data.enabledSizes ?? [],
        defaultPlacement: data.defaultPlacement
          ? (data.defaultPlacement as Prisma.InputJsonValue)
          : undefined,
        defaultPromptVersion: data.defaultPromptVersion ?? "v1",
        defaultAspectRatio: data.defaultAspectRatio ?? "1:1",
        storePresetSnapshot: data.storePresetSnapshot ?? undefined,
        isDefault: true,
      },
    });

    // Trigger variant cost cache async for new template
    triggerCacheRefresh(storeId, data.printifyBlueprintId, data.printifyPrintProviderId);

    return NextResponse.json(template, { status: 201 });
  }

  // Update only provided fields
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.printifyBlueprintId !== undefined) updateData.printifyBlueprintId = data.printifyBlueprintId;
  if (data.printifyPrintProviderId !== undefined) updateData.printifyPrintProviderId = data.printifyPrintProviderId;
  if (data.blueprintTitle !== undefined) updateData.blueprintTitle = data.blueprintTitle;
  if (data.printProviderTitle !== undefined) updateData.printProviderTitle = data.printProviderTitle;
  if (data.enabledVariantIds !== undefined) updateData.enabledVariantIds = data.enabledVariantIds;
  if (data.enabledSizes !== undefined) updateData.enabledSizes = data.enabledSizes;
  if (data.defaultPlacement !== undefined) updateData.defaultPlacement = data.defaultPlacement as Prisma.InputJsonValue;
  if (data.defaultPromptVersion !== undefined) updateData.defaultPromptVersion = data.defaultPromptVersion;
  if (data.defaultAspectRatio !== undefined) updateData.defaultAspectRatio = data.defaultAspectRatio;
  if (data.storePresetSnapshot !== undefined) updateData.storePresetSnapshot = data.storePresetSnapshot;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const template = await prisma.storeMockupTemplate.update({
    where: { storeId },
    data: updateData,
  });

  // Trigger variant cost cache refresh if blueprint/provider changed
  const bpChanged = data.printifyBlueprintId !== undefined || data.printifyPrintProviderId !== undefined;
  if (bpChanged) {
    triggerCacheRefresh(
      storeId,
      data.printifyBlueprintId ?? existing.printifyBlueprintId,
      data.printifyPrintProviderId ?? existing.printifyPrintProviderId,
    );
  }

  return NextResponse.json(template);
}

// ── Helper: fire-and-forget cache refresh ────────────────────────────────────

function triggerCacheRefresh(
  storeId: string,
  blueprintId: number,
  printProviderId: number,
) {
  getClientForStore(storeId)
    .then(({ client, externalShopId }) =>
      ensureVariantCostCache({
        client,
        shopId: externalShopId,
        blueprintId,
        printProviderId,
      }),
    )
    .catch((err) => {
      console.error(`[cost-cache] Async refresh failed for store ${storeId}:`, err);
      // Non-fatal — cache will be populated on next /sizes GET
    });
}
