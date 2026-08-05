import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findStore, fetchPage } = vi.hoisted(() => ({
  findStore: vi.fn(),
  fetchPage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    store: { findFirst: findStore },
  },
}));
vi.mock("@/lib/inkhub/orders-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inkhub/orders-client")>(
    "@/lib/inkhub/orders-client",
  );
  return { ...actual, fetchInkhubOrdersPage: fetchPage };
});

import { syncInkhubStore } from "./sync";

describe("Inkhub order sync date ranges", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T00:00:00.000Z"));
    vi.clearAllMocks();
    findStore.mockResolvedValue({ id: "store", inkhubShopId: 3 });
    fetchPage.mockResolvedValue({ items: [], total: 0, totalPages: 1, page: 1, pageSize: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes an explicit date range for an initial backfill job", async () => {
    await syncInkhubStore({
      tenantId: "tenant",
      storeId: "store",
      shopId: 3,
      mode: "initial",
      fromDate: "2026-07-31T17:00:00.000Z",
      toDate: "2026-08-02T16:59:59.999Z",
    });

    expect(fetchPage).toHaveBeenCalledWith("tenant", 3, 1, 100, {
      fromDate: "2026-07-31T17:00:00.000Z",
      toDate: "2026-08-02T16:59:59.999Z",
    });
  });

  it("bounds recent syncs to the rolling 31-day window at the API", async () => {
    await syncInkhubStore({ tenantId: "tenant", storeId: "store", shopId: 3, mode: "recent" });

    expect(fetchPage).toHaveBeenCalledWith("tenant", 3, 1, 100, {
      fromDate: "2026-07-03T00:00:00.000Z",
      toDate: "2026-08-03T00:00:00.000Z",
    });
  });

  it("rejects an inverted explicit range before calling Inkhub", async () => {
    await expect(
      syncInkhubStore({
        tenantId: "tenant",
        storeId: "store",
        shopId: 3,
        mode: "backfill",
        fromDate: "2026-08-02T00:00:00.000Z",
        toDate: "2026-08-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("fromDate must be before or equal to toDate");
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
