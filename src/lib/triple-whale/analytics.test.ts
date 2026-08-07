import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

import {
  getTripleWhaleAnalytics,
  prismaTripleWhaleAnalyticsRepository,
  type TripleWhaleAnalyticsRepository,
} from "./analytics";

const shops = [
  { id: "shop-a", customName: "A", shopDomain: "a.myshopify.com" },
  { id: "shop-b", customName: "B", shopDomain: "b.myshopify.com" },
];

function row(shopId: string, date: string, orderRevenue: number, orders = 1) {
  return {
    shopId,
    date,
    orderRevenue,
    netProfit: orderRevenue / 2,
    orders,
    blendedAdSpend: orderRevenue / 10,
    totalCost: orderRevenue / 2,
  };
}

function repository(
  rows: ReturnType<typeof row>[],
  workspace = { designs: 125, activeListings: 3, storeLinked: true },
) {
  const workspaceInputs: Array<{ tenantId: string; shopDomains: string[] | null }> = [];
  return {
    workspaceInputs,
    repository: {
      async getWorkspaceMetrics(input: { tenantId: string; shopDomains: string[] | null }) {
        workspaceInputs.push(input);
        return workspace;
      },
      async listTenantShops() {
        return shops;
      },
      async listDailyStats() {
        return rows;
      },
    } satisfies TripleWhaleAnalyticsRepository,
  };
}

describe("Triple Whale analytics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed when a selected workspace domain does not resolve to a tenant store", async () => {
    const findStores = vi.spyOn(prisma.store, "findMany").mockResolvedValue([]);
    const designCount = vi.spyOn(prisma.design, "count");
    const listingCount = vi.spyOn(prisma.listing, "count");

    const result = await prismaTripleWhaleAnalyticsRepository.getWorkspaceMetrics({
      tenantId: "tenant",
      shopDomains: ["missing.myshopify.com"],
    });

    expect(result).toEqual({ designs: null, activeListings: null, storeLinked: false });
    expect(findStores).toHaveBeenCalledWith({
      where: { tenantId: "tenant", shopifyDomain: { in: ["missing.myshopify.com"] } },
      select: { id: true },
    });
    expect(designCount).not.toHaveBeenCalled();
    expect(listingCount).not.toHaveBeenCalled();
  });

  it("counts matched workspace records using resolved store IDs", async () => {
    vi.spyOn(prisma.store, "findMany").mockResolvedValue([{ id: "store-a" }]);
    const designCount = vi.spyOn(prisma.design, "count").mockResolvedValue(20);
    const listingCount = vi.spyOn(prisma.listing, "count").mockResolvedValue(2);

    const result = await prismaTripleWhaleAnalyticsRepository.getWorkspaceMetrics({
      tenantId: "tenant",
      shopDomains: ["a.myshopify.com"],
    });

    expect(result).toEqual({ designs: 20, activeListings: 2, storeLinked: true });
    expect(designCount).toHaveBeenCalledWith({
      where: { tenantId: "tenant", storeId: { in: ["store-a"] }, deletedAt: null },
    });
    expect(listingCount).toHaveBeenCalledWith({
      where: { tenantId: "tenant", storeId: { in: ["store-a"] }, status: "ACTIVE" },
    });
  });

  it("counts every non-deleted tenant design for all shops", async () => {
    const designCount = vi.spyOn(prisma.design, "count").mockResolvedValue(125);
    vi.spyOn(prisma.listing, "count").mockResolvedValue(3);

    const result = await prismaTripleWhaleAnalyticsRepository.getWorkspaceMetrics({
      tenantId: "tenant",
      shopDomains: null,
    });

    expect(result).toEqual({ designs: 125, activeListings: 3, storeLinked: true });
    expect(designCount).toHaveBeenCalledWith({
      where: { tenantId: "tenant", deletedAt: null },
    });
  });

  it("queries and returns daily DATE values without applying a timezone shift", async () => {
    const date = new Date("2026-08-06T00:00:00.000Z");
    const findDailyStats = vi.spyOn(prisma.tripleWhaleDailyStat, "findMany").mockResolvedValue([
      {
        credentialId: "shop-a",
        date,
        orderRevenue: 10,
        netProfit: 5,
        netMargin: 0.5,
        orders: 1,
        paymentGateways: 1,
        shipping: 1,
        blendedAdSpend: 2,
        cogs: 1,
        totalCost: 5,
        id: "stat-a",
        syncedAt: date,
      } as never,
    ]);

    const rows = await prismaTripleWhaleAnalyticsRepository.listDailyStats({
      tenantId: "tenant",
      shopIds: ["shop-a"],
      from: "2026-08-06",
      to: "2026-08-06",
      timezone: "America/New_York",
    });

    expect(findDailyStats).toHaveBeenCalledWith({
      where: {
        credentialId: { in: ["shop-a"] },
        credential: { tenantId: "tenant" },
        date: {
          gte: new Date("2026-08-06T00:00:00.000Z"),
          lte: new Date("2026-08-06T00:00:00.000Z"),
        },
      },
      orderBy: [{ date: "asc" }, { credentialId: "asc" }],
    });
    expect(rows[0]).toMatchObject({ shopId: "shop-a", date: "2026-08-06" });
  });

  it("returns tenant-wide workspace metrics for all shops", async () => {
    const fake = repository([]);

    const result = await getTripleWhaleAnalytics(
      {
        tenantId: "tenant",
        timezone: "UTC",
        range: { from: "2026-08-02", to: "2026-08-02" },
        comparison: "none",
        shopIds: [],
      },
      fake.repository,
    );

    expect(fake.workspaceInputs).toEqual([{ tenantId: "tenant", shopDomains: null }]);
    expect(result.workspace).toEqual({ designs: 125, activeListings: 3, storeLinked: true });
  });

  it("returns selected-shop workspace metrics", async () => {
    const fake = repository([], { designs: 20, activeListings: 2, storeLinked: true });

    const result = await getTripleWhaleAnalytics(
      {
        tenantId: "tenant",
        timezone: "UTC",
        range: { from: "2026-08-02", to: "2026-08-02" },
        comparison: "none",
        shopIds: ["shop-a"],
      },
      fake.repository,
    );

    expect(fake.workspaceInputs).toEqual([
      { tenantId: "tenant", shopDomains: ["a.myshopify.com"] },
    ]);
    expect(result.workspace).toEqual({ designs: 20, activeListings: 2, storeLinked: true });
  });

  it("exposes unlinked workspace metrics for an unmatched selected domain", async () => {
    const fake = repository([], { designs: null, activeListings: null, storeLinked: false });

    const result = await getTripleWhaleAnalytics(
      {
        tenantId: "tenant",
        timezone: "UTC",
        range: { from: "2026-08-02", to: "2026-08-02" },
        comparison: "none",
        shopIds: ["shop-a"],
      },
      fake.repository,
    );

    expect(result.workspace).toEqual({ designs: null, activeListings: null, storeLinked: false });
  });

  it("aggregates current, comparison, distribution, and daily series", async () => {
    const result = await getTripleWhaleAnalytics(
      {
        tenantId: "tenant",
        timezone: "UTC",
        range: { from: "2026-08-02", to: "2026-08-02" },
        comparison: "previous_period",
        shopIds: [],
      },
      repository([
        row("shop-a", "2026-08-01", 80),
        row("shop-b", "2026-08-01", 120),
        row("shop-a", "2026-08-02", 120),
        row("shop-b", "2026-08-02", 180),
      ]).repository,
    );

    expect(result.analytics.metrics.orderRevenue).toEqual({
      current: 300,
      previous: 200,
      absoluteChange: 100,
      percentChange: 50,
      direction: "up",
      complete: true,
    });
    expect(result.analytics.distribution.orderRevenue).toEqual([
      { shopId: "shop-a", label: "A", value: 120 },
      { shopId: "shop-b", label: "B", value: 180 },
    ]);
    expect(result.analytics.daily.orderRevenue).toEqual([
      { date: "2026-08-02", current: 300, previous: 200 },
    ]);
    expect(result.dataStatus).toBe("complete");
  });

  it("does not turn missing comparison rows into zero", async () => {
    const result = await getTripleWhaleAnalytics(
      {
        tenantId: "tenant",
        timezone: "UTC",
        range: { from: "2026-08-02", to: "2026-08-02" },
        comparison: "previous_period",
        shopIds: ["shop-a"],
      },
      repository([row("shop-a", "2026-08-02", 120)]).repository,
    );

    expect(result.dataStatus).toBe("partial");
    expect(result.analytics.metrics.orderRevenue).toMatchObject({
      current: 120,
      previous: null,
      percentChange: null,
      complete: false,
    });
    expect(result.missingRanges).toEqual([
      { shopId: "shop-a", from: "2026-08-01", to: "2026-08-01", scope: "comparison" },
    ]);
  });

  it("returns a null percentage instead of infinity when previous is zero", async () => {
    const result = await getTripleWhaleAnalytics(
      {
        tenantId: "tenant",
        timezone: "UTC",
        range: { from: "2026-08-02", to: "2026-08-02" },
        comparison: "previous_period",
        shopIds: ["shop-a"],
      },
      repository([row("shop-a", "2026-08-01", 0, 0), row("shop-a", "2026-08-02", 50)]).repository,
    );

    expect(result.analytics.metrics.orderRevenue).toMatchObject({
      absoluteChange: 50,
      percentChange: null,
      direction: "up",
      complete: true,
    });
  });

  it("supports no comparison period", async () => {
    const result = await getTripleWhaleAnalytics(
      {
        tenantId: "tenant",
        timezone: "UTC",
        range: { from: "2026-08-02", to: "2026-08-02" },
        comparison: "none",
        shopIds: ["shop-a"],
      },
      repository([row("shop-a", "2026-08-02", 50)]).repository,
    );

    expect(result.comparisonRange).toBeNull();
    expect(result.analytics.metrics.orderRevenue).toMatchObject({
      current: 50,
      previous: null,
      absoluteChange: null,
      percentChange: null,
      direction: "none",
      complete: true,
    });
  });

  it("rejects shops outside the authenticated tenant", async () => {
    await expect(
      getTripleWhaleAnalytics(
        {
          tenantId: "tenant",
          timezone: "UTC",
          range: { from: "2026-08-02", to: "2026-08-02" },
          comparison: "none",
          shopIds: ["other-tenant-shop"],
        },
        repository([]).repository,
      ),
    ).rejects.toThrow("Unknown Triple Whale shop");
  });
});
