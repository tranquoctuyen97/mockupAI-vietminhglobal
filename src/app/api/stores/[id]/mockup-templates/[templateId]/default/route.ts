import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { setDefaultTemplate } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";

export async function PUT(
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

  await setDefaultTemplate(storeId, templateId);
  return NextResponse.json({ success: true });
}
