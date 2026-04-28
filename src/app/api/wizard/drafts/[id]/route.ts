/**
 * GET    /api/wizard/drafts/:id — Get draft + readiness checklist
 * PATCH  /api/wizard/drafts/:id — Update draft (auto-save) + trigger regen if stale
 * DELETE /api/wizard/drafts/:id — Delete draft
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getDraft, updateDraft, deleteDraft } from "@/lib/wizard/state";
import { prisma } from "@/lib/db";
import { hasActiveMockupJob, regenerateMockupsForDraft } from "@/lib/mockup/regenerate";
import { validatePlacementSet } from "@/lib/placement/validate";
import { migratePlacementOnRead } from "@/lib/placement/migrate";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import type { PlacementData, DesignMeta } from "@/lib/placement/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const draft = await getDraft(id, session.tenantId);

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  // Build pre-publish checklist
  const checklist = await buildChecklist(draft);

  return NextResponse.json({ ...draft, checklist });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  try {
    const updated = await updateDraft(id, session.tenantId, body);

    // DB trigger sets mockupsStale if colors/design/placement changed.
    // After PATCH, check flag and enqueue regeneration if not already running.
    const freshDraft = await prisma.wizardDraft.findUnique({
      where: { id },
      select: { mockupsStale: true },
    });

    if (freshDraft?.mockupsStale) {
      const active = await hasActiveMockupJob(id);
      if (!active) {
        // Fire-and-forget — same pattern as initial generation
        regenerateMockupsForDraft(id).catch((err) =>
          console.error(`[PATCH] Regen failed for draft ${id}:`, err),
        );
      }
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteDraft(id, session.tenantId);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
}

// ── Checklist builder ────────────────────────────────────────────────────────

export async function buildChecklist(
  draft: any,
  deps: {
    getFeatureFlag?: (key: string) => Promise<{ enabled: boolean } | null>;
  } = {},
) {
  const selectedColorIds = new Set((draft.enabledColorIds ?? []) as string[]);
  const selectedColors = ((draft.store?.colors ?? []) as Array<{ id: string; name: string }>)
    .filter((color) => selectedColorIds.has(color.id));

  const realMockupsFlag = deps.getFeatureFlag
    ? await deps.getFeatureFlag("printify_real_mockups")
    : await prisma.featureFlag.findFirst({
        where: { key: "printify_real_mockups" },
      });
  const requireRealPrintifyMockups = realMockupsFlag?.enabled === true;

  const completedJobs = ((draft.mockupJobs ?? []) as Array<{
    status: string;
    images?: Array<{
      colorName: string;
      included: boolean;
      compositeUrl?: string | null;
      sourceUrl?: string | null;
    }>;
  }>)
    .filter((job) => job.status === "completed");
  const includedImages = completedJobs
    .flatMap((job) => job.images ?? [])
    .filter((image) => image.included)
    .filter((image) => !requireRealPrintifyMockups || isRealPrintifyMockup(image));

  // 1. Every selected color needs at least one included image from a completed job.
  const colorsWithMockup = new Set(
    includedImages.map((image) => normalizeColorName(image.colorName)),
  );
  const mockupsMatchColors =
    selectedColors.length > 0 &&
    selectedColors.every((color) => colorsWithMockup.has(normalizeColorName(color.name)));

  // 2. Content: title + description + tags present
  const content = draft.aiContent as {
    title?: string; description?: string; tags?: string[];
  } | null;
  const contentComplete = Boolean(
    content?.title?.trim() &&
    content?.description?.trim() &&
    (content?.tags?.length ?? 0) > 0,
  );

  // 3. Placement valid — re-use Phase 6.8 validator
  // If placement_boundary_strict flag is OFF, treat placement as valid
  let placementValid = true;
  try {
    const strictFlag = deps.getFeatureFlag
      ? await deps.getFeatureFlag("placement_boundary_strict")
      : await prisma.featureFlag.findFirst({
          where: { key: "placement_boundary_strict" },
        });
    if (strictFlag?.enabled !== false) {
      const placementData: PlacementData = migratePlacementOnRead(
        draft.placementOverride ?? draft.store?.template?.defaultPlacement,
      );
      const design = draft.design as { width: number; height: number; dpi: number | null } | null;
      if (design) {
        const designMeta: DesignMeta = {
          widthPx: design.width,
          heightPx: design.height,
          dpi: design.dpi,
        };
        const violations = validatePlacementSet(placementData, DEFAULT_PRINT_AREA, designMeta);
        placementValid = !violations.some((v) => v.severity === "error");
      }
    }
  } catch {
    // On error, treat as valid to avoid blocking publish
    placementValid = true;
  }

  // 4. Mockups not stale
  const mockupsNotStale = !draft.mockupsStale;

  const readyToPublish =
    mockupsMatchColors && contentComplete && placementValid && mockupsNotStale;

  return {
    mockupsMatchColors,
    contentComplete,
    placementValid,
    mockupsNotStale,
    readyToPublish,
  };
}

function normalizeColorName(value: string): string {
  return value.trim().toLowerCase();
}

function isRealPrintifyMockup(image: { compositeUrl?: string | null; sourceUrl?: string | null }): boolean {
  const url = image.compositeUrl ?? image.sourceUrl;
  if (!url || !/^https?:\/\//i.test(url)) return false;
  return !url.includes("via.placeholder.com");
}
