/**
 * POST /api/wizard/drafts/:id/generate-mockups
 * Enqueue mockup generation jobs
 *
 * Phase 6.10 fix (Bug #2): PlacementData schema (Phase 6.8) uses
 * { version, variants: { variantId: { front: { xMm, yMm, widthMm, ... } } } }
 * The composite engine expects { x, y, scale, position } (0-1 relative values).
 * This route now converts PlacementData → composite-compatible format.
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getDraft } from "@/lib/wizard/state";
import { prisma } from "@/lib/db";
import { getMockupQueue } from "@/lib/queue/queue";
import { migratePlacementOnRead } from "@/lib/placement/migrate";
import type { PlacementData } from "@/lib/placement/types";
import type { MockupJobData } from "@/lib/mockup/worker";

export const runtime = "nodejs";

interface SelectedColor {
  id: string | number;
  title: string;
  hex: string;
}

// Legacy placement format expected by composite.ts
interface LegacyPlacement {
  x: number;
  y: number;
  scale: number;
  position: "FRONT" | "BACK" | "SLEEVE";
}

// Default print area dimensions (mm) — T-shirt front
const PRINT_AREA_W_MM = 355.6;
const PRINT_AREA_H_MM = 406.4;

/**
 * Convert Phase 6.8 PlacementData to legacy { x, y, scale, position } format.
 * Picks the first variant's front view. Falls back to centered defaults if none.
 *
 * x, y: 0-1 relative to print area
 * scale: widthMm / printAreaW (clamped 0.1-1.0)
 * position: "FRONT" | "BACK" | "SLEEVE"
 */
function toCompositeFormat(placementData: PlacementData): LegacyPlacement {
  // Try to find first variant's front placement
  const firstVariantKey = Object.keys(placementData.variants)[0];
  const views = firstVariantKey ? placementData.variants[firstVariantKey] : null;
  const frontPlacement = views?.front ?? views?.back ?? null;

  if (!frontPlacement) {
    // Fallback: centered, 50% scale
    return { x: 0.5, y: 0.5, scale: 0.5, position: "FRONT" };
  }

  // Determine position from which view key we found
  let position: LegacyPlacement["position"] = "FRONT";
  if (views?.back && !views?.front) position = "BACK";
  else if (views?.sleeve_left || views?.sleeve_right) position = "SLEEVE";

  // Convert mm → 0-1 relative to print area
  const x = Math.max(0, Math.min(1, frontPlacement.xMm / PRINT_AREA_W_MM));
  const y = Math.max(0, Math.min(1, frontPlacement.yMm / PRINT_AREA_H_MM));
  const scale = Math.max(0.1, Math.min(1.0, frontPlacement.widthMm / PRINT_AREA_W_MM));

  return { x, y, scale, position };
}

export async function POST(
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

  // Validate required fields
  if (!draft.designId) {
    return NextResponse.json({ error: "Chọn design trước" }, { status: 400 });
  }

  const colors = draft.selectedColors as SelectedColor[] | null;
  if (!colors || colors.length === 0) {
    return NextResponse.json({ error: "Chọn ít nhất 1 màu" }, { status: 400 });
  }

  if (!draft.placement) {
    return NextResponse.json({ error: "Thiết lập placement trước" }, { status: 400 });
  }

  // Get design storage path
  const design = await prisma.design.findUnique({
    where: { id: draft.designId },
    select: { storagePath: true },
  });

  if (!design) {
    return NextResponse.json({ error: "Design không tồn tại" }, { status: 400 });
  }

  // Phase 6.10 Bug #2 fix: migrate & convert PlacementData → legacy composite format
  const placementData: PlacementData = migratePlacementOnRead(draft.placement);
  const placement = toCompositeFormat(placementData);

  // Delete old mockup jobs
  await prisma.mockupJob.deleteMany({ where: { wizardDraftId: id } });

  // Update draft status
  // Note: mockupsStale flag is managed by DB trigger (0015c) — no need to reset here
  await prisma.wizardDraft.update({
    where: { id },
    data: { status: "GENERATING" },
  });

  // Create mockup jobs (1 per color)
  const jobsToCreate = colors.map((color) => ({
    wizardDraftId: id,
    colorName: color.title,
    colorHex: color.hex,
    templateId: `${draft.blueprintId || "default"}-${placement.position}`,
    templateName: `${color.title} - ${placement.position}`,
  }));

  const createdJobs = await Promise.all(
    jobsToCreate.map((job) => prisma.mockupJob.create({ data: job })),
  );

  // Build job data for processing
  const jobData: MockupJobData[] = createdJobs.map((job) => ({
    jobId: job.id,
    draftId: id,
    designStoragePath: design.storagePath,
    colorHex: job.colorHex,
    colorName: job.colorName,
    placement,
  }));

  // Phase 6.10: Use BullMQ instead of in-process fire-and-forget
  const mockupQueue = getMockupQueue();
  const enqueuePromises = jobData.map((data) =>
    mockupQueue.add("generate-mockup", data, {
      jobId: `mockup-${data.jobId}`, // idempotent
    }),
  );

  await Promise.all(enqueuePromises).catch((err) =>
    console.error("[GenerateMockups] Queue enqueue error:", err),
  );

  return NextResponse.json({
    message: `Đang tạo ${createdJobs.length} mockups...`,
    jobIds: createdJobs.map((j) => j.id),
    total: createdJobs.length,
    placement, // debug info
  });
}
