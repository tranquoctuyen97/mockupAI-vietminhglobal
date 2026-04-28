/**
 * POST /api/stores/:id/mockup-templates — Upsert template (1:1)
 * PATCH /api/stores/:id/mockup-templates — Update placement only
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { upsertStoreTemplate, updateTemplatePlacement } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify store belongs to tenant
  const store = await prisma.store.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const body = await request.json();

  // Phase 6.10: Accept single template object (1:1 relation)
  const data = body as {
    name: string;
    printifyBlueprintId: number;
    printifyPrintProviderId: number;
    previewUrl?: string;
    position?: "FRONT" | "BACK" | "SLEEVE";
    defaultPlacement?: Record<string, unknown>;
  };

  if (!data.name || !data.printifyBlueprintId || !data.printifyPrintProviderId) {
    return NextResponse.json(
      { error: "name, printifyBlueprintId, and printifyPrintProviderId required" },
      { status: 400 },
    );
  }

  const result = await upsertStoreTemplate(id, {
    ...data,
    defaultPlacement: data.defaultPlacement as Prisma.JsonValue,
  });
  return NextResponse.json(result);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify store belongs to tenant
  const store = await prisma.store.findFirst({
    where: { id, tenantId: session.tenantId },
    include: { template: true },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  if (!store.template) {
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

  const result = await updateTemplatePlacement(id, defaultPlacement as Prisma.InputJsonValue);
  return NextResponse.json(result);
}
