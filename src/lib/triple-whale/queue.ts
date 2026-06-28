import type { Queue } from "bullmq";

import { prisma } from "@/lib/db";
import { getTripleWhaleSyncQueue } from "@/lib/queue/queue";

export const TRIPLE_WHALE_SYNC_DISPATCHER_JOB_ID = "triple-whale-sync-dispatcher";
export const TRIPLE_WHALE_SYNC_DISPATCHER_INTERVAL_MS = 30 * 60 * 1000;

export async function enqueueTripleWhaleSync(
  credentialId: string,
  tenantId: string,
  queue: Queue = getTripleWhaleSyncQueue(),
) {
  return queue.add(
    "sync-store",
    { credentialId, tenantId },
    { jobId: `tw-sync-${credentialId}-${Date.now()}` },
  );
}

export async function scheduleTripleWhaleSyncDispatcher(queue: Queue = getTripleWhaleSyncQueue()) {
  return queue.add(
    "dispatch-due-triple-whale-syncs",
    {},
    {
      jobId: TRIPLE_WHALE_SYNC_DISPATCHER_JOB_ID,
      repeat: { every: TRIPLE_WHALE_SYNC_DISPATCHER_INTERVAL_MS },
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );
}

export async function dispatchDueTripleWhaleSyncs() {
  const credentials = await prisma.tripleWhaleCredential.findMany({
    select: {
      id: true,
      tenantId: true,
      lastSyncedAt: true,
      syncIntervalMinutes: true,
    },
  });
  const now = Date.now();
  const due = credentials.filter((credential) => {
    if (!credential.lastSyncedAt) return true;
    return now - credential.lastSyncedAt.getTime() >= credential.syncIntervalMinutes * 60_000;
  });

  await Promise.all(due.map((credential) => enqueueTripleWhaleSync(credential.id, credential.tenantId)));
  return { enqueued: due.length };
}

export async function removePendingTripleWhaleSyncJobs(
  credentialId: string,
  queue: Queue = getTripleWhaleSyncQueue(),
) {
  const jobs = await queue.getJobs(["waiting", "delayed", "prioritized", "paused"]);
  const matchingJobs = jobs.filter((job) => job.data?.credentialId === credentialId);
  await Promise.all(matchingJobs.map((job) => job.remove()));
  return { removed: matchingJobs.length };
}
