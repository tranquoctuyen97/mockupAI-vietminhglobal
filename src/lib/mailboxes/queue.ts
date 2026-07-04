import type { Queue } from "bullmq";
import { prisma } from "@/lib/db";
import {
  getGmailLabelOperationsQueue,
  getMailboxSyncQueue,
  MAILBOX_SYNC_QUEUE_NAME,
} from "@/lib/queue/queue";
import { GMAIL_RATE_LIMIT_ERROR_CODE } from "./gmail-errors";

export interface MailboxSyncJobPayload {
  mailboxId: string;
}

export interface GmailLabelOperationJobPayload {
  operationId: string;
}

export const MAILBOX_SYNC_SCHEDULER_JOB_ID = "mailbox-sync-scheduler";
export const MAILBOX_SYNC_POLL_INTERVAL_MS = Number(process.env.MAILBOX_SYNC_POLL_INTERVAL_MS ?? 60_000);
export const MAILBOX_SYNC_RATE_LIMIT_BACKOFF_MS = Number(process.env.MAILBOX_SYNC_RATE_LIMIT_BACKOFF_MS ?? 60 * 60_000);

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
        NOT: {
          lastSyncErrorCode: GMAIL_RATE_LIMIT_ERROR_CODE,
          updatedAt: { gt: new Date(Date.now() - MAILBOX_SYNC_RATE_LIMIT_BACKOFF_MS) },
        },
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
    enqueued: mailboxes.length,
    recoveredLabelOperations: pendingLabelOperations.length,
  };
}
