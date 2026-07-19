import { Queue } from "bullmq";
import { redisConnection } from "@/lib/queue/queue";

export const PUBLISH_QUEUE_NAME = "publish-jobs";

export interface PublishJobPayload {
  listingId: string;
  draftId: string;
  tenantId: string;
  publishAttemptId: string;
}

const globalForPublishQueue = globalThis as unknown as {
  publishQueue?: Queue<PublishJobPayload>;
};

export function getPublishQueue(): Queue<PublishJobPayload> {
  if (!globalForPublishQueue.publishQueue) {
    globalForPublishQueue.publishQueue = new Queue<PublishJobPayload>(PUBLISH_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: {
          age: 24 * 60 * 60,
          count: 5000,
        },
        removeOnFail: {
          age: 7 * 24 * 60 * 60,
          count: 10000,
        },
      },
    });
    globalForPublishQueue.publishQueue.on("error", (err) => {
      console.error("[Queue/publish] Redis error:", err.message);
    });
  }
  return globalForPublishQueue.publishQueue;
}

export async function enqueuePublishJob(input: PublishJobPayload) {
  return getPublishQueue().add("publish-listing", input, {
    jobId: `publish-${input.listingId}-${input.publishAttemptId}`,
  });
}
