import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { normalizeAppliesToColorIds } from "@/lib/mockup/global-library";
import { storageUrl } from "@/lib/mockup/custom-library";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;
  const { id: storeId, templateId } = await params;
  const template = await loadCustomTemplate(session.tenantId, storeId, templateId);
  if (!template) return NextResponse.json({ error: "CUSTOM template not found" }, { status: 404 });

  const items = await prisma.templateMockupItem.findMany({
    where: { templateId },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: { mockup: true },
  });

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      mockup: {
        ...item.mockup,
        imageUrl: storageUrl(item.mockup.storagePath),
        previewUrl: item.mockup.previewPath ? storageUrl(item.mockup.previewPath) : null,
      },
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;
  const { id: storeId, templateId } = await params;
  const template = await loadCustomTemplate(session.tenantId, storeId, templateId);
  if (!template) return NextResponse.json({ error: "CUSTOM template not found" }, { status: 404 });

  const body = await request.json();
  const mockupId = String(body.mockupId ?? "");
  const mockup = await prisma.mockupLibraryItem.findFirst({
    where: { id: mockupId, tenantId: session.tenantId, isActive: true, deletedAt: null },
    select: { id: true, storeId: true },
  });
  if (!mockup) return NextResponse.json({ error: "Mockup not found" }, { status: 404 });

  if (mockup.storeId !== template.storeId) {
    return NextResponse.json({ error: "Mockup does not belong to this store" }, { status: 400 });
  }

  const validColorIds = new Set(template.store.colors.map((color) => color.id));
  const appliesToColorIds = normalizeAppliesToColorIds(body.appliesToColorIds ?? [], validColorIds);
  if (!appliesToColorIds) {
    return NextResponse.json({ error: "appliesToColorIds contains colors outside this store" }, { status: 400 });
  }

  const duplicate = await prisma.templateMockupItem.findUnique({
    where: { templateId_mockupId: { templateId, mockupId } },
    select: { id: true },
  });
  if (duplicate) {
    return NextResponse.json({ error: "Mockup is already attached to this template" }, { status: 409 });
  }

  const isPrimary = Boolean(body.isPrimary);
  const item = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.templateMockupItem.updateMany({ where: { templateId }, data: { isPrimary: false } });
    }
    return tx.templateMockupItem.create({
      data: {
        templateId,
        mockupId,
        appliesToColorIds,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        isPrimary,
      },
    });
  });

  return NextResponse.json(item, { status: 201 });
}

async function loadCustomTemplate(tenantId: string, storeId: string, templateId: string) {
  return prisma.storeMockupTemplate.findFirst({
    where: {
      id: templateId,
      storeId,
      defaultMockupSource: "CUSTOM",
      store: { tenantId, deletedAt: null },
    },
    include: {
      store: {
        select: { colors: { select: { id: true } } },
      },
    },
  });
}
