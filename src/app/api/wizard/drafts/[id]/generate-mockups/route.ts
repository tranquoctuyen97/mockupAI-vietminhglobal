/**
 * POST /api/wizard/drafts/:id/generate-mockups
 * Enqueue mockup generation jobs
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getDraft } from "@/lib/wizard/state";
import { prisma } from "@/lib/db";
import { enqueueMockupJobs, type MockupJobData } from "@/lib/mockup/worker";

export const runtime = "nodejs";

interface SelectedColor {
  id: string | number;
  title: string;
  hex: string;
}

interface Placement {
  x: number;
  y: number;
  scale: number;
  position: "FRONT" | "BACK" | "SLEEVE";
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

  const placement = draft.placement as Placement | null;
  if (!placement) {
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

  // Delete old mockup jobs
  await prisma.mockupJob.deleteMany({
    where: { wizardDraftId: id },
  });

  // Update draft status
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
    jobsToCreate.map((job) =>
      prisma.mockupJob.create({ data: job }),
    ),
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

  // Process async (don't await — let SSE handle progress)
  enqueueMockupJobs(id, jobData).catch((err) =>
    console.error("[GenerateMockups] Queue error:", err),
  );

  return NextResponse.json({
    message: `Đang tạo ${createdJobs.length} mockups...`,
    jobIds: createdJobs.map((j) => j.id),
    total: createdJobs.length,
  });
}
