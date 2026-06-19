import { Queue } from "bullmq";
import { redisConnection } from "@/lib/queue/queue";

export const MOCKUP_QUEUE_NAME = "mockup-composite-queue";
export const PRINTIFY_MOCKUP_QUEUE_NAME = "printify-mockup-poll-queue";

export interface PrintifyMockupPollPayload {
  mockupJobId: string;
  draftId: string;
  draftDesignId?: string | null;
  designId?: string | null;
  storeId: string;
  productId: string;
  colorFilterIds?: string[];
  colorGroup?: "light" | "dark" | null;
}

// Singleton queue instances
const globalForQueue = global as unknown as {
  mockupQueue?: Queue;
  printifyMockupQueue?: Queue<PrintifyMockupPollPayload>;
};

export function getMockupCompositeQueue(): Queue {
  if (!globalForQueue.mockupQueue) {
    globalForQueue.mockupQueue = new Queue(MOCKUP_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }

  return globalForQueue.mockupQueue;
}

export function getPrintifyMockupQueue(): Queue<PrintifyMockupPollPayload> {
  if (!globalForQueue.printifyMockupQueue) {
    globalForQueue.printifyMockupQueue = new Queue<PrintifyMockupPollPayload>(
      PRINTIFY_MOCKUP_QUEUE_NAME,
      {
        connection: redisConnection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 3000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
    );
  }

  return globalForQueue.printifyMockupQueue;
}

export interface MockupJobPayload {
  mockupImageId: string;
  sourceUrl: string;
  designStoragePath: string;
  placementData: any; // Placement
  colorOverlayHex?: string | null;
}
