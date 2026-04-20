/**
 * BullMQ Queue Configuration
 * Shared Redis connection for all queues
 *
 * Phase 6.10 Bug #1 fix: Lazy queue initialization — avoid crash at module
 * load time when Redis is temporarily down. Queues are created on first use.
 */

import { Queue, type ConnectionOptions } from "bullmq";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    // Prevent uncaught error events from crashing the process
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: (times: number) => {
      // Exponential backoff, max 10s between retries
      return Math.min(times * 500, 10_000);
    },
  };
}

export const redisConnection = parseRedisUrl(REDIS_URL);

// ── Queues (lazy singletons) ─────────────────────────────────────────────────

let _healthCheckQueue: Queue | null = null;
let _mockupQueue: Queue | null = null;

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
  if (!_healthCheckQueue) {
    _healthCheckQueue = new Queue("health-check-stores", {
      connection: redisConnection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    _healthCheckQueue.on("error", (err) => {
      console.error("[Queue/health-check] Redis error:", err.message);
    });
  }
  return _healthCheckQueue;
}

/**
 * Mockup generation queue — BullMQ backed
 * Phase 6.10: replaces in-process fire-and-forget
 */
export function getMockupQueue(): Queue {
  if (!_mockupQueue) {
    _mockupQueue = new Queue("mockup-generation", {
      connection: redisConnection,
      defaultJobOptions: {
        ...DEFAULT_JOB_OPTIONS,
        attempts: 2,
        backoff: { type: "exponential", delay: 2000 },
      },
    });
    _mockupQueue.on("error", (err) => {
      console.error("[Queue/mockup] Redis error:", err.message);
    });
  }
  return _mockupQueue;
}

// Keep backward compat — healthCheckQueue exported directly (used by health-check-worker)
export const healthCheckQueue = getHealthCheckQueue();
