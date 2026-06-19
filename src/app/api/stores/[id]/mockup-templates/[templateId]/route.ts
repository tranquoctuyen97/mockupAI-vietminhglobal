import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { updateTemplate, deleteTemplate } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";

import {
  normalizeMoneyValue,
  normalizePriceBySizeDefault,
} from "@/lib/pricing/template-pricing";
import type { Prisma } from "@prisma/client";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const { id: storeId, templateId } = await params;

  // Verify store belongs to tenant
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  // Verify template belongs to store
  const template = await prisma.storeMockupTemplate.findFirst({
    where: { id: templateId, storeId },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = await request.json();

  if (body.basePriceUsd != null && normalizeMoneyValue(body.basePriceUsd) == null) {
    return NextResponse.json(
      { error: "basePriceUsd must be a positive finite number" },
      { status: 400 },
    );
  }
  if (
    body.priceBySizeDefault != null &&
    normalizePriceBySizeDefault(body.priceBySizeDefault) == null
  ) {
    return NextResponse.json(
      { error: "priceBySizeDefault must be { sizeName: positivePrice }" },
      { status: 400 },
    );
  }

  const result = await updateTemplate(templateId, {
    name: body.name,
    printifyBlueprintId: body.printifyBlueprintId,
    printifyPrintProviderId: body.printifyPrintProviderId,
    blueprintTitle: body.blueprintTitle,
    printProviderTitle: body.printProviderTitle,
    previewUrl: body.previewUrl,
    position: body.position,
    enabledVariantIds: body.enabledVariantIds,
    enabledSizes: body.enabledSizes,
    defaultPlacement: body.defaultPlacement as Prisma.InputJsonValue,
    defaultAspectRatio: body.defaultAspectRatio,
    storePresetSnapshot: body.storePresetSnapshot as Prisma.InputJsonValue,
    printAreasByView: body.printAreasByView as Prisma.InputJsonValue,
    blueprintImageUrl: body.blueprintImageUrl,
    blueprintBrand: body.blueprintBrand,
    defaultMockupSource: body.defaultMockupSource,
    basePriceUsd:
      body.basePriceUsd === undefined ? undefined : body.basePriceUsd ?? null,
    priceBySizeDefault:
      body.priceBySizeDefault === undefined
        ? undefined
        : body.priceBySizeDefault ?? null,
    colorIds: body.colorIds,
  });

  return NextResponse.json(result);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const { id: storeId, templateId } = await params;

  // Verify store belongs to tenant
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  // Verify template belongs to store
  const template = await prisma.storeMockupTemplate.findFirst({
    where: { id: templateId, storeId },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  await deleteTemplate(templateId);
  return NextResponse.json({ success: true });
}
