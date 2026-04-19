/**
 * POST /api/stores/:id/mockup-templates
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { saveStoreTemplates } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";

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
    where: { id, tenantId: session.tenantId, deletedAt: null },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const body = await request.json();
  const { templates } = body as {
    templates: Array<{
      name: string;
      printifyBlueprintId: number;
      printifyPrintProviderId: number;
      previewUrl?: string;
      position?: "FRONT" | "BACK" | "SLEEVE";
      isDefault?: boolean;
    }>;
  };

  if (!templates || !Array.isArray(templates)) {
    return NextResponse.json({ error: "templates array required" }, { status: 400 });
  }

  const result = await saveStoreTemplates(id, templates);
  return NextResponse.json(result);
}
