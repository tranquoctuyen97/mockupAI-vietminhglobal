import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const VALID_COLOR_GROUPS = new Set(["auto", "light", "dark"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; colorId: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: storeId, colorId } = await params;
  const body = await request.json();
  const colorGroup = String(body.colorGroup ?? "").trim();

  if (!VALID_COLOR_GROUPS.has(colorGroup)) {
    return NextResponse.json(
      { error: "colorGroup must be auto, light, or dark" },
      { status: 400 },
    );
  }

  const color = await prisma.storeColor.findFirst({
    where: {
      id: colorId,
      storeId,
      store: { tenantId: session.tenantId },
    },
    select: { id: true },
  });

  if (!color) {
    return NextResponse.json({ error: "Color not found" }, { status: 404 });
  }

  const updated = await prisma.storeColor.update({
    where: { id: colorId },
    data: { colorGroup },
    select: {
      id: true,
      name: true,
      hex: true,
      enabled: true,
      sortOrder: true,
      colorGroup: true,
    },
  });

  return NextResponse.json({ color: updated });
}
