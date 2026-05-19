import { type Job, Worker } from "bullmq";
import { redisConnection, TW_SYNC_QUEUE_NAME } from "@/lib/queue/queue";
import { TWAuthError } from "@/lib/triple-whale/client";
import { handleSyncError, syncStore } from "@/lib/triple-whale/sync";
import type { TWSyncJobPayload } from "@/lib/triple-whale/types";

let tripleWhaleSyncWorker: Worker<TWSyncJobPayload> | null = null;

export function startTripleWhaleSyncWorker(): Worker<TWSyncJobPayload> {
  if (tripleWhaleSyncWorker) return tripleWhaleSyncWorker;

  tripleWhaleSyncWorker = new Worker<TWSyncJobPayload>(
    TW_SYNC_QUEUE_NAME,
    async (job: Job<TWSyncJobPayload>) => {
      const { storeId } = job.data;
      console.log(`[TripleWhaleSync] Starting sync for store ${storeId}`);

      try {
        await syncStore(storeId);
        console.log(`[TripleWhaleSync] Synced store ${storeId}`);
        return { success: true };
      } catch (error) {
        await handleSyncError(storeId, error);
        if (error instanceof TWAuthError) {
          console.error(`[TripleWhaleSync] Auth error for store ${storeId}: ${error.message}`);
          return { success: false, error: error.message };
        }
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 3,
    },
  );

  tripleWhaleSyncWorker.on("failed", (job, err) => {
    console.error(`[TripleWhaleSync] Job failed for store ${job?.data.storeId}:`, err.message);
  });

  return tripleWhaleSyncWorker;
}
