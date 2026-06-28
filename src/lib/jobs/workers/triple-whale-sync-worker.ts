import { type Job, Worker } from "bullmq";
import { redisConnection, TW_SYNC_QUEUE_NAME } from "@/lib/queue/queue";
import { TWAuthError } from "@/lib/triple-whale/client";
import { dispatchDueTripleWhaleSyncs, scheduleTripleWhaleSyncDispatcher } from "@/lib/triple-whale/queue";
import { handleSyncError, syncStore } from "@/lib/triple-whale/sync";
import type { TWSyncJobPayload } from "@/lib/triple-whale/types";

// HMR-safe singleton — survives Turbopack module re-evaluation
const globalForTWSyncWorker = globalThis as unknown as {
  tripleWhaleSyncWorker?: Worker<TWSyncJobPayload>;
};

export function startTripleWhaleSyncWorker(): Worker<TWSyncJobPayload> {
  if (globalForTWSyncWorker.tripleWhaleSyncWorker) return globalForTWSyncWorker.tripleWhaleSyncWorker;

  const worker = new Worker<TWSyncJobPayload>(
    TW_SYNC_QUEUE_NAME,
    async (job: Job<TWSyncJobPayload>) => {
      if (job.name === "dispatch-due-triple-whale-syncs") {
        return dispatchDueTripleWhaleSyncs();
      }

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

  worker.on("failed", (job, err) => {
    console.error(`[TripleWhaleSync] Job failed for credential ${job?.data.credentialId}:`, err.message);
  });

  void scheduleTripleWhaleSyncDispatcher();
  globalForTWSyncWorker.tripleWhaleSyncWorker = worker;
  return worker;
}
