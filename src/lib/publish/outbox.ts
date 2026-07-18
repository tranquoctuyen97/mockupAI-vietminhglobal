import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { finalizeFailedPublishAttemptIdempotently } from "@/lib/jobs/workers/publish-worker";
import { enqueuePublishJob } from "@/lib/publish/queue";

const PUBLISH_OUTBOX_BATCH_SIZE = Number(process.env.PUBLISH_OUTBOX_BATCH_SIZE ?? 25);
const PUBLISH_OUTBOX_INTERVAL_MS = Number(process.env.PUBLISH_OUTBOX_INTERVAL_MS ?? 5_000);
const PUBLISH_OUTBOX_STALE_MS = Number(process.env.PUBLISH_OUTBOX_STALE_MS ?? 60_000);
const PUBLISH_OUTBOX_MAX_ATTEMPTS = Number(process.env.PUBLISH_OUTBOX_MAX_ATTEMPTS ?? 10);
const WORKER_INSTANCE_ID = randomUUID();

type ClaimedPublishOutboxRow = {
  id: string;
  listing_id: string;
  wizard_draft_id: string;
  tenant_id: string;
  publish_attempt_id: string;
  attempts: number;
};

export function publishOutboxLockedBy(): string {
  return `${hostname()}:${process.pid}:${WORKER_INSTANCE_ID}`;
}

export async function createPublishOutboxRow(input: {
  listingId: string;
  draftId: string;
  tenantId: string;
  publishAttemptId: string;
}) {
  return prisma.publishOutbox.create({
    data: {
      listingId: input.listingId,
      draftId: input.draftId,
      tenantId: input.tenantId,
      publishAttemptId: input.publishAttemptId,
    },
  });
}

export async function dispatchPendingPublishOutbox(
  limit = PUBLISH_OUTBOX_BATCH_SIZE,
): Promise<number> {
  const rows = await claimPendingPublishOutbox(limit);
  let dispatched = 0;
  for (const row of rows) {
    try {
      await enqueuePublishJob({
        listingId: row.listing_id,
        draftId: row.wizard_draft_id,
        tenantId: row.tenant_id,
        publishAttemptId: row.publish_attempt_id,
      });
      await markPublishOutboxDispatched(row.id);
      dispatched += 1;
    } catch (enqueueError) {
      if (row.attempts >= PUBLISH_OUTBOX_MAX_ATTEMPTS) {
        await markPublishOutboxDead(row.id, enqueueError);
        await finalizeFailedPublishAttemptIdempotently({
          listingId: row.listing_id,
          publishAttemptId: row.publish_attempt_id,
          error: enqueueError,
          errorCode: "PUBLISH_ENQUEUE_FAILED",
        });
      } else {
        await reschedulePublishOutbox(row.id, enqueueError, row.attempts);
      }
    }
  }
  return dispatched;
}

async function claimPendingPublishOutbox(limit: number): Promise<ClaimedPublishOutboxRow[]> {
  return prisma.$queryRaw<ClaimedPublishOutboxRow[]>(
    Prisma.sql`
      UPDATE "publish_outbox"
      SET status = 'DISPATCHING',
          locked_at = now(),
          locked_by = ${publishOutboxLockedBy()},
          attempts = attempts + 1
      WHERE id IN (
        SELECT id
        FROM "publish_outbox"
        WHERE status = 'PENDING'
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING id, listing_id, wizard_draft_id, tenant_id, publish_attempt_id, attempts
    `,
  );
}

export async function markPublishOutboxDispatched(id: string): Promise<void> {
  await prisma.publishOutbox.update({
    where: { id },
    data: {
      status: "DISPATCHED",
      dispatchedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

export async function reschedulePublishOutbox(
  id: string,
  error: unknown,
  attempts: number,
): Promise<void> {
  const delayMs = Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
  await prisma.publishOutbox.update({
    where: { id },
    data: {
      status: "PENDING",
      nextAttemptAt: new Date(Date.now() + delayMs),
      lockedAt: null,
      lockedBy: null,
      lastError: sanitizeOutboxError(error),
    },
  });
}

export async function markPublishOutboxDead(id: string, error: unknown): Promise<void> {
  await prisma.publishOutbox.update({
    where: { id },
    data: {
      status: "DEAD",
      lockedAt: null,
      lockedBy: null,
      lastError: sanitizeOutboxError(error),
    },
  });
}

export function startPublishOutboxDispatcher(): { close: () => Promise<void> } {
  let closed = false;
  const tick = async () => {
    if (closed) return;
    try {
      await rescueStaleDispatchingPublishOutbox();
      await dispatchPendingPublishOutbox();
    } catch (error) {
      console.error("[PublishOutbox] Dispatcher tick failed:", error);
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, PUBLISH_OUTBOX_INTERVAL_MS);
  void tick();

  return {
    async close() {
      closed = true;
      clearInterval(timer);
    },
  };
}

async function rescueStaleDispatchingPublishOutbox(): Promise<void> {
  const staleBefore = new Date(Date.now() - PUBLISH_OUTBOX_STALE_MS);
  await prisma.publishOutbox.updateMany({
    where: {
      status: "DISPATCHING",
      lockedAt: { lt: staleBefore },
    },
    data: {
      status: "PENDING",
      nextAttemptAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

function sanitizeOutboxError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}
