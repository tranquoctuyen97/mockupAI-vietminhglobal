import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Worker, Job } from "bullmq";
import { prisma } from "../db";
import { compositeImage } from "./composite";
import { MockupJobPayload, MOCKUP_QUEUE_NAME } from "./queue";
import { getStorage } from "../storage/local-disk";
import { DEFAULT_PLACEMENT, type Placement } from "../placement/types";
import {
  isFinalBullMqAttempt,
  shouldSkipMockupImageProcessing,
} from "./progress";
import {
  isSyntheticMockupSource,
  resolveMockupSourceBuffer,
} from "./source";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const concurrency = parseInt(process.env.MOCKUP_WORKER_CONCURRENCY || "5", 10);

const connection = {
  url: redisUrl,
};

export const mockupWorker = new Worker<MockupJobPayload>(
  MOCKUP_QUEUE_NAME,
  async (job: Job<MockupJobPayload>) => {
    const { mockupImageId, sourceUrl, designStoragePath, placementData, colorOverlayHex } = job.data;

    try {
      const currentImage = await prisma.mockupImage.findUnique({
        where: { id: mockupImageId },
        select: { compositeStatus: true },
      });
      if (shouldSkipMockupImageProcessing(currentImage)) {
        return { success: true, skipped: true };
      }

      // 1. Update status to processing
      await prisma.mockupImage.updateMany({
        where: { id: mockupImageId },
        data: { compositeStatus: "processing", compositeError: null },
      });

      // 2. Resolve storage path
      const storage = getStorage();
      const ext = ".png"; // Composite engine outputs PNG
      const relativePath = `mockups/composite_${mockupImageId}${ext}`;
      const absolutePath = storage.resolvePath(relativePath);
      await mkdir(dirname(absolutePath), { recursive: true });

      // 3. Composite image using existing engine
      const sourceBuffer = await resolveMockupSourceBuffer(sourceUrl, {
        colorHex: colorOverlayHex,
      });

      const designBuffer = await readFile(storage.resolvePath(designStoragePath));

      await compositeImage({
        mockupBuffer: sourceBuffer,
        designBuffer: designBuffer,
        placement: coercePlacement(placementData),
        outputPath: absolutePath,
      });

      // 4. Update status to completed
      await markImageCompleted(mockupImageId, relativePath);

      console.log(`[MockupWorker] Successfully processed image ${mockupImageId}`);
      return { success: true, relativePath };
    } catch (error) {
      console.error(`[MockupWorker] Failed to process image ${mockupImageId}`, error);

      const message = error instanceof Error ? error.message : "Unknown error";
      if (isFinalBullMqAttempt(job.attemptsMade, job.opts.attempts)) {
        await markImageFailed(mockupImageId, message);
      } else {
        await prisma.mockupImage.updateMany({
          where: {
            id: mockupImageId,
            compositeStatus: { notIn: ["completed", "failed"] },
          },
          data: {
            compositeStatus: "processing",
            compositeError: message,
          },
        });
      }

      throw error; // Let BullMQ handle retries
    }
  },
  {
    connection,
    concurrency,
  }
);

mockupWorker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed with ${err.message}`);
});

mockupWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

function coercePlacement(value: unknown): Placement {
  if (!value || typeof value !== "object") return DEFAULT_PLACEMENT;
  const placement = value as Partial<Placement>;
  if (
    typeof placement.xMm !== "number" ||
    typeof placement.yMm !== "number" ||
    typeof placement.widthMm !== "number" ||
    typeof placement.heightMm !== "number"
  ) {
    return DEFAULT_PLACEMENT;
  }

  return {
    ...DEFAULT_PLACEMENT,
    ...placement,
  };
}

async function markImageCompleted(
  mockupImageId: string,
  relativePath: string,
): Promise<void> {
  const image = await prisma.mockupImage.findUnique({
    where: { id: mockupImageId },
    select: { mockupJobId: true },
  });
  if (!image) return;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.mockupImage.updateMany({
      where: {
        id: mockupImageId,
        compositeStatus: { notIn: ["completed", "failed"] },
      },
      data: {
        compositeUrl: relativePath,
        compositeStatus: "completed",
        compositeError: null,
      },
    });

    if (result.count > 0) {
      await tx.mockupJob.update({
        where: { id: image.mockupJobId },
        data: { completedImages: { increment: 1 } },
      });
    }

    return result.count;
  });

  if (updated > 0) {
    await refreshMockupJobStatus(image.mockupJobId);
  }
}

async function markImageFailed(
  mockupImageId: string,
  message: string,
): Promise<void> {
  const image = await prisma.mockupImage.findUnique({
    where: { id: mockupImageId },
    select: { mockupJobId: true },
  });
  if (!image) return;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.mockupImage.updateMany({
      where: {
        id: mockupImageId,
        compositeStatus: { notIn: ["completed", "failed"] },
      },
      data: {
        compositeStatus: "failed",
        compositeError: message,
      },
    });

    if (result.count > 0) {
      await tx.mockupJob.update({
        where: { id: image.mockupJobId },
        data: { failedImages: { increment: 1 } },
      });
    }

    return result.count;
  });

  if (updated > 0) {
    await refreshMockupJobStatus(image.mockupJobId);
  }
}

async function refreshMockupJobStatus(mockupJobId: string): Promise<void> {
  const job = await prisma.mockupJob.findUnique({
    where: { id: mockupJobId },
    select: {
      totalImages: true,
      completedImages: true,
      failedImages: true,
      status: true,
    },
  });
  if (!job || job.status !== "running") return;

  const finishedImages = job.completedImages + job.failedImages;
  if (finishedImages < job.totalImages) return;

  await prisma.mockupJob.update({
    where: { id: mockupJobId },
    data: {
      status: job.failedImages > 0 ? "failed" : "completed",
      errorMessage: job.failedImages > 0 ? "Some mockup images failed" : null,
    },
  });
}
