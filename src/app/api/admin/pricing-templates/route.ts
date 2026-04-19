import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * GET /api/admin/pricing-templates — List all pricing templates
 * PUT /api/admin/pricing-templates — Upsert batch
 */
export async function GET() {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templates = await prisma.productPricingTemplate.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { productType: "asc" },
  });

  return NextResponse.json({ templates });
}

export async function PUT(request: Request) {
  const session = await validateSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json();
  const { templates } = body as {
    templates: Array<{ productType: string; basePriceUsd: number }>;
  };

  if (!templates || !Array.isArray(templates)) {
    return NextResponse.json({ error: "templates array required" }, { status: 400 });
  }

  const results = await Promise.all(
    templates.map((t) =>
      prisma.productPricingTemplate.upsert({
        where: {
          tenantId_productType: {
            tenantId: session.tenantId,
            productType: t.productType,
          },
        },
        create: {
          tenantId: session.tenantId,
          productType: t.productType,
          basePriceUsd: t.basePriceUsd,
          updatedBy: session.id,
        },
        update: {
          basePriceUsd: t.basePriceUsd,
          updatedBy: session.id,
        },
      }),
    ),
  );

  return NextResponse.json({ templates: results });
}
