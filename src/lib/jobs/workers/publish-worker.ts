import type { Prisma } from "@prisma/client";
import { DelayedError, type Job, UnrecoverableError, Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { PrintifyRateLimitError } from "@/lib/printify/client";
import { PrintifyCooldownActiveError } from "@/lib/printify/request-gate";
import {
  AmbiguousExternalWriteError,
  type PublishErrorCode,
  publishUserMessageForCode,
} from "@/lib/publish/errors";
import { MerchantAccountLockUnavailableError } from "@/lib/publish/merchant-account-lock";
import { PUBLISH_QUEUE_NAME, type PublishJobPayload } from "@/lib/publish/queue";
import { type PublishStrategy, resolvePublishStrategy } from "@/lib/publish/strategy";
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
type PublishTransaction = Prisma.TransactionClient;
type PublishStageStatusRow = {
  stage: string;
  status: string;
};

class PublishAttemptDidNotCompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishAttemptDidNotCompleteError";
  }
}

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

function haveRequiredPublishStagesSucceeded(jobs: PublishStageStatusRow[]): boolean {
  const statusByStage = new Map(jobs.map((job) => [job.stage, job.status]));
  return (
    statusByStage.get("SHOPIFY") === "SUCCEEDED" && statusByStage.get("PRINTIFY") === "SUCCEEDED"
  );
}

export async function finalizeFailedPublishAttemptIdempotently(
  input: FinalizeFailedPublishAttemptInput,
): Promise<void> {
  await prisma.$transaction((tx) => finalizeFailedPublishAttemptInTransaction(tx, input));
}

export async function finalizeFailedPublishAttemptInTransaction(
  tx: PublishTransaction,
  input: FinalizeFailedPublishAttemptInput,
): Promise<void> {
  const [listing, attempt, jobs] = await Promise.all([
    tx.listing.findUnique({
      where: { id: input.listingId },
      select: {
        id: true,
        shopifyProductId: true,
        printifyProductId: true,
        activePublishAttemptId: true,
        store: {
          include: {
            printifyShop: true,
          },
        },
      },
    }),
    tx.publishAttempt.findUnique({
      where: { id: input.publishAttemptId },
      select: {
        id: true,
        status: true,
        baselineListingStatus: true,
        firstExternalWriteStartedAt: true,
      },
    }),
    tx.publishJob.findMany({
      where: { publishAttemptId: input.publishAttemptId },
      select: { stage: true, status: true },
    }),
  ]);

  if (!listing || !attempt) return;

  const shopifyStatus =
    (jobs.find((job: { stage: string }) => job.stage === "SHOPIFY")?.status as PublishJobStatus) ??
    "FAILED";
  const printifyStatus =
    (jobs.find((job: { stage: string }) => job.stage === "PRINTIFY")?.status as PublishJobStatus) ??
    "FAILED";
  const strategy = listing.store
    ? resolvePublishStrategy(listing.store)
    : "EXISTING_SHOPIFY_DIRECT";
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

  if (!["SUCCEEDED", "FAILED"].includes(attempt.status)) {
    await tx.publishJob.updateMany({
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
    await tx.publishAttempt.updateMany({
      where: { id: input.publishAttemptId, status: { notIn: ["SUCCEEDED", "FAILED"] } },
      data: { status: "FAILED", completedAt: new Date() },
    });
  }

  await tx.listing.updateMany({
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

async function preparePublishAttemptForRun(input: {
  listingId: string;
  publishAttemptId: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const [listing, attempt, jobs] = await Promise.all([
      tx.listing.findUnique({
        where: { id: input.listingId },
        select: {
          id: true,
          status: true,
          publishedAt: true,
          activePublishAttemptId: true,
        },
      }),
      tx.publishAttempt.findUnique({
        where: { id: input.publishAttemptId },
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          firstExternalWriteStartedAt: true,
        },
      }),
      tx.publishJob.findMany({
        where: { publishAttemptId: input.publishAttemptId },
        select: { stage: true, status: true },
      }),
    ]);

    if (!listing || !attempt) return false;

    if (
      attempt.status === "SUCCEEDED" ||
      (listing.status === "ACTIVE" && haveRequiredPublishStagesSucceeded(jobs))
    ) {
      await finalizeSucceededPublishAttemptInTransaction(tx, input);
      return false;
    }

    if (attempt.status === "FAILED") {
      await finalizeFailedPublishAttemptInTransaction(tx, {
        listingId: input.listingId,
        publishAttemptId: input.publishAttemptId,
        error: new PublishAttemptDidNotCompleteError("Publish attempt already failed."),
      });
      return false;
    }

    if (listing.activePublishAttemptId !== input.publishAttemptId) return false;
    if (!["PENDING", "RUNNING"].includes(attempt.status)) return false;

    await tx.publishAttempt.updateMany({
      where: { id: input.publishAttemptId, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    return true;
  });
}

async function finalizeSucceededPublishAttemptInTransaction(
  tx: PublishTransaction,
  input: {
    listingId: string;
    publishAttemptId: string;
  },
): Promise<void> {
  const [listing, attempt, jobs] = await Promise.all([
    tx.listing.findUnique({
      where: { id: input.listingId },
      select: {
        id: true,
        status: true,
        publishedAt: true,
        activePublishAttemptId: true,
      },
    }),
    tx.publishAttempt.findUnique({
      where: { id: input.publishAttemptId },
      select: {
        status: true,
        startedAt: true,
        completedAt: true,
        firstExternalWriteStartedAt: true,
      },
    }),
    tx.publishJob.findMany({
      where: { publishAttemptId: input.publishAttemptId },
      select: { stage: true, status: true },
    }),
  ]);

  if (!listing || !attempt || attempt.status === "FAILED") return;

  const alreadySucceeded = attempt.status === "SUCCEEDED";
  if (!alreadySucceeded && !haveRequiredPublishStagesSucceeded(jobs)) return;

  const now = new Date();
  const completedAt = attempt.completedAt ?? listing.publishedAt ?? now;
  const startedAt = attempt.startedAt ?? attempt.firstExternalWriteStartedAt ?? completedAt;

  await tx.publishAttempt.updateMany({
    where: { id: input.publishAttemptId, status: { not: "FAILED" } },
    data: {
      status: "SUCCEEDED",
      startedAt,
      completedAt,
    },
  });
  await tx.listing.updateMany({
    where: {
      id: input.listingId,
      activePublishAttemptId: input.publishAttemptId,
    },
    data: {
      activePublishAttemptId: null,
      status: "ACTIVE",
    },
  });
}

export async function finalizeSucceededPublishAttemptIdempotently(input: {
  listingId: string;
  publishAttemptId: string;
}): Promise<void> {
  await prisma.$transaction((tx) => finalizeSucceededPublishAttemptInTransaction(tx, input));
}

async function reconcilePublishAttemptAfterRun(input: {
  listingId: string;
  publishAttemptId: string;
}): Promise<void> {
  const listing = await prisma.listing.findUnique({
    where: { id: input.listingId },
    select: {
      id: true,
      status: true,
      shopifyProductId: true,
      printifyProductId: true,
      store: {
        include: {
          printifyShop: true,
        },
      },
      publishAttempts: {
        where: { id: input.publishAttemptId },
        select: { id: true, status: true },
      },
      publishJobs: {
        where: { publishAttemptId: input.publishAttemptId },
        select: { stage: true, status: true, lastError: true, lastErrorCode: true },
      },
    },
  });

  const attempt = listing?.publishAttempts[0] ?? null;
  if (!listing || !attempt) return;
  if (attempt.status === "SUCCEEDED") {
    await finalizeSucceededPublishAttemptIdempotently(input);
    return;
  }
  if (attempt.status === "FAILED") {
    await finalizeFailedPublishAttemptIdempotently({
      listingId: input.listingId,
      publishAttemptId: input.publishAttemptId,
      error: new PublishAttemptDidNotCompleteError("Publish attempt already failed."),
    });
    return;
  }

  const shopifyStatus =
    (listing.publishJobs.find((job) => job.stage === "SHOPIFY")?.status as PublishJobStatus) ??
    "FAILED";
  const printifyStatus =
    (listing.publishJobs.find((job) => job.stage === "PRINTIFY")?.status as PublishJobStatus) ??
    "FAILED";
  const failedJob = listing.publishJobs.find((job) => job.status === "FAILED");
  if (failedJob) {
    const message = failedJob.lastError || `Publish stage ${failedJob.stage} failed.`;
    if (failedJob.lastErrorCode === "SHOPIFY_SYNC_TIMEOUT") {
      await finalizeFailedPublishAttemptIdempotently({
        listingId: input.listingId,
        publishAttemptId: input.publishAttemptId,
        error: new PublishAttemptDidNotCompleteError(message),
        errorCode: "SHOPIFY_SYNC_TIMEOUT",
        userMessage: failedJob.lastError ?? publishUserMessageForCode("SHOPIFY_SYNC_TIMEOUT"),
      });
      throw new UnrecoverableError(message);
    }
    throw new PublishAttemptDidNotCompleteError(message);
  }

  const strategy: PublishStrategy = listing.store
    ? resolvePublishStrategy(listing.store)
    : "EXISTING_SHOPIFY_DIRECT";
  const finalStatus = resolveFinalListingStatus({
    strategy,
    shopifyStatus,
    printifyStatus,
    shopifyProductId: listing.shopifyProductId,
    printifyProductId: listing.printifyProductId,
    baselineListingStatus: "PUBLISHING",
    firstExternalWriteStartedAt: new Date(),
  });

  if (finalStatus !== "ACTIVE" || shopifyStatus !== "SUCCEEDED" || printifyStatus !== "SUCCEEDED") {
    throw new PublishAttemptDidNotCompleteError(
      `Publish attempt returned before all required stages completed. listingStatus=${listing.status} shopifyStatus=${shopifyStatus} printifyStatus=${printifyStatus}`,
    );
  }

  await finalizeSucceededPublishAttemptIdempotently(input);
}

async function delayPublishAttemptJob(input: {
  job: Job<PublishJobPayload>;
  token: string;
  retryAt: Date;
  reasonCode: string;
  message: string;
}): Promise<never> {
  await prisma.publishJob.updateMany({
    where: {
      publishAttemptId: input.job.data.publishAttemptId,
      status: { not: "SUCCEEDED" },
    },
    data: {
      status: "RETRY_SCHEDULED",
      nextRetryAt: input.retryAt,
      reasonCode: input.reasonCode,
      lastError: input.message,
    },
  });
  await input.job.moveToDelayed(input.retryAt.getTime(), input.token);
  throw new DelayedError();
}

export function startPublishWorker(): Worker<PublishJobPayload> {
  const worker = new Worker<PublishJobPayload>(
    PUBLISH_QUEUE_NAME,
    async (job: Job<PublishJobPayload>, token?: string) => {
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
        const shouldRun = await preparePublishAttemptForRun({
          listingId: job.data.listingId,
          publishAttemptId: job.data.publishAttemptId,
        });
        if (!shouldRun) return;

        await runPublishWorker(workerInput, options);
        await reconcilePublishAttemptAfterRun({
          listingId: job.data.listingId,
          publishAttemptId: job.data.publishAttemptId,
        });
      } catch (error) {
        if (
          token &&
          (error instanceof MerchantAccountLockUnavailableError ||
            error instanceof PrintifyCooldownActiveError ||
            error instanceof PrintifyRateLimitError)
        ) {
          const retryAt =
            error instanceof PrintifyRateLimitError
              ? new Date(Date.now() + Math.max(5_000, error.retryAfterMs ?? 60_000))
              : error.retryAt;
          const reasonCode =
            error instanceof MerchantAccountLockUnavailableError
              ? "PRINTIFY_LOCK_BUSY"
              : "PRINTIFY_RATE_LIMITED";
          const message =
            error instanceof MerchantAccountLockUnavailableError
              ? "Tài khoản Printify đang xử lý job khác. Hệ thống sẽ tự thử lại."
              : publishUserMessageForCode("PRINTIFY_RATE_LIMITED");

          await delayPublishAttemptJob({
            job,
            token,
            retryAt,
            reasonCode,
            message,
          });
        }

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
    void finalizeSucceededPublishAttemptIdempotently({
      listingId: job.data.listingId,
      publishAttemptId: job.data.publishAttemptId,
    }).catch((finalizeError) => {
      console.error("Publish completed-event finalizer failed", {
        listingId: job.data.listingId,
        publishAttemptId: job.data.publishAttemptId,
        error: finalizeError,
      });
    });
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
