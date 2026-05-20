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
      const { credentialId } = job.data;
      console.log(`[TripleWhaleSync] Starting sync for credential ${credentialId}`);

      try {
        await syncStore(credentialId);
        console.log(`[TripleWhaleSync] Synced credential ${credentialId}`);
        return { success: true };
      } catch (error) {
        await handleSyncError(credentialId, error);
        if (error instanceof TWAuthError) {
          console.error(`[TripleWhaleSync] Auth error for credential ${credentialId}: ${error.message}`);
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
    console.error(`[TripleWhaleSync] Job failed for credential ${job?.data.credentialId}:`, err.message);
  });

  return tripleWhaleSyncWorker;
}
