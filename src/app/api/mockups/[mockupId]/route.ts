import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import {
  normalizeCompositeRenderMode,
  normalizeMockupLibraryScene,
  normalizeMockupLibraryView,
} from "@/lib/mockup/global-library";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";
import { deleteMockupStorageObjects } from "@/lib/mockup/mockup-library-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ mockupId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { mockupId } = await params;
  const body = await request.json();
  const existing = await prisma.mockupLibraryItem.findFirst({
    where: { id: mockupId, tenantId: session.tenantId, isActive: true, deletedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "Mockup not found" }, { status: 404 });

  const renderMode = body.renderMode === undefined ? undefined : normalizeCompositeRenderMode(body.renderMode);
  if (body.renderMode !== undefined && renderMode !== "COMPOSITE") {
    return NextResponse.json({ error: "renderMode must be COMPOSITE" }, { status: 400 });
  }
  const view = body.view === undefined ? undefined : normalizeMockupLibraryView(body.view);
  if (body.view !== undefined && !view) {
    return NextResponse.json({ error: "view is invalid" }, { status: 400 });
  }
  const sceneType = body.sceneType === undefined ? undefined : normalizeMockupLibraryScene(body.sceneType);
  if (body.sceneType !== undefined && !sceneType) {
    return NextResponse.json({ error: "sceneType is invalid" }, { status: 400 });
  }

  const compositeRegionPx =
    body.compositeRegionPx === undefined
      ? undefined
      : normalizeCompositeRegionPx(body.compositeRegionPx);
  if (body.compositeRegionPx !== undefined && !compositeRegionPx) {
    return NextResponse.json({ error: "compositeRegionPx is invalid" }, { status: 400 });
  }

  const item = await prisma.mockupLibraryItem.update({
    where: { id: mockupId },
    data: {
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      view: view ?? undefined,
      sceneType: sceneType ?? undefined,
      renderMode: renderMode ?? undefined,
      compositeRegionPx: compositeRegionPx === undefined ? undefined : compositeRegionPx as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json(item);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ mockupId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { mockupId } = await params;
  const item = await prisma.mockupLibraryItem.findFirst({
    where: { id: mockupId, tenantId: session.tenantId, isActive: true, deletedAt: null },
  });
  if (!item) return NextResponse.json({ error: "Mockup not found" }, { status: 404 });

  const references = await prisma.templateMockupItem.count({ where: { mockupId } });
  if (references > 0) {
    return NextResponse.json({ error: "Mockup is attached to templates", references }, { status: 409 });
  }

  await deleteMockupStorageObjects(item);
  await prisma.mockupLibraryItem.delete({ where: { id: mockupId } });
  return NextResponse.json({ ok: true });
}
