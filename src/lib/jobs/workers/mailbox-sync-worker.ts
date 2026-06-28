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
      { connection: redisConnection, concurrency: 2 },
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
    { connection: redisConnection, concurrency: 4 },
  );
  return globalForMailboxWorkers.gmailLabelOperationsWorker;
}

export function serializeSyncMailboxResult(result: SyncMailboxResult) {
  return {
    ...result,
    lastCommittedUid: result.lastCommittedUid.toString(),
  };
}
