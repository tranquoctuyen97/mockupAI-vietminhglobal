import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { normalizeAppliesToColorIds } from "@/lib/mockup/global-library";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string; itemId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;
  const { id: storeId, templateId, itemId } = await params;
  const context = await loadContext(session.tenantId, storeId, templateId, itemId);
  if (!context) return NextResponse.json({ error: "Template mockup item not found" }, { status: 404 });

  const body = await request.json();
  const validColorIds = new Set(context.template.store.colors.map((color) => color.id));
  const appliesToColorIds =
    body.appliesToColorIds === undefined
      ? undefined
      : normalizeAppliesToColorIds(body.appliesToColorIds, validColorIds);
  if (body.appliesToColorIds !== undefined && !appliesToColorIds) {
    return NextResponse.json({ error: "appliesToColorIds contains colors outside this store" }, { status: 400 });
  }

  const isPrimary = body.isPrimary === undefined ? undefined : Boolean(body.isPrimary);
  const item = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.templateMockupItem.updateMany({ where: { templateId, id: { not: itemId } }, data: { isPrimary: false } });
    }
    return tx.templateMockupItem.update({
      where: { id: itemId },
      data: {
        appliesToColorIds: appliesToColorIds ?? undefined,
        sortOrder: body.sortOrder === undefined ? undefined : Number(body.sortOrder),
        isPrimary,
      },
    });
  });

  return NextResponse.json(item);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; templateId: string; itemId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;
  const { id: storeId, templateId, itemId } = await params;
  const context = await loadContext(session.tenantId, storeId, templateId, itemId);
  if (!context) return NextResponse.json({ error: "Template mockup item not found" }, { status: 404 });

  const references = await prisma.wizardDraftMockupLibraryPick.count({ where: { templateMockupItemId: itemId } });
  if (references > 0) {
    return NextResponse.json({ error: "Mockup attachment is used by drafts", references }, { status: 409 });
  }
  await prisma.templateMockupItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}

async function loadContext(tenantId: string, storeId: string, templateId: string, itemId: string) {
  const item = await prisma.templateMockupItem.findFirst({
    where: {
      id: itemId,
      templateId,
      template: { id: templateId, storeId, defaultMockupSource: "CUSTOM", store: { tenantId, deletedAt: null } },
    },
    include: {
      template: {
        include: {
          store: { select: { colors: { select: { id: true } } } },
        },
      },
    },
  });
  return item ? { item, template: item.template } : null;
}
