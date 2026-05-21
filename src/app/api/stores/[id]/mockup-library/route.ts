import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getRequestInfo, logAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import {
  isCustomMockupScene,
  isCustomMockupView,
  isCustomRenderMode,
  parseCompositeRegionPx,
  serializeCustomMockupSource,
  toJson,
} from "@/lib/mockup/custom-library";
import {
  buildStoragePaths,
  normalizeCustomMockupUpload,
  setCustomSourcePrimary,
  ValidationError,
} from "@/lib/mockup/custom-source-service";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { id: storeId } = await params;
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const templates = await prisma.storeMockupTemplate.findMany({
    where: { storeId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      colors: {
        orderBy: { sortOrder: "asc" },
        include: { color: true },
      },
      customMockupSources: {
        where: { scope: "TEMPLATE", isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          color: { select: { id: true, name: true, hex: true } },
        },
      },
    },
  });

  return NextResponse.json({
    store,
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      blueprintTitle: template.blueprintTitle,
      printProviderTitle: template.printProviderTitle,
      colors: template.colors.map((entry) => ({
        templateColorId: entry.id,
        id: entry.color.id,
        name: entry.color.name,
        hex: entry.color.hex,
        sources: template.customMockupSources
          .filter((source) => source.colorId === entry.color.id)
          .map((source) => serializeCustomMockupSource(source)),
      })),
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { id: storeId } = await params;
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const form = await request.formData();
  const file = form.get("file");
  const templateId = stringValue(form.get("templateId"));
  const colorId = stringValue(form.get("colorId"));
  const renderMode = stringValue(form.get("renderMode"));
  const view = stringValue(form.get("view"));
  const sceneType = stringValue(form.get("sceneType"));
  const label = stringValue(form.get("label"))?.trim() || null;
  const isPrimary = stringValue(form.get("isPrimary")) === "true";
  const sortOrder = parseInteger(stringValue(form.get("sortOrder")), 0);
  const compositeRegionPx = parseCompositeRegionPx(form.get("compositeRegionPx"));

  if (!isFileLike(file)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!templateId || !colorId) {
    return NextResponse.json({ error: "templateId and colorId are required" }, { status: 400 });
  }
  if (!isCustomRenderMode(renderMode) || !isCustomMockupView(view) || !isCustomMockupScene(sceneType)) {
    return NextResponse.json({ error: "Invalid renderMode, view, or sceneType" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, and WebP images are supported" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File must be 10MB or smaller" }, { status: 400 });
  }
  if (renderMode === "COMPOSITE" && !compositeRegionPx) {
    return NextResponse.json({ error: "COMPOSITE renderMode requires compositeRegionPx" }, { status: 400 });
  }

  const template = await prisma.storeMockupTemplate.findFirst({
    where: {
      id: templateId,
      storeId,
      colors: { some: { colorId } },
    },
    select: { id: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Template/color combination not found" }, { status: 400 });
  }

  const sourceId = randomUUID();
  const paths = buildStoragePaths({
    scope: "TEMPLATE",
    storeId,
    templateId,
    colorId,
    sourceId,
    renderMode,
  });

  try {
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    await normalizeCustomMockupUpload({
      rawBuffer,
      contentType: file.type,
      storagePath: paths.storagePath,
      outputPath: paths.outputPath ?? undefined,
      renderMode,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const source = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.customMockupSource.updateMany({
        where: { scope: "TEMPLATE", templateId, colorId, isActive: true, deletedAt: null },
        data: { isPrimary: false },
      });
    }

    return tx.customMockupSource.create({
      data: {
        id: sourceId,
        scope: "TEMPLATE",
        storeId,
        templateId,
        colorId,
        storagePath: paths.storagePath,
        outputPath: paths.outputPath,
        label,
        view,
        sceneType,
        renderMode,
        compositeRegionPx: toJson(renderMode === "COMPOSITE" ? compositeRegionPx : null),
        isPrimary,
        sortOrder,
        uploadedById: session.id,
      },
      include: {
        template: { select: { blueprintTitle: true, name: true } },
        color: { select: { id: true, name: true, hex: true } },
      },
    });
  });

  const requestInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "custom_mockup.uploaded",
    resourceType: "custom_mockup_source",
    resourceId: source.id,
    metadata: {
      scope: "TEMPLATE",
      storeId,
      templateId,
      colorId,
      renderMode,
      view,
      sceneType,
    } as Prisma.InputJsonValue,
    ...requestInfo,
  });

  return NextResponse.json(
    serializeCustomMockupSource(source),
    { status: 201 },
  );
}

function stringValue(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" ? value : null;
}

function parseInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  return (
    !!value &&
    typeof value !== "string" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.type === "string" &&
    typeof value.size === "number"
  );
}
