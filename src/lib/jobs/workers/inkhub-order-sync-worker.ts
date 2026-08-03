import { type Job, Worker } from "bullmq";

import {
  dispatchRecentInkhubOrderSyncs,
  type InkhubOrderSyncJob,
  scheduleInkhubOrderSyncDispatcher,
} from "@/lib/inkhub/queue";
import { syncInkhubStore } from "@/lib/inkhub/sync";
import { INKHUB_ORDER_SYNC_QUEUE_NAME, redisConnection } from "@/lib/queue/queue";

const globalForInkhubOrderSyncWorker = globalThis as unknown as {
  inkhubOrderSyncWorker?: Worker<InkhubOrderSyncJob>;
};

export function startInkhubOrderSyncWorker(): Worker<InkhubOrderSyncJob> {
  if (globalForInkhubOrderSyncWorker.inkhubOrderSyncWorker) {
    return globalForInkhubOrderSyncWorker.inkhubOrderSyncWorker;
  }

  const worker = new Worker<InkhubOrderSyncJob>(
    INKHUB_ORDER_SYNC_QUEUE_NAME,
    async (job: Job<InkhubOrderSyncJob>) => {
      if (job.name === "dispatch-inkhub-order-syncs") {
        return dispatchRecentInkhubOrderSyncs();
      }

      const { tenantId, storeId, shopIds, kind } = job.data;
      if (!Array.isArray(shopIds) || shopIds.length === 0) {
        throw new Error("Inkhub sync job requires at least one shopId");
      }

      await job.updateProgress({ status: "syncing", shopIds, kind });
      const results = [];
      for (const shopId of shopIds) {
        results.push(await syncInkhubStore({ tenantId, storeId, shopId, mode: kind }));
      }
      await job.updateProgress({ status: "complete", results });
      return { success: true, results };
    },
    { connection: redisConnection, concurrency: 1 },
  );

  worker.on("failed", (job, error) => {
    console.error(`[InkhubOrderSync] Job failed for store ${job?.data.storeId}:`, error.message);
  });

  void scheduleInkhubOrderSyncDispatcher();
  globalForInkhubOrderSyncWorker.inkhubOrderSyncWorker = worker;
  return worker;
}
