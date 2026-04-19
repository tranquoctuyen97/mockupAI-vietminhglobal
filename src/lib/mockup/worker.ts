/**
 * Mockup generation queue + worker
 * Uses in-process execution (no separate worker process needed for v1)
 */

import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";
import { generateMockup } from "@/lib/mockup/composite";
import { sseChannels } from "@/lib/sse/channel";
import { readFile } from "node:fs/promises";

export interface MockupJobData {
  jobId: string;
  draftId: string;
  designStoragePath: string;
  colorHex: string;
  colorName: string;
  placement: {
    x: number;
    y: number;
    scale: number;
    position: "FRONT" | "BACK" | "SLEEVE";
  };
}

/**
 * Process a single mockup job
 */
export async function processMockupJob(data: MockupJobData): Promise<void> {
  const { jobId, draftId, designStoragePath, colorHex, placement } = data;

  try {
    // Mark as running
    await prisma.mockupJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", attempts: { increment: 1 } },
    });

    // Emit SSE: started
    sseChannels.emit(draftId, {
      type: "mockup.progress",
      data: { jobId, status: "RUNNING" },
    });

    // Load design from storage
    const storage = getStorage();
    const designPath = storage.resolvePath(designStoragePath);
    const designBuffer = await readFile(designPath);

    // Generate mockup
    const mockupBuffer = await generateMockup({
      designBuffer,
      colorHex,
      placement,
    });

    // Save mockup
    const mockupKey = `mockups/${draftId}/${jobId}.webp`;
    await storage.putBuffer(mockupKey, mockupBuffer);

    // Update job
    await prisma.mockupJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        mockupStoragePath: mockupKey,
        completedAt: new Date(),
      },
    });

    // Emit SSE: completed
    sseChannels.emit(draftId, {
      type: "mockup.completed",
      data: {
        jobId,
        status: "SUCCEEDED",
        previewUrl: storage.getPublicUrl(mockupKey),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[MockupWorker] Job ${jobId} failed:`, msg);

    await prisma.mockupJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: msg,
        completedAt: new Date(),
      },
    });

    sseChannels.emit(draftId, {
      type: "mockup.failed",
      data: { jobId, status: "FAILED", error: msg },
    });
  }
}

/**
 * Enqueue mockup jobs for a draft
 * v1: In-process async execution (no Redis/BullMQ needed)
 * v2: Migrate to BullMQ worker
 */
export async function enqueueMockupJobs(
  draftId: string,
  jobs: MockupJobData[],
): Promise<void> {
  // Process all jobs concurrently (max 4 at a time)
  const concurrency = 4;
  const chunks: MockupJobData[][] = [];

  for (let i = 0; i < jobs.length; i += concurrency) {
    chunks.push(jobs.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map((job) => processMockupJob(job)));
  }

  // Check if all jobs completed
  const allJobs = await prisma.mockupJob.findMany({
    where: { wizardDraftId: draftId },
  });

  const allDone = allJobs.every((j) => j.status === "SUCCEEDED" || j.status === "FAILED");
  const anySucceeded = allJobs.some((j) => j.status === "SUCCEEDED");

  if (allDone) {
    await prisma.wizardDraft.update({
      where: { id: draftId },
      data: { status: anySucceeded ? "READY" : "DRAFT" },
    });

    sseChannels.emit(draftId, {
      type: "generation.complete",
      data: {
        total: allJobs.length,
        succeeded: allJobs.filter((j) => j.status === "SUCCEEDED").length,
        failed: allJobs.filter((j) => j.status === "FAILED").length,
      },
    });
  }
}
