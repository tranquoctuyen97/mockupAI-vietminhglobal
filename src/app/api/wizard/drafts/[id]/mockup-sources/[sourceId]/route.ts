import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import {
  isCustomMockupScene,
  isCustomMockupView,
  parseCompositeRegionPx,
  serializeCustomMockupSource,
  toJson,
} from "@/lib/mockup/custom-library";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sourceId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { id: draftId, sourceId } = await params;
  const source = await findDraftSource(sourceId, draftId, session.tenantId);
  if (!source) return NextResponse.json({ error: "Draft mockup source not found" }, { status: 404 });

  const body = await request.json();
  const data: Prisma.CustomMockupSourceUpdateInput = {
    updatedBy: { connect: { id: session.id } },
  };
  const changedFields: Record<string, unknown> = {};
  let regionChanged = false;
  let nextCompositeRegion: Prisma.InputJsonValue | undefined;

  if ("label" in body) {
    data.label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;
    changedFields.label = data.label;
  }
  if ("view" in body) {
    if (!isCustomMockupView(body.view)) {
      return NextResponse.json({ error: "Invalid view" }, { status: 400 });
    }
    data.view = body.view;
    changedFields.view = body.view;
  }
  if ("sceneType" in body) {
    if (!isCustomMockupScene(body.sceneType)) {
      return NextResponse.json({ error: "Invalid sceneType" }, { status: 400 });
    }
    data.sceneType = body.sceneType;
    changedFields.sceneType = body.sceneType;
  }
  if ("sortOrder" in body) {
    const sortOrder = Number(body.sortOrder);
    if (!Number.isInteger(sortOrder)) {
      return NextResponse.json({ error: "Invalid sortOrder" }, { status: 400 });
    }
    data.sortOrder = sortOrder;
    changedFields.sortOrder = sortOrder;
  }
  if ("isPrimary" in body) {
    if (typeof body.isPrimary !== "boolean") {
      return NextResponse.json({ error: "Invalid isPrimary" }, { status: 400 });
    }
    data.isPrimary = body.isPrimary;
    changedFields.isPrimary = body.isPrimary;
  }
  if ("compositeRegionPx" in body) {
    const region = parseCompositeRegionPx(body.compositeRegionPx);
    if (!region) {
      return NextResponse.json({ error: "Invalid compositeRegionPx" }, { status: 400 });
    }
    nextCompositeRegion = toJson(region);
    data.compositeRegionPx = nextCompositeRegion;
    changedFields.compositeRegionPx = region;
    regionChanged = true;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (body.isPrimary === true) {
      await tx.customMockupSource.updateMany({
        where: {
          scope: "DRAFT",
          draftId,
          colorId: source.colorId,
          id: { not: sourceId },
          isActive: true,
          deletedAt: null,
        },
        data: { isPrimary: false },
      });
    }

    return tx.customMockupSource.update({
      where: { id: sourceId },
      data,
      include: {
        color: { select: { id: true, name: true, hex: true } },
      },
    });
  });

  const requestInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: regionChanged ? "custom_mockup.region_updated" : "custom_mockup.updated",
    resourceType: "custom_mockup_source",
    resourceId: sourceId,
    metadata: regionChanged
      ? ({
          scope: "DRAFT",
          draftId,
          before: source.compositeRegionPx,
          after: nextCompositeRegion,
        } as Prisma.InputJsonValue)
      : ({ scope: "DRAFT", draftId, ...changedFields } as Prisma.InputJsonValue),
    ...requestInfo,
  });

  return NextResponse.json(serializeCustomMockupSource(updated));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; sourceId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { id: draftId, sourceId } = await params;
  const source = await findDraftSource(sourceId, draftId, session.tenantId);
  if (!source) return NextResponse.json({ error: "Draft mockup source not found" }, { status: 404 });

  await prisma.customMockupSource.update({
    where: { id: sourceId },
    data: {
      isActive: false,
      deletedAt: new Date(),
      updatedById: session.id,
    },
  });

  const requestInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "custom_mockup.deleted",
    resourceType: "custom_mockup_source",
    resourceId: sourceId,
    metadata: { scope: "DRAFT", draftId, label: source.label } as Prisma.InputJsonValue,
    ...requestInfo,
  });

  return NextResponse.json({ ok: true });
}

async function findDraftSource(sourceId: string, draftId: string, tenantId: string) {
  return prisma.customMockupSource.findFirst({
    where: {
      id: sourceId,
      scope: "DRAFT",
      draftId,
      deletedAt: null,
      draft: { tenantId },
    },
  });
}
