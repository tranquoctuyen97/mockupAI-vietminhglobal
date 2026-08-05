import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/queue", () => ({
  getInkhubOrderSyncQueue: vi.fn(),
}));

import { enqueueInkhubBackfillSync, enqueueInkhubInitialSync } from "./queue";

describe("Inkhub order sync queue payloads", () => {
  it("keeps an explicit range on backfill jobs", async () => {
    const add = vi.fn().mockResolvedValue({ id: "job" });
    await enqueueInkhubBackfillSync(
      {
        tenantId: "tenant",
        storeId: "store",
        shopIds: [3],
        fromDate: "2026-07-31T17:00:00.000Z",
        toDate: "2026-08-02T16:59:59.999Z",
      },
      { add } as never,
    );

    expect(add).toHaveBeenCalledWith(
      "backfill-inkhub-orders",
      {
        tenantId: "tenant",
        storeId: "store",
        shopIds: [3],
        fromDate: "2026-07-31T17:00:00.000Z",
        toDate: "2026-08-02T16:59:59.999Z",
        kind: "backfill",
      },
      {
        jobId: "inkhub-backfill-store-3-2026-07-31T17:00:00.000Z-2026-08-02T16:59:59.999Z",
      },
    );
  });

  it("keeps initial sync backward compatible when no range is supplied", async () => {
    const add = vi.fn().mockResolvedValue({ id: "job" });
    await enqueueInkhubInitialSync({ tenantId: "tenant", storeId: "store", shopIds: [3] }, {
      add,
    } as never);

    expect(add).toHaveBeenCalledWith(
      "sync-inkhub-orders",
      { tenantId: "tenant", storeId: "store", shopIds: [3], kind: "initial" },
      { jobId: expect.stringMatching(/^inkhub-initial-store-3-\d+$/) },
    );
  });
});
