import { DelayedError, type Job, UnrecoverableError, Worker } from "bullmq";
import { prisma } from "@/lib/db";
import {
  AmbiguousExternalWriteError,
  type PublishErrorCode,
  publishUserMessageForCode,
} from "@/lib/publish/errors";
import { PUBLISH_QUEUE_NAME, type PublishJobPayload } from "@/lib/publish/queue";
import {
  type PublishInput,
  type PublishWorkerOptions,
  runPublishWorker,
} from "@/lib/publish/worker";
import { redisConnection } from "@/lib/queue/queue";

type PublishJobStatus =
  | "PENDING"
  | "RUNNING"
  | "WAITING_EXTERNAL"
  | "RETRY_SCHEDULED"
  | "SUCCEEDED"
  | "FAILED";

type ListingFinalStatus = "ACTIVE" | "FAILED" | "PARTIAL_FAILURE";

export type FinalizeFailedPublishAttemptInput = {
  listingId: string;
  publishAttemptId: string;
  error: unknown;
  errorCode?: PublishErrorCode;
  userMessage?: string;
};

export function resolveFinalListingStatus(input: {
  strategy: "EXISTING_SHOPIFY_DIRECT" | "PRINTIFY_SHOPIFY_CHANNEL";
  shopifyStatus: PublishJobStatus;
  printifyStatus: PublishJobStatus;
  shopifyProductId: string | null;
  printifyProductId: string | null;
  baselineListingStatus: string;
  firstExternalWriteStartedAt: Date | null;
}): ListingFinalStatus {
  const hasStartedExternalStage = input.firstExternalWriteStartedAt !== null;
  if (!hasStartedExternalStage) {
    if (input.baselineListingStatus === "ACTIVE") return "ACTIVE";
    if (input.baselineListingStatus === "PARTIAL_FAILURE") return "PARTIAL_FAILURE";
  }

  if (input.strategy === "EXISTING_SHOPIFY_DIRECT") {
    if (!input.shopifyProductId) return "FAILED";
    if (input.shopifyStatus !== "SUCCEEDED" || input.printifyStatus !== "SUCCEEDED") {
      return "PARTIAL_FAILURE";
    }
    if (!input.printifyProductId) return "PARTIAL_FAILURE";
    return "ACTIVE";
  }

  if (input.printifyStatus !== "SUCCEEDED") return "FAILED";
  if (!input.printifyProductId) return "FAILED";
  if (input.shopifyStatus !== "SUCCEEDED") return "PARTIAL_FAILURE";
  if (!input.shopifyProductId) return "PARTIAL_FAILURE";
  return "ACTIVE";
}

export async function finalizeFailedPublishAttemptIdempotently(
  input: FinalizeFailedPublishAttemptInput,
): Promise<void> {
  const [listing, attempt, jobs] = await Promise.all([
    prisma.listing.findUnique({
      where: { id: input.listingId },
      select: {
        id: true,
        shopifyProductId: true,
        printifyProductId: true,
        activePublishAttemptId: true,
      },
    }),
    prisma.publishAttempt.findUnique({
      where: { id: input.publishAttemptId },
      select: {
        id: true,
        status: true,
        baselineListingStatus: true,
        firstExternalWriteStartedAt: true,
      },
    }),
    prisma.publishJob.findMany({
      where: { publishAttemptId: input.publishAttemptId },
      select: { stage: true, status: true },
    }),
  ]);

  if (!listing || !attempt || ["SUCCEEDED", "FAILED"].includes(attempt.status)) return;

  const shopifyStatus =
    (jobs.find((job: { stage: string }) => job.stage === "SHOPIFY")?.status as PublishJobStatus) ??
    "FAILED";
  const printifyStatus =
    (jobs.find((job: { stage: string }) => job.stage === "PRINTIFY")?.status as PublishJobStatus) ??
    "FAILED";
  const strategy =
    shopifyStatus === "SUCCEEDED" && printifyStatus !== "SUCCEEDED"
      ? "EXISTING_SHOPIFY_DIRECT"
      : "PRINTIFY_SHOPIFY_CHANNEL";
  const finalStatus = resolveFinalListingStatus({
    strategy,
    shopifyStatus,
    printifyStatus,
    shopifyProductId: listing.shopifyProductId,
    printifyProductId: listing.printifyProductId,
    baselineListingStatus: attempt.baselineListingStatus,
    firstExternalWriteStartedAt: attempt.firstExternalWriteStartedAt,
  });
  const errorCode = input.errorCode ?? "UNKNOWN";
  const lastError = input.userMessage ?? publishUserMessageForCode(errorCode);

  await prisma.publishJob.updateMany({
    where: {
      publishAttemptId: input.publishAttemptId,
      status: { not: "SUCCEEDED" },
    },
    data: {
      status: "FAILED",
      lastErrorCode: errorCode,
      lastError,
      completedAt: new Date(),
    },
  });
  await prisma.publishAttempt.updateMany({
    where: { id: input.publishAttemptId, status: { notIn: ["SUCCEEDED", "FAILED"] } },
    data: { status: "FAILED", completedAt: new Date() },
  });
  await prisma.listing.updateMany({
    where: {
      id: input.listingId,
      activePublishAttemptId: input.publishAttemptId,
    },
    data: {
      activePublishAttemptId: null,
      status: finalStatus,
    },
  });
}

export function startPublishWorker(): Worker<PublishJobPayload> {
  const worker = new Worker<PublishJobPayload>(
    PUBLISH_QUEUE_NAME,
    async (job: Job<PublishJobPayload>, _token?: string) => {
      try {
        const workerInput: PublishInput = {
          listingId: job.data.listingId,
          draftId: job.data.draftId,
          tenantId: job.data.tenantId,
          publishAttemptId: job.data.publishAttemptId,
        };
        const options: PublishWorkerOptions = {
          retryOwner: "bullmq",
          publishAttemptId: job.data.publishAttemptId,
        };
        await runPublishWorker(workerInput, options);
      } catch (error) {
        if (error instanceof DelayedError) {
          throw error;
        }

        if (error instanceof AmbiguousExternalWriteError) {
          await finalizeFailedPublishAttemptIdempotently({
            listingId: job.data.listingId,
            publishAttemptId: job.data.publishAttemptId,
            error,
            errorCode: error.reasonCode,
          });
          throw new UnrecoverableError(error.message);
        }

        const attempts = Number(job.opts.attempts ?? 1);
        const isFinalAttempt = job.attemptsMade + 1 >= attempts;
        if (isFinalAttempt) {
          await finalizeFailedPublishAttemptIdempotently({
            listingId: job.data.listingId,
            publishAttemptId: job.data.publishAttemptId,
            error,
          });
        }
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: Number(process.env.PUBLISH_WORKER_CONCURRENCY ?? 3),
      maxStartedAttempts: Number(process.env.PUBLISH_WORKER_MAX_STARTED_ATTEMPTS ?? 50),
    },
  );

  worker.on("ready", () => {
    console.log("Publish worker is ready and listening to queue.");
  });
  worker.on("active", (job) => {
    console.log("[PublishWorker] Active job", job.id);
  });
  worker.on("completed", (job) => {
    console.log("[PublishWorker] Completed job", job.id);
  });
  worker.on("failed", (job, error) => {
    if (!job) return;

    void (async () => {
      const state = await job.getState();
      if (state !== "failed") return;

      await finalizeFailedPublishAttemptIdempotently({
        listingId: job.data.listingId,
        publishAttemptId: job.data.publishAttemptId,
        error,
      });
    })().catch((finalizeError) => {
      console.error("Publish failed-event finalizer failed", {
        listingId: job.data.listingId,
        publishAttemptId: job.data.publishAttemptId,
        error: finalizeError,
      });
    });
  });
  worker.on("error", (error) => {
    console.error("[PublishWorker] Worker error:", error);
  });
  worker.on("stalled", (jobId) => {
    console.warn("[PublishWorker] Stalled job", jobId);
  });

  return worker;
}
