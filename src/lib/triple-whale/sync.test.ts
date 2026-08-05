import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchSummaryData, findUnique, update, upsert } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  fetchSummaryData: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    tripleWhaleCredential: { findUnique, update },
    tripleWhaleDailyStat: { upsert },
  },
}));
vi.mock("@/lib/crypto/envelope", () => ({ decrypt: () => "api-key" }));
vi.mock("./client", () => ({ fetchSummaryData }));

import { syncStoreRange } from "./sync";

describe("Triple Whale explicit range sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({
      id: "shop",
      apiKeyEncrypted: Buffer.from("encrypted"),
      shopDomain: "a.myshopify.com",
      tenant: { twTimezone: "UTC" },
    });
    fetchSummaryData.mockResolvedValue([
      {
        date: "2026-01-01",
        orderRevenue: 10,
        netProfit: 5,
        netMargin: 0.5,
        orders: 1,
        paymentGateways: 1,
        shipping: 1,
        blendedAdSpend: 2,
        cogs: 1,
        totalCost: 5,
      },
    ]);
  });

  it("syncs exactly the requested historical range without advancing the scheduled cursor", async () => {
    await syncStoreRange({ credentialId: "shop", from: "2026-01-01", to: "2026-01-31" });

    expect(fetchSummaryData).toHaveBeenCalledWith(
      expect.objectContaining({
        shopDomain: "a.myshopify.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      }),
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});
