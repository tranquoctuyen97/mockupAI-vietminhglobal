/**
 * BullMQ Queue Configuration
 * Shared Redis connection for all queues
 *
 * Phase 6.10 Bug #1 fix: Lazy queue initialization — avoid crash at module
 * load time when Redis is temporarily down. Queues are created on first use.
 */

import { type ConnectionOptions, Queue } from "bullmq";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    // lazyConnect: avoids crashing on module load if Redis is temporarily down
    lazyConnect: true,
    // enableOfflineQueue: true allows ioredis to buffer commands while reconnecting
    // (during HMR re-evals). BullMQ has its own retry logic on top of this.
    enableOfflineQueue: true,
    retryStrategy: (times: number) => {
      // Exponential backoff, max 10s between retries
      return Math.min(times * 500, 10_000);
    },
  };
}

export const redisConnection = parseRedisUrl(REDIS_URL);

// ── Queues (lazy singletons) ─────────────────────────────────────────────────

// HMR-safe singleton queues — survives Turbopack module re-evaluation
const globalForQueues = globalThis as unknown as {
  healthCheckQueue?: Queue;
  mockupQueue?: Queue;
  tripleWhaleSyncQueue?: Queue;
  mailboxSyncQueue?: Queue;
  mailboxBackfillQueue?: Queue;
  gmailLabelOperationsQueue?: Queue;
};

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: 100,
  removeOnFail: 50,
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 5000,
  },
};

/**
 * Health check queue — runs every 6 hours
 */
export function getHealthCheckQueue(): Queue {
  if (!globalForQueues.healthCheckQueue) {
    globalForQueues.healthCheckQueue = new Queue("health-check-stores", {
      connection: redisConnection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    globalForQueues.healthCheckQueue.on("error", (err) => {
      console.error("[Queue/health-check] Redis error:", err.message);
    });
  }
  return globalForQueues.healthCheckQueue;
}

/**
 * Mockup generation queue — BullMQ backed
 * Phase 6.10: replaces in-process fire-and-forget
 */
export function getMockupQueue(): Queue {
  if (!globalForQueues.mockupQueue) {
    globalForQueues.mockupQueue = new Queue("mockup-generation", {
      connection: redisConnection,
      defaultJobOptions: {
        ...DEFAULT_JOB_OPTIONS,
        attempts: 2,
        backoff: { type: "exponential", delay: 2000 },
      },
    });
    globalForQueues.mockupQueue.on("error", (err) => {
      console.error("[Queue/mockup] Redis error:", err.message);
    });
  }
  return globalForQueues.mockupQueue;
}

export const TW_SYNC_QUEUE_NAME = "triple-whale-sync";

export function getTripleWhaleSyncQueue(): Queue {
  if (!globalForQueues.tripleWhaleSyncQueue) {
    globalForQueues.tripleWhaleSyncQueue = new Queue(TW_SYNC_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 20,
        attempts: 5,
        backoff: { type: "exponential" as const, delay: 10_000 },
      },
    });
    globalForQueues.tripleWhaleSyncQueue.on("error", (err) => {
      console.error("[Queue/triple-whale-sync] Redis error:", err.message);
    });
  }
  return globalForQueues.tripleWhaleSyncQueue;
}

export const MAILBOX_SYNC_QUEUE_NAME = "mailbox-sync";
export const MAILBOX_BACKFILL_QUEUE_NAME = "mailbox-backfill";
export const GMAIL_LABEL_OPERATIONS_QUEUE_NAME = "gmail-label-operations";

export function getMailboxSyncQueue(): Queue {
  if (!globalForQueues.mailboxSyncQueue) {
    globalForQueues.mailboxSyncQueue = new Queue(MAILBOX_SYNC_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100,
        attempts: 5,
        backoff: { type: "exponential" as const, delay: 10_000 },
      },
    });
    globalForQueues.mailboxSyncQueue.on("error", (err) => {
      console.error("[Queue/mailbox-sync] Redis error:", err.message);
    });
  }
  return globalForQueues.mailboxSyncQueue;
}

export function getMailboxBackfillQueue(): Queue {
  if (!globalForQueues.mailboxBackfillQueue) {
    globalForQueues.mailboxBackfillQueue = new Queue(MAILBOX_BACKFILL_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: "exponential" as const, delay: 60_000 },
      },
    });
    globalForQueues.mailboxBackfillQueue.on("error", (err) => {
      console.error("[Queue/mailbox-backfill] Redis error:", err.message);
    });
  }
  return globalForQueues.mailboxBackfillQueue;
}

export function getGmailLabelOperationsQueue(): Queue {
  if (!globalForQueues.gmailLabelOperationsQueue) {
    globalForQueues.gmailLabelOperationsQueue = new Queue(GMAIL_LABEL_OPERATIONS_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100,
        attempts: 5,
        backoff: { type: "exponential" as const, delay: 5_000 },
      },
    });
    globalForQueues.gmailLabelOperationsQueue.on("error", (err) => {
      console.error("[Queue/gmail-label-operations] Redis error:", err.message);
    });
  }
  return globalForQueues.gmailLabelOperationsQueue;
}
