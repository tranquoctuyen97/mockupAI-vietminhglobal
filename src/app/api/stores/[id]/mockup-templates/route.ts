/**
 * POST /api/stores/:id/mockup-templates — Create template (1:N)
 * PATCH /api/stores/:id/mockup-templates — Update default template placement
 */

import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { createTemplate, updateTemplatePlacement } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

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
