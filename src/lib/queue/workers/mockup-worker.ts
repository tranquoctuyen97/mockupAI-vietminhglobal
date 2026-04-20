/**
 * Mockup Generation Worker — BullMQ
 * Phase 6.10: replaces in-process fire-and-forget with proper BullMQ worker.
 *
 * This worker runs in the same Next.js process (started via instrumentation.ts).
 * For production scale, move to a separate worker process.
 */

import { Worker } from "bullmq";
import { redisConnection } from "../queue";
import { processMockupJob, type MockupJobData } from "@/lib/mockup/worker";

export function startMockupWorker() {
  const worker = new Worker<MockupJobData>(
    "mockup-generation",
    async (job) => {
      console.log(`[MockupWorker] Processing job ${job.id} for draft ${job.data.draftId}...`);
      await processMockupJob(job.data);
    },
    {
      connection: redisConnection,
      concurrency: 4, // Match previous in-process concurrency
    },
  );

  worker.on("completed", (job) => {
    console.log(`[MockupWorker] Job ${job.id} completed.`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[MockupWorker] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[MockupWorker] Worker error:", err.message);
  });

  return worker;
}
