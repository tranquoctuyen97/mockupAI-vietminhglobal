import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type Job, Worker } from "bullmq";
import sharp from "sharp";
import { redisConnection } from "@/lib/queue/queue";
import { prisma } from "../db";
import { DEFAULT_PLACEMENT, type Placement } from "../placement/types";
import { sseChannels } from "../sse/channel";
import { getStorage } from "../storage/local-disk";
import {
  type CustomCompositeRegion,
  compositeImage,
  compositeImageOnCustomMockup,
} from "./composite";
import { normalizeCompositeRegionPx, scaleCompositeRegionToImage } from "./custom-library";
import {
  computeCustomPrintAreaPx,
  computeListingReadyRegion,
  isBadCompositeRegion,
} from "./placement-region";
import { isFinalBullMqAttempt, shouldSkipMockupImageProcessing } from "./progress";
import { MOCKUP_QUEUE_NAME, type MockupJobPayload } from "./queue";
import { resolveMockupSourceBuffer } from "./source";
import { parseMockupSourceUrl } from "./source-url";

const concurrency = parseInt(process.env.MOCKUP_WORKER_CONCURRENCY || "5", 10);

// HMR-safe singleton — survives Turbopack module re-evaluation
const globalForMockupWorker = globalThis as unknown as {
  mockupWorker?: Worker<MockupJobPayload>;
};

export function startMockupCompositeWorker(): Worker<MockupJobPayload> {
  if (globalForMockupWorker.mockupWorker) return globalForMockupWorker.mockupWorker;

  const worker = new Worker<MockupJobPayload>(
    MOCKUP_QUEUE_NAME,
    async (job: Job<MockupJobPayload>) => {
      const { mockupImageId, sourceUrl, designStoragePath, placementData, colorOverlayHex } =
        job.data;

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

        const storage = getStorage();
        const parsed = parseMockupSourceUrl(sourceUrl);

        if (
          parsed.kind === "library" ||
          (parsed.kind === "custom" && (parsed.renderMode === "COMPOSITE" || parsed.renderMode === "FINAL"))
        ) {
          // Fetch mockup item data from the library pick
          const image = await prisma.mockupImage.findUniqueOrThrow({
            where: { id: mockupImageId },
            select: {
              mockupJobId: true,
              mockupJob: {
                select: {
                  draftId: true,
                },
              },
            },
          });

          let compositeRegionPx: unknown = null;
          let mockupWidth = 0;
          let mockupHeight = 0;

          if (parsed.kind === "library") {
            const pick = await prisma.wizardDraftMockupLibraryPick.findFirst({
              where: {
                draftId: image.mockupJob.draftId,
                templateMockupItemId: parsed.templateMockupItemId,
                colorId: parsed.colorId,
              },
              select: {
                compositeRegionPx: true,
                templateMockupItem: {
                  select: {
                    mockup: {
                      select: { compositeRegionPx: true, width: true, height: true },
                    },
                  },
                },
              },
            });
            if (pick) {
              compositeRegionPx = pick.compositeRegionPx ?? pick.templateMockupItem.mockup.compositeRegionPx;
              mockupWidth = pick.templateMockupItem.mockup.width;
              mockupHeight = pick.templateMockupItem.mockup.height;
            }
          }

          const outputKey = `custom-mockups/renders/${image.mockupJobId}/${mockupImageId}-output.webp`;
          const outputPath = storage.resolvePath(outputKey);
          await mkdir(dirname(outputPath), { recursive: true });

          // Fetch source buffer first — needed for both composite and default region fallback
          const sourceBuffer = await resolveMockupSourceBuffer(sourceUrl);
          const designBuffer = await readFile(storage.resolvePath(designStoragePath));

          // Resolve composite region: merge pick placement for TEMPLATE scope,
          // then use stored value if valid, else Smart Fit.
          // Extracts real print-area mm from template, computes pixel bounds from
          // actual mockup image dimensions (no more hardcoded 1000px).
          const sourceMeta = await sharp(sourceBuffer).metadata();
          const imgW = sourceMeta.width ?? 1000;
          const imgH = sourceMeta.height ?? 1000;

          // Extract print area mm for this view (default 340x420mm)
          const printAreaMm = { widthMm: 340, heightMm: 420 };
          const printAreaPx = computeCustomPrintAreaPx(printAreaMm, imgW, imgH);

          // Resolve effective region: draft pick override > library frame > Smart Fit
          const effectiveRegion = compositeRegionPx
            ? normalizeCompositeRegionPx(compositeRegionPx)
            : null;
          const runtimeRegion = effectiveRegion
            ? scaleCompositeRegionToImage(effectiveRegion, imgW, imgH)
            : null;

          let region: CustomCompositeRegion;
          if (runtimeRegion) {
            const stored = coerceCustomCompositeRegion(runtimeRegion);
            if (!isBadCompositeRegion(stored, printAreaPx)) {
              region = stored;
            } else {
              const designMeta = await sharp(designBuffer).metadata();
              const dw = designMeta.width ?? 1024;
              const dh = designMeta.height ?? 1024;
              const smart = computeListingReadyRegion(printAreaPx, dw, dh);
              region = { ...smart, rotationDeg: 0 };
              const sourceLabel = parsed.kind === "library" ? parsed.templateMockupItemId : parsed.sourceId;
              console.log(
                `[MockupWorker] Bad compositeRegionPx rejected for source ${sourceLabel}, replaced with Smart Fit ${JSON.stringify(region)}`,
              );
            }
          } else {
            const designMeta = await sharp(designBuffer).metadata();
            const dw = designMeta.width ?? 1024;
            const dh = designMeta.height ?? 1024;
            const smart = computeListingReadyRegion(printAreaPx, dw, dh);
            region = { ...smart, rotationDeg: 0 };
            const sourceLabel = parsed.kind === "library" ? parsed.templateMockupItemId : parsed.sourceId;
            console.log(
              `[MockupWorker] No compositeRegionPx for source ${sourceLabel}, using Smart Fit ${JSON.stringify(region)}`,
            );
          }

          await compositeImageOnCustomMockup(sourceBuffer, designBuffer, region, outputPath);

          // Write to MockupImage.compositeUrl only — no write to CustomMockupSource.outputPath
          await markImageCompleted(mockupImageId, outputKey);

          console.log(
            `[MockupWorker] Successfully processed custom composite image ${mockupImageId}`,
          );
          return { success: true, relativePath: outputKey };
        }

        // 2. Resolve storage path
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
      connection: redisConnection,
      concurrency,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed with ${err.message}`);
  });

  worker.on("completed", (job) => {
    console.log(`Job ${job.id} completed successfully`);
  });

  globalForMockupWorker.mockupWorker = worker;
  return worker;
}

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

function coerceCustomCompositeRegion(value: unknown): CustomCompositeRegion {
  if (!value || typeof value !== "object") {
    throw new Error("Custom mockup source is missing compositeRegionPx");
  }
  const region = value as Partial<CustomCompositeRegion>;
  const x = Number(region.x);
  const y = Number(region.y);
  const width = Number(region.width);
  const height = Number(region.height);
  const rotationDeg = Number(region.rotationDeg ?? 0);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(rotationDeg)
  ) {
    throw new Error("Invalid custom mockup compositeRegionPx");
  }

  return { x, y, width, height, rotationDeg };
}

async function markImageCompleted(mockupImageId: string, relativePath: string): Promise<void> {
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

async function markImageFailed(mockupImageId: string, message: string): Promise<void> {
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
      draftId: true,
      draftDesignId: true,
    },
  });
  if (!job || job.status !== "running") return;

  const finishedImages = job.completedImages + job.failedImages;

  // Emit per-image SSE progress tick so frontend updates immediately
  if (job.draftId) {
    sseChannels.emit(job.draftId, {
      type: "mockup.progress",
      data: {
        mockupJobId,
        draftDesignId: job.draftDesignId ?? null,
        totalImages: job.totalImages,
        completedImages: job.completedImages,
        failedImages: job.failedImages,
        status:
          finishedImages >= job.totalImages
            ? job.failedImages > 0
              ? "failed"
              : "completed"
            : "running",
        source: "composite",
      },
    });
  }

  if (finishedImages < job.totalImages) return;

  const finalStatus = job.failedImages > 0 ? "failed" : "completed";
  await prisma.mockupJob.update({
    where: { id: mockupJobId },
    data: {
      status: finalStatus,
      errorMessage: job.failedImages > 0 ? "Some mockup images failed" : null,
    },
  });
}
