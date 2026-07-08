import type { Queue } from "bullmq";
import { prisma } from "@/lib/db";
import {
  getGmailLabelOperationsQueue,
  getMailboxBackfillQueue,
  getMailboxSyncQueue,
  MAILBOX_BACKFILL_QUEUE_NAME,
  MAILBOX_SYNC_QUEUE_NAME,
} from "@/lib/queue/queue";
import { GMAIL_RATE_LIMIT_ERROR_CODE } from "./gmail-errors";

export interface MailboxSyncJobPayload {
  mailboxId: string;
}

export interface MailboxBackfillJobPayload {
  mailboxId: string;
  folder?: "INBOX" | "SENT";
  lastCommittedUid?: string;
}

export interface GmailLabelOperationJobPayload {
  operationId: string;
}

export const MAILBOX_SYNC_SCHEDULER_JOB_ID = "mailbox-sync-scheduler";
export const MAILBOX_SYNC_POLL_INTERVAL_MS = Number(process.env.MAILBOX_SYNC_POLL_INTERVAL_MS ?? 60_000);
export const MAILBOX_SYNC_RATE_LIMIT_BACKOFF_MS = Number(process.env.MAILBOX_SYNC_RATE_LIMIT_BACKOFF_MS ?? 60 * 60_000);
export const MAILBOX_BACKFILL_CHUNK_DELAY_MS = Number(process.env.MAILBOX_BACKFILL_CHUNK_DELAY_MS ?? 60_000);
export const MAILBOX_BACKFILL_RETRY_DELAY_MS = Number(process.env.MAILBOX_BACKFILL_RETRY_DELAY_MS ?? 10 * 60_000);

export async function enqueueMailboxSync(
  mailboxId: string,
  queue: Queue<MailboxSyncJobPayload> = getMailboxSyncQueue(),
) {
  return queue.add(
    "sync-mailbox",
    { mailboxId },
    {
      jobId: `sync-${mailboxId}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function enqueueMailboxBackfill(
  input: string | MailboxBackfillJobPayload,
  queue: Queue<MailboxBackfillJobPayload> = getMailboxBackfillQueue(),
) {
  const data = typeof input === "string" ? { mailboxId: input } : input;
  const folder = data.folder ?? "INBOX";
  const lastCommittedUid = data.lastCommittedUid ?? "0";
  const delay = typeof input === "string" ? 0 : MAILBOX_BACKFILL_CHUNK_DELAY_MS;
  return queue.add(
    "backfill-mailbox",
    { ...data, folder, lastCommittedUid },
    {
      jobId: `backfill-${data.mailboxId}-${folder}-${lastCommittedUid}`,
      attempts: 20,
      backoff: { type: "fixed", delay: MAILBOX_BACKFILL_RETRY_DELAY_MS },
      delay,
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

export async function enqueueGmailLabelOperation(
  operationId: string,
  queue: Queue<GmailLabelOperationJobPayload> = getGmailLabelOperationsQueue(),
) {
  return queue.add(
    "gmail-label-operation",
    { operationId },
    {
      jobId: `label-${operationId}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
}

async function removeJobIfIdle(queue: Queue, jobId: string) {
  const job = await queue.getJob(jobId);
  if (!job) return;
  try {
    await job.remove();
  } catch {
    // Active jobs cannot be removed safely; workers already skip missing mailboxes.
  }
}

async function removeMailboxJobsByData(queue: Queue, mailboxId: string) {
  const jobs = await queue.getJobs(["waiting", "delayed", "failed", "completed", "paused"], 0, 1000);
  await Promise.all(
    jobs
      .filter((job) => (job.data as { mailboxId?: string }).mailboxId === mailboxId)
      .map((job) => job.remove().catch(() => undefined)),
  );
}

export async function removeMailboxJobs(mailboxId: string) {
  const [operations, syncQueue, backfillQueue, labelQueue] = await Promise.all([
    prisma.gmailLabelOperation.findMany({
      where: { mailboxId },
      select: { id: true },
    }),
    Promise.resolve(getMailboxSyncQueue()),
    Promise.resolve(getMailboxBackfillQueue()),
    Promise.resolve(getGmailLabelOperationsQueue()),
  ]);
  await Promise.all([
    removeJobIfIdle(syncQueue, `sync-${mailboxId}`),
    removeJobIfIdle(backfillQueue, `backfill-${mailboxId}`),
    removeMailboxJobsByData(backfillQueue, mailboxId),
    ...operations.map((operation) => removeJobIfIdle(labelQueue, `label-${operation.id}`)),
  ]);
}

export async function scheduleMailboxSyncDispatcher(
  queue: Queue = getMailboxSyncQueue(),
) {
  return queue.add(
    "dispatch-active-mailboxes",
    {},
    {
      jobId: MAILBOX_SYNC_SCHEDULER_JOB_ID,
      repeat: { every: MAILBOX_SYNC_POLL_INTERVAL_MS },
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );
}

export async function dispatchActiveMailboxSyncs() {
  const [mailboxes, pendingLabelOperations] = await Promise.all([
    prisma.mailbox.findMany({
      where: {
        isActive: true,
        syncStatus: { in: ["PROVISIONING", "ACTIVE", "DEGRADED"] },
        OR: [
          { lastSyncErrorCode: { not: GMAIL_RATE_LIMIT_ERROR_CODE } },
          { lastSyncErrorCode: null },
          { updatedAt: { lte: new Date(Date.now() - MAILBOX_SYNC_RATE_LIMIT_BACKOFF_MS) } },
        ],
      },
      select: { id: true },
    }),
    prisma.gmailLabelOperation.findMany({
      where: { state: "PENDING" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
  ]);
  await Promise.all([
    ...mailboxes.map((mailbox) => enqueueMailboxSync(mailbox.id)),
    ...pendingLabelOperations.map((operation) => enqueueGmailLabelOperation(operation.id)),
  ]);
  return {
    queue: MAILBOX_SYNC_QUEUE_NAME,
    backfillQueue: MAILBOX_BACKFILL_QUEUE_NAME,
    enqueued: mailboxes.length,
    recoveredLabelOperations: pendingLabelOperations.length,
  };
}
