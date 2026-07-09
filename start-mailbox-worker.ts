import "./src/lib/env/standalone-worker-env";

import Redis from "ioredis";
import type { Worker } from "bullmq";
import {
  startGmailLabelOperationsWorker,
  startMailboxBackfillWorker,
  startMailboxSyncWorker,
} from "./src/lib/jobs/workers/mailbox-sync-worker";

type ClosableWorker = Pick<Worker, "close" | "on">;

let mailboxSyncWorker: ClosableWorker | null = null;
let mailboxBackfillWorker: ClosableWorker | null = null;
let gmailLabelOperationsWorker: ClosableWorker | null = null;

console.log("Starting mailbox BullMQ workers...");

startWorkers().catch((error) => {
  console.error("Mailbox worker startup failed:", error);
  process.exit(1);
});

async function startWorkers() {
  await assertRedisWritable();

  mailboxSyncWorker = await startMailboxSyncWorker();
  mailboxBackfillWorker = startMailboxBackfillWorker();
  gmailLabelOperationsWorker = startGmailLabelOperationsWorker();

  mailboxSyncWorker.on("ready", () => {
    console.log("Mailbox sync worker is ready and listening to queue.");
  });

  mailboxBackfillWorker.on("ready", () => {
    console.log("Mailbox backfill worker is ready and listening to queue.");
  });

  gmailLabelOperationsWorker.on("ready", () => {
    console.log("Gmail label operations worker is ready and listening to queue.");
  });
}

async function assertRedisWritable() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  const key = `mockupai:mailbox-worker:writable-check:${process.pid}`;
  try {
    await redis.connect();
    await redis.set(key, "1", "PX", 10_000);
    await redis.del(key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("READONLY")) {
      throw new Error("REDIS_URL points to a read-only replica; set it to the writable Redis primary.");
    }
    throw error;
  } finally {
    redis.disconnect();
  }
}

async function shutdown() {
  console.log("Shutting down mailbox workers...");
  await Promise.all([
    mailboxSyncWorker?.close(),
    mailboxBackfillWorker?.close(),
    gmailLabelOperationsWorker?.close(),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown().catch((error) => {
    console.error("Mailbox worker shutdown failed:", error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown().catch((error) => {
    console.error("Mailbox worker shutdown failed:", error);
    process.exit(1);
  });
});
