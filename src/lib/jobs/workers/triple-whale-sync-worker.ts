import { DelayedError, type Job, Worker } from "bullmq";
import { redisConnection, TW_SYNC_QUEUE_NAME } from "@/lib/queue/queue";
import { retryAtForTripleWhaleError } from "@/lib/triple-whale/backfill";
import { TWAuthError } from "@/lib/triple-whale/client";
import {
  dispatchDueTripleWhaleSyncs,
  scheduleTripleWhaleSyncDispatcher,
} from "@/lib/triple-whale/queue";
import { handleSyncError, syncStore, syncStoreRange } from "@/lib/triple-whale/sync";
import type { TWSyncJobPayload } from "@/lib/triple-whale/types";

// HMR-safe singleton — survives Turbopack module re-evaluation
const globalForTWSyncWorker = globalThis as unknown as {
  tripleWhaleSyncWorker?: Worker<TWSyncJobPayload>;
};

export function startTripleWhaleSyncWorker(): Worker<TWSyncJobPayload> {
  if (globalForTWSyncWorker.tripleWhaleSyncWorker)
    return globalForTWSyncWorker.tripleWhaleSyncWorker;

  const worker = new Worker<TWSyncJobPayload>(
    TW_SYNC_QUEUE_NAME,
    async (job: Job<TWSyncJobPayload>) => {
      if (job.name === "dispatch-due-triple-whale-syncs") {
        return dispatchDueTripleWhaleSyncs();
      }

      const { credentialId } = job.data;
      console.log(`[TripleWhaleSync] Starting sync for credential ${credentialId}`);

      try {
        await job.updateProgress({ status: "syncing" });
        if (job.data.kind === "backfill") {
          if (!job.data.from || !job.data.to) throw new Error("Backfill range is required");
          await syncStoreRange({ credentialId, from: job.data.from, to: job.data.to });
        } else {
          await syncStore(credentialId);
        }
        await job.updateProgress({ status: "complete" });
        console.log(`[TripleWhaleSync] Synced credential ${credentialId}`);
        return { success: true };
      } catch (error) {
        if (error instanceof TWAuthError) {
          await handleSyncError(credentialId, error);
          console.error(
            `[TripleWhaleSync] Auth error for credential ${credentialId}: ${error.message}`,
          );
          return { success: false, error: error.message };
        }
        const retryAt = retryAtForTripleWhaleError(error);
        if (retryAt != null) {
          await job.updateProgress({ status: "rate_limited", retryAt });
          await job.moveToDelayed(retryAt, job.token);
          throw new DelayedError();
        }
        await handleSyncError(credentialId, error);
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[TripleWhaleSync] Job failed for credential ${job?.data.credentialId}:`,
      err.message,
    );
  });

  void scheduleTripleWhaleSyncDispatcher();
  globalForTWSyncWorker.tripleWhaleSyncWorker = worker;
  return worker;
}
