/**
 * PUT /api/stores/:id/colors
 * Batch upsert store colors from Printify variant data
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { z } from "zod";

const ColorSchema = z.object({
  name: z.string().min(1),
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  printifyColorId: z.string().optional(),
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
  const parsed = ColorsBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { colors } = parsed.data;

  // Transaction: delete existing + insert new (full replace)
  await prisma.$transaction(async (tx) => {
    await tx.storeColor.deleteMany({ where: { storeId } });

    if (colors.length > 0) {
      await tx.storeColor.createMany({
        data: colors.map((c, i) => ({
          storeId,
          name: c.name,
          hex: c.hex,
          printifyColorId: c.printifyColorId ?? null,
          enabled: c.enabled,
          sortOrder: c.sortOrder ?? i,
        })),
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
