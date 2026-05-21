/**
 * PUT /api/stores/:id/colors
 * Batch upsert store colors from Printify variant data
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { z } from "zod";

const ColorSchema = z.object({
  name: z.string().min(1),
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  printifyColorId: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const ColorsBodySchema = z.object({
  colors: z.array(ColorSchema),
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

  const colors = await prisma.storeColor.findMany({
    where: { storeId },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ colors });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const { id: storeId } = await params;

  // Verify store belongs to tenant
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = ColorsBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { colors } = parsed.data;

  const incomingNames = new Set(colors.map((c) => c.name));

  // Transaction: safe upsert to avoid cascading delete of TemplateColor
  await prisma.$transaction(async (tx) => {
    // 1. Delete colors that are not in the incoming batch
    await tx.storeColor.deleteMany({
      where: {
        storeId,
        name: { notIn: Array.from(incomingNames) },
      },
    });

    // 2. Upsert incoming colors
    for (const [i, color] of colors.entries()) {
      await tx.storeColor.upsert({
        where: {
          storeId_name: {
            storeId,
            name: color.name,
          },
        },
        create: {
          storeId,
          name: color.name,
          hex: color.hex,
          printifyColorId: color.printifyColorId ?? null,
          enabled: color.enabled,
          sortOrder: color.sortOrder ?? i,
        },
        update: {
          hex: color.hex,
          printifyColorId: color.printifyColorId ?? null,
          enabled: color.enabled,
          sortOrder: color.sortOrder ?? i,
        },
      });
    }
  });

  // Return updated colors
  const updated = await prisma.storeColor.findMany({
    where: { storeId },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ colors: updated });
}
