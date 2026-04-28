import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const MOCKUP_QUEUE_NAME = "mockup-composite-queue";
export const PRINTIFY_MOCKUP_QUEUE_NAME = "printify-mockup-poll-queue";

const connection = {
  url: redisUrl,
};

export interface PrintifyMockupPollPayload {
  mockupJobId: string;
  draftId: string;
  storeId: string;
  productId: string;
}

// Singleton queue instances
const globalForQueue = global as unknown as {
  mockupQueue: Queue;
  printifyMockupQueue: Queue<PrintifyMockupPollPayload>;
};

export const mockupQueue =
  globalForQueue.mockupQueue ||
  new Queue(MOCKUP_QUEUE_NAME, {
    connection,
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

export const printifyMockupQueue =
  globalForQueue.printifyMockupQueue ||
  new Queue<PrintifyMockupPollPayload>(PRINTIFY_MOCKUP_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 3000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForQueue.mockupQueue = mockupQueue;
  globalForQueue.printifyMockupQueue = printifyMockupQueue;
}

export interface MockupJobPayload {
  mockupImageId: string;
  sourceUrl: string;
  designStoragePath: string;
  placementData: any; // Placement
  colorOverlayHex?: string | null;
}
