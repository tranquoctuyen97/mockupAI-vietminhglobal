import { type Job, Worker } from "bullmq";
import {
  GMAIL_LABEL_OPERATIONS_QUEUE_NAME,
  MAILBOX_SYNC_QUEUE_NAME,
  redisConnection,
} from "@/lib/queue/queue";
import {
  dispatchActiveMailboxSyncs,
  scheduleMailboxSyncDispatcher,
  type GmailLabelOperationJobPayload,
  type MailboxSyncJobPayload,
} from "@/lib/mailboxes/queue";
import { syncMailbox, type SyncMailboxResult } from "@/lib/mailboxes/sync";
import { processGmailLabelOperation } from "@/lib/mailboxes/labels";

const globalForMailboxWorkers = globalThis as unknown as {
  mailboxSyncWorker?: Worker<MailboxSyncJobPayload>;
  gmailLabelOperationsWorker?: Worker<GmailLabelOperationJobPayload>;
};

export const MAILBOX_SYNC_WORKER_CONCURRENCY = Number(
  process.env.MAILBOX_SYNC_WORKER_CONCURRENCY ?? 1,
);
export const MAILBOX_SYNC_WORKER_LOCK_DURATION_MS = Number(
  process.env.MAILBOX_SYNC_WORKER_LOCK_DURATION_MS ?? 900_000,
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
  return {
    ...result,
    lastCommittedUid: result.lastCommittedUid.toString(),
  };
}
