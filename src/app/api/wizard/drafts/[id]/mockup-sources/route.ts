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
  resolveEffectiveCompositeRegion,
  serializeCustomMockupSource,
  toJson,
} from "@/lib/mockup/custom-library";
import {
  assertDraftSourceTarget,
  buildStoragePaths,
  normalizeCustomMockupUpload,
  ValidationError,
} from "@/lib/mockup/custom-source-service";
import { resolveCustomMockupSourceSelection } from "@/lib/mockup/custom-source-selection";
import { getEnabledViews, normalizePlacementData } from "@/lib/placement/views";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * GET /api/wizard/drafts/[id]/mockup-sources
 * Returns draft sources, eligible template sources, picked IDs, and current mode.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { id: draftId } = await params;
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    select: {
      id: true,
      storeId: true,
      templateId: true,
      mockupSourceMode: true,
      mockupsStaleReason: true,
      enabledColorIds: true,
      template: {
        select: {
          id: true,
          name: true,
          blueprintTitle: true,
          printProviderTitle: true,
          defaultMockupSource: true,
          defaultPlacement: true,
          colors: {
            orderBy: { sortOrder: "asc" },
            include: { color: { select: { id: true, name: true, hex: true } } },
          },
        },
      },
    },
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  // Draft-scoped custom sources
  const draftSources = await prisma.customMockupSource.findMany({
    where: { scope: "DRAFT", draftId, isActive: true, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { color: { select: { id: true, name: true, hex: true } } },
  });

  // Eligible TEMPLATE sources (all active template sources for this store/template)
  let eligibleTemplateSources: typeof draftSources = [];
  if (draft.templateId) {
    eligibleTemplateSources = await prisma.customMockupSource.findMany({
      where: {
        scope: "TEMPLATE",
        templateId: draft.templateId,
        colorId: { in: draft.enabledColorIds },
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { color: { select: { id: true, name: true, hex: true } } },
    });
  }

  // Library picks
  const picks = await prisma.wizardDraftMockupLibraryPick.findMany({
    where: { draftId },
    select: { sourceId: true, isPrimary: true, sortOrder: true, compositeRegionPx: true },
  });
  const resolvedSelection = resolveCustomMockupSourceSelection({
    sources: [...draftSources, ...eligibleTemplateSources],
    picks,
  });

  // Build lookup: sourceId → pick's compositeRegionPx
  const pickPlacementBySourceId = new Map<string, unknown>(
    picks
      .filter((p) => p.compositeRegionPx != null)
      .map((p) => [p.sourceId, p.compositeRegionPx]),
  );

  // Enhanced serialize: merge pick placement with source placement via shared resolver.
  // Precedence:
  //   DRAFT:    source.compositeRegionPx > pick.compositeRegionPx > null
  //   TEMPLATE: pick.compositeRegionPx > source.compositeRegionPx > null
  function serializeWithPickPlacement(
    source: (typeof draftSources)[number],
  ) {
    const serialized = serializeCustomMockupSource(source);
    const pickPlacement = pickPlacementBySourceId.get(source.id) ?? null;

    const effectiveCompositeRegionPx = resolveEffectiveCompositeRegion({
      scope: (source as any).scope as "DRAFT" | "TEMPLATE",
      sourceRegion: serialized.compositeRegionPx,
      pickRegion: pickPlacement,
    });

    return {
      ...serialized,
      compositeRegionPx: effectiveCompositeRegionPx,
      imageWidth: serialized.imageWidth ?? effectiveCompositeRegionPx?.imageWidth ?? null,
      imageHeight: serialized.imageHeight ?? effectiveCompositeRegionPx?.imageHeight ?? null,
    };
  }

  return NextResponse.json({
    template: draft.template
      ? {
          id: draft.template.id,
          name: draft.template.name,
          blueprintTitle: draft.template.blueprintTitle,
          printProviderTitle: draft.template.printProviderTitle,
          defaultMockupSource: draft.template.defaultMockupSource,
          selectedColors: draft.template.colors
            .filter((entry) => draft.enabledColorIds.includes(entry.color.id))
            .map((entry) => ({
              id: entry.color.id,
              name: entry.color.name,
              hex: entry.color.hex,
            })),
          selectedPlacements: getEnabledViews(
            normalizePlacementData(draft.template.defaultPlacement, false),
          ),
        }
      : null,
    draftSources: draftSources.map((s) => serializeWithPickPlacement(s)),
    eligibleTemplateSources: eligibleTemplateSources.map((s) => serializeWithPickPlacement(s)),
    selectedSourceIds: resolvedSelection.selectedSourceIds,
    primarySourceId: resolvedSelection.primarySourceId,
    pickedTemplateSourceIds: picks.map((p) => p.sourceId),
    mode: draft.mockupSourceMode,
    templateChangedWarning: draft.mockupsStaleReason === "template_changed",
  });
}

/**
 * POST /api/wizard/drafts/[id]/mockup-sources
 * Upload a DRAFT-scoped custom mockup source.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { id: draftId } = await params;

  const form = await request.formData();
  const file = form.get("file");
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
  if (!colorId) {
    return NextResponse.json({ error: "colorId is required" }, { status: 400 });
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

  // Validate draft ownership and color
  let storeId: string;
  let templateId: string | null;
  try {
    const target = await assertDraftSourceTarget({
      tenantId: session.tenantId,
      draftId,
      colorId,
    });
    storeId = target.storeId;
    templateId = target.templateId;
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const sourceId = randomUUID();
  const paths = buildStoragePaths({
    scope: "DRAFT",
    storeId,
    draftId,
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
    // Scope-aware primary uniqueness
    if (isPrimary) {
      await tx.customMockupSource.updateMany({
        where: { scope: "DRAFT", draftId, colorId, isActive: true, deletedAt: null },
        data: { isPrimary: false },
      });
    }

    const created = await tx.customMockupSource.create({
      data: {
        id: sourceId,
        scope: "DRAFT",
        storeId,
        templateId,
        draftId,
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
        color: { select: { id: true, name: true, hex: true } },
      },
    });

    // Auto-set mode to DRAFT_CUSTOM on first draft upload
    await tx.wizardDraft.update({
      where: { id: draftId },
      data: { mockupSourceMode: "DRAFT_CUSTOM" },
    });

    const existingSelectionCount = await tx.wizardDraftMockupLibraryPick.count({
      where: { draftId },
    });
    if (existingSelectionCount > 0) {
      if (isPrimary) {
        await tx.wizardDraftMockupLibraryPick.updateMany({
          where: { draftId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      await tx.wizardDraftMockupLibraryPick.create({
        data: {
          draftId,
          sourceId: created.id,
          colorId,
          isPrimary,
          sortOrder,
        },
      });
    }

    return created;
  });

  const requestInfo = getRequestInfo(request);
  await logAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    action: "custom_mockup.uploaded",
    resourceType: "custom_mockup_source",
    resourceId: source.id,
    metadata: {
      scope: "DRAFT",
      draftId,
      storeId,
      colorId,
      renderMode,
      view,
      sceneType,
    } as Prisma.InputJsonValue,
    ...requestInfo,
  });

  return NextResponse.json(serializeCustomMockupSource(source), { status: 201 });
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
