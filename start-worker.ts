import dotenv from "dotenv";
import Redis from "ioredis";
import type { Worker } from "bullmq";

type ClosableWorker = Pick<Worker, "close" | "on">;

let mockupWorker: ClosableWorker | null = null;
let printifyMockupPollWorker: ClosableWorker | null = null;
let tripleWhaleSyncWorker: ClosableWorker | null = null;
let mailboxSyncWorker: ClosableWorker | null = null;
let mailboxBackfillWorker: ClosableWorker | null = null;
let gmailLabelOperationsWorker: ClosableWorker | null = null;

loadStandaloneWorkerEnv();

console.log("Starting BullMQ workers...");

startWorkers().catch((error) => {
  console.error("Worker startup failed:", error);
  process.exit(1);
});

function loadStandaloneWorkerEnv() {
  dotenv.config({ path: ".env" });

  if (process.env.NODE_ENV !== "production") {
    dotenv.config({ path: ".env.local", override: true });
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the standalone worker process.");
  }
}

async function startWorkers() {
  await assertRedisWritable();

  const [
    { startMockupCompositeWorker },
    { startPrintifyMockupPollWorker },
    { startTripleWhaleSyncWorker },
    { startMailboxSyncWorker, startMailboxBackfillWorker, startGmailLabelOperationsWorker },
  ] =
    await Promise.all([
      import("./src/lib/mockup/worker"),
      import("./src/lib/mockup/printify-poll-worker"),
      import("./src/lib/jobs/workers/triple-whale-sync-worker"),
      import("./src/lib/jobs/workers/mailbox-sync-worker"),
    ]);

  mockupWorker = startMockupCompositeWorker();
  printifyMockupPollWorker = startPrintifyMockupPollWorker();
  tripleWhaleSyncWorker = startTripleWhaleSyncWorker();
  mailboxSyncWorker = await startMailboxSyncWorker();
  mailboxBackfillWorker = startMailboxBackfillWorker();
  gmailLabelOperationsWorker = startGmailLabelOperationsWorker();

  mockupWorker.on("ready", () => {
    console.log("Mockup composite worker is ready and listening to queue.");
  });

  printifyMockupPollWorker.on("ready", () => {
    console.log("Printify mockup poll worker is ready and listening to queue.");
  });

  tripleWhaleSyncWorker.on("ready", () => {
    console.log("Triple Whale sync worker is ready and listening to queue.");
  });

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
  const key = `mockupai:worker:writable-check:${process.pid}`;
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
  console.log("Shutting down workers...");
  await Promise.all([
    mockupWorker?.close(),
    printifyMockupPollWorker?.close(),
    tripleWhaleSyncWorker?.close(),
    mailboxSyncWorker?.close(),
    mailboxBackfillWorker?.close(),
    gmailLabelOperationsWorker?.close(),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown().catch((error) => {
    console.error("Worker shutdown failed:", error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown().catch((error) => {
    console.error("Worker shutdown failed:", error);
    process.exit(1);
  });
});
