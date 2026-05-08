import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { FEATURES, type Feature } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";

// GET /api/admin/acl?role=ADMIN|OPERATOR
export async function GET(request: Request) {
  const { session, response } = await requireSuperAdmin();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");
  if (role !== "ADMIN" && role !== "OPERATOR") {
    return NextResponse.json({ error: "role must be ADMIN or OPERATOR" }, { status: 400 });
  }

  const rows = await prisma.tenantRolePermission.findMany({
    where: { tenantId: session.tenantId, role: role as any },
    select: { feature: true },
  });

  return NextResponse.json({ features: rows.map((r) => r.feature) });
}

// PATCH /api/admin/acl — replace all permissions for a role
export async function PATCH(request: Request) {
  const { session, response } = await requireSuperAdmin();
  if (response) return response;

  const body = await request.json();
  const { role, features } = body as { role: string; features: string[] };

  if (role !== "ADMIN" && role !== "OPERATOR") {
    return NextResponse.json({ error: "role must be ADMIN or OPERATOR" }, { status: 400 });
  }
  if (!Array.isArray(features)) {
    return NextResponse.json({ error: "features must be an array" }, { status: 400 });
  }

  const validFeatures = features.filter((f): f is Feature =>
    (FEATURES as readonly string[]).includes(f),
  );

  await prisma.$transaction([
    prisma.tenantRolePermission.deleteMany({
      where: { tenantId: session.tenantId, role: role as any },
    }),
    prisma.tenantRolePermission.createMany({
      data: validFeatures.map((feature) => ({
        tenantId: session.tenantId,
        role: role as any,
        feature,
      })),
    }),
  ]);

  return NextResponse.json({ ok: true, features: validFeatures });
}
