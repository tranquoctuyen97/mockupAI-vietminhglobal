import { type Job, Worker } from "bullmq";
import {
  GMAIL_LABEL_OPERATIONS_QUEUE_NAME,
  getMailboxBackfillQueue,
  MAILBOX_BACKFILL_QUEUE_NAME,
  MAILBOX_RESPONSE_METRICS_QUEUE_NAME,
  MAILBOX_SYNC_QUEUE_NAME,
  redisConnection,
} from "@/lib/queue/queue";
import {
  type MailboxBackfillJobPayload,
  dispatchActiveMailboxSyncs,
  enqueueMailboxBackfill,
  enqueueMailboxResponseMetricsRebuild,
  scheduleMailboxSyncDispatcher,
  type GmailLabelOperationJobPayload,
  type MailboxResponseMetricsJobPayload,
  type MailboxSyncJobPayload,
} from "@/lib/mailboxes/queue";
import { backfillMailbox, syncMailbox, type SyncMailboxResult } from "@/lib/mailboxes/sync";
import { processGmailLabelOperation } from "@/lib/mailboxes/labels";
import { rebuildMailboxResponseMetricsBatch } from "@/lib/mailboxes/response-metrics";

const globalForMailboxWorkers = globalThis as unknown as {
  mailboxSyncWorker?: Worker<MailboxSyncJobPayload>;
  mailboxBackfillWorker?: Worker<MailboxBackfillJobPayload>;
  mailboxResponseMetricsWorker?: Worker<MailboxResponseMetricsJobPayload>;
  gmailLabelOperationsWorker?: Worker<GmailLabelOperationJobPayload>;
};

async function hasPendingBackfill(mailboxId: string) {
  const jobs = await getMailboxBackfillQueue().getJobs(["waiting", "active", "delayed", "paused"], 0, 100);
  return jobs.some((job) => job.data.mailboxId === mailboxId);
}

export const MAILBOX_SYNC_WORKER_CONCURRENCY = Number(
  process.env.MAILBOX_SYNC_WORKER_CONCURRENCY ?? 1,
);
export const MAILBOX_SYNC_WORKER_LOCK_DURATION_MS = Number(
  process.env.MAILBOX_SYNC_WORKER_LOCK_DURATION_MS ?? 900_000,
);
export const MAILBOX_BACKFILL_WORKER_CONCURRENCY = Number(
  process.env.MAILBOX_BACKFILL_WORKER_CONCURRENCY ?? 1,
);
export const MAILBOX_RESPONSE_METRICS_WORKER_CONCURRENCY = Number(
  process.env.MAILBOX_RESPONSE_METRICS_WORKER_CONCURRENCY ?? 1,
);
export const GMAIL_LABEL_OPERATIONS_WORKER_CONCURRENCY = Number(
  process.env.GMAIL_LABEL_OPERATIONS_WORKER_CONCURRENCY ?? 2,
);

export async function startMailboxSyncWorker() {
  if (!globalForMailboxWorkers.mailboxSyncWorker) {
    globalForMailboxWorkers.mailboxSyncWorker = new Worker<MailboxSyncJobPayload>(
      MAILBOX_SYNC_QUEUE_NAME,
      async (job: Job<MailboxSyncJobPayload>) => {
        if (job.name === "dispatch-active-mailboxes") {
          return dispatchActiveMailboxSyncs();
        }
        if (await hasPendingBackfill(job.data.mailboxId)) {
          console.log(`[MailboxSync] skip mailboxId=${job.data.mailboxId} reason=backfill_pending`);
          return serializeSyncMailboxResult({
            mailboxId: job.data.mailboxId,
            skipped: true,
            imported: 0,
            inherited: 0,
            lastCommittedUid: BigInt(0),
          });
        }
        return serializeSyncMailboxResult(await syncMailbox(job.data.mailboxId));
      },
      {
        connection: redisConnection,
        concurrency: MAILBOX_SYNC_WORKER_CONCURRENCY,
        lockDuration: MAILBOX_SYNC_WORKER_LOCK_DURATION_MS,
        maxStalledCount: 1,
      },
    );
  }
  await scheduleMailboxSyncDispatcher();
  return globalForMailboxWorkers.mailboxSyncWorker;
}

export function startMailboxBackfillWorker() {
  if (!globalForMailboxWorkers.mailboxBackfillWorker) {
    globalForMailboxWorkers.mailboxBackfillWorker = new Worker<MailboxBackfillJobPayload>(
      MAILBOX_BACKFILL_QUEUE_NAME,
      async (job: Job<MailboxBackfillJobPayload>) => {
        const result = await backfillMailbox(job.data);
        if (result.backfillNext) {
          await enqueueMailboxBackfill(result.backfillNext);
        }
        return serializeSyncMailboxResult(result);
      },
      {
        connection: redisConnection,
        concurrency: MAILBOX_BACKFILL_WORKER_CONCURRENCY,
        lockDuration: MAILBOX_SYNC_WORKER_LOCK_DURATION_MS,
        maxStalledCount: 1,
      },
    );
  }
  return globalForMailboxWorkers.mailboxBackfillWorker;
}

export function startMailboxResponseMetricsWorker() {
  if (!globalForMailboxWorkers.mailboxResponseMetricsWorker) {
    globalForMailboxWorkers.mailboxResponseMetricsWorker = new Worker<MailboxResponseMetricsJobPayload>(
      MAILBOX_RESPONSE_METRICS_QUEUE_NAME,
      async (job: Job<MailboxResponseMetricsJobPayload>) => {
        const result = await rebuildMailboxResponseMetricsBatch({
          ...job.data,
          dryRun: job.data.dryRun ?? false,
        });
        console.log(
          `[MailboxResponseMetrics] chunk_done mailboxId=${job.data.mailboxId ?? "all"} cursor=${job.data.cursorId ?? "start"} examined=${result.examined} written=${result.written} replied=${result.replied} skipped=${result.skipped} next=${result.nextCursorId ?? "done"}`,
        );
        if (result.nextCursorId) {
          await enqueueMailboxResponseMetricsRebuild({ ...job.data, cursorId: result.nextCursorId });
        }
        return result;
      },
      {
        connection: redisConnection,
        concurrency: MAILBOX_RESPONSE_METRICS_WORKER_CONCURRENCY,
        lockDuration: MAILBOX_SYNC_WORKER_LOCK_DURATION_MS,
        maxStalledCount: 1,
      },
    );
  }
  return globalForMailboxWorkers.mailboxResponseMetricsWorker;
}

export function startGmailLabelOperationsWorker() {
  if (globalForMailboxWorkers.gmailLabelOperationsWorker) {
    return globalForMailboxWorkers.gmailLabelOperationsWorker;
  }
  globalForMailboxWorkers.gmailLabelOperationsWorker = new Worker<GmailLabelOperationJobPayload>(
    GMAIL_LABEL_OPERATIONS_QUEUE_NAME,
    (job: Job<GmailLabelOperationJobPayload>) => processGmailLabelOperation(job.data.operationId),
    { connection: redisConnection, concurrency: GMAIL_LABEL_OPERATIONS_WORKER_CONCURRENCY },
  );
  return globalForMailboxWorkers.gmailLabelOperationsWorker;
}

export function serializeSyncMailboxResult(result: SyncMailboxResult) {
  return JSON.parse(JSON.stringify({
    ...result,
    lastCommittedUid: result.lastCommittedUid.toString(),
  }, (_, value) => (typeof value === "bigint" ? value.toString() : value)));
}
