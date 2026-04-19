/**
 * BullMQ Queue Configuration
 * Shared Redis connection for all queues
 */

import { Queue, type ConnectionOptions } from "bullmq";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
  };
}

export const redisConnection = parseRedisUrl(REDIS_URL);

/**
 * Health check queue — runs every 6 hours
 */
export const healthCheckQueue = new Queue("health-check-stores", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  },
});
