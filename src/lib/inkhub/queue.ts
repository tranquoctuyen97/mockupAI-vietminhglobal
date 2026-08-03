import type { Queue } from "bullmq";

import { prisma } from "@/lib/db";
import { getInkhubOrderSyncQueue } from "@/lib/queue/queue";

export const INKHUB_ORDER_SYNC_DISPATCHER_JOB_ID = "inkhub-order-sync-dispatcher";
export const INKHUB_ORDER_SYNC_DISPATCHER_INTERVAL_MS = 30 * 60 * 1000;

export type InkhubOrderSyncJob = {
  tenantId: string;
  storeId: string;
  shopIds: number[];
  kind: "initial" | "recent";
};

export async function enqueueInkhubInitialSync(
  payload: Omit<InkhubOrderSyncJob, "kind">,
  queue: Queue = getInkhubOrderSyncQueue(),
) {
  return queue.add(
    "sync-inkhub-orders",
    { ...payload, kind: "initial" } satisfies InkhubOrderSyncJob,
    {
      jobId: `inkhub-initial-${payload.storeId}-${payload.shopIds.join("-")}-${Date.now()}`,
    },
  );
}

export async function enqueueInkhubRecentSync(
  payload: Omit<InkhubOrderSyncJob, "kind">,
  queue: Queue = getInkhubOrderSyncQueue(),
) {
  const bucket = Math.floor(Date.now() / INKHUB_ORDER_SYNC_DISPATCHER_INTERVAL_MS);
  return queue.add(
    "sync-inkhub-orders",
    { ...payload, kind: "recent" } satisfies InkhubOrderSyncJob,
    {
      jobId: `inkhub-recent-${payload.storeId}-${bucket}`,
    },
  );
}

export async function scheduleInkhubOrderSyncDispatcher(queue: Queue = getInkhubOrderSyncQueue()) {
  return queue.add(
    "dispatch-inkhub-order-syncs",
    {},
    {
      jobId: INKHUB_ORDER_SYNC_DISPATCHER_JOB_ID,
      repeat: { every: INKHUB_ORDER_SYNC_DISPATCHER_INTERVAL_MS },
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );
}

export async function dispatchRecentInkhubOrderSyncs() {
  const stores = await prisma.store.findMany({
    where: {
      deletedAt: null,
      inkhubShopId: { not: null },
    },
    select: { id: true, tenantId: true, inkhubShopId: true },
  });

  const queue = getInkhubOrderSyncQueue();
  const jobs = stores.flatMap((store) => {
    const shopId = store.inkhubShopId;
    if (shopId === null) return [];
    return [
      enqueueInkhubRecentSync(
        {
          tenantId: store.tenantId,
          storeId: store.id,
          shopIds: [shopId],
        },
        queue,
      ),
    ];
  });
  await Promise.all(jobs);
  return { enqueued: stores.length };
}
