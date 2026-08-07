import { describe, expect, it, vi } from "vitest";

import { productSalesCacheKey, ShopifyProductSalesCache } from "./product-sales-cache";

const snapshot = {
  from: "2026-08-01",
  to: "2026-08-07",
  currencyCode: "USD",
  fetchedAt: "2026-08-07T00:00:00.000Z",
  rows: [{ productTitle: "Product", netItemsSold: 2, totalSales: "59.98" }],
  totals: { netItemsSold: 2, totalSales: "59.98" },
};

function makeRedis(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    eval: vi.fn().mockResolvedValue(1),
    disconnect: vi.fn(),
    ...overrides,
  };
}

describe("Shopify product sales cache", () => {
  it("uses the exact approved per-store cache key", () => {
    expect(
      productSalesCacheKey({
        tenantId: "tenant-1",
        storeId: "store-1",
        from: "2026-08-01",
        to: "2026-08-07",
      }),
    ).toBe("shopify-product-sales:v1:tenant-1:store-1:2026-08-01:2026-08-07");
  });

  it("returns a valid JSON cache hit without calling Shopify", async () => {
    const fetchSnapshot = vi.fn();
    const redis = makeRedis({ get: vi.fn().mockResolvedValue(JSON.stringify(snapshot)) });
    const cache = new ShopifyProductSalesCache({ redis });

    await expect(
      cache.load({
        tenantId: "tenant-1",
        storeId: "store-1",
        from: "2026-08-01",
        to: "2026-08-07",
        currencyCode: "USD",
        fetchSnapshot,
      }),
    ).resolves.toEqual({ status: "hit", snapshot });
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("loads a miss, caches it for ten minutes, and releases the fill lock", async () => {
    const redis = makeRedis();
    const cache = new ShopifyProductSalesCache({ redis });

    await expect(
      cache.load({
        tenantId: "tenant-1",
        storeId: "store-1",
        from: "2026-08-01",
        to: "2026-08-07",
        currencyCode: "USD",
        fetchSnapshot: async () => snapshot,
      }),
    ).resolves.toEqual({ status: "loaded", snapshot });

    const key = productSalesCacheKey({
      tenantId: "tenant-1",
      storeId: "store-1",
      from: "2026-08-01",
      to: "2026-08-07",
    });
    expect(redis.set).toHaveBeenCalledWith(`${key}:lock`, expect.any(String), "PX", 30_000, "NX");
    expect(redis.set).toHaveBeenCalledWith(key, JSON.stringify(snapshot), "EX", 600);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("GET", KEYS[1])'),
      1,
      `${key}:lock`,
      expect.any(String),
    );
  });

  it("returns loading when another request owns the fill lock", async () => {
    const redis = makeRedis({ set: vi.fn().mockResolvedValue(null) });
    const fetchSnapshot = vi.fn();
    const cache = new ShopifyProductSalesCache({ redis });

    await expect(
      cache.load({
        tenantId: "tenant-1",
        storeId: "store-1",
        from: "2026-08-01",
        to: "2026-08-07",
        fetchSnapshot,
      }),
    ).resolves.toEqual({ status: "loading" });
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("treats malformed cached JSON as a miss", async () => {
    const redis = makeRedis({ get: vi.fn().mockResolvedValue("not-json") });
    const cache = new ShopifyProductSalesCache({ redis });

    await expect(
      cache.load({
        tenantId: "tenant-1",
        storeId: "store-1",
        from: "2026-08-01",
        to: "2026-08-07",
        currencyCode: "USD",
        fetchSnapshot: async () => snapshot,
      }),
    ).resolves.toEqual({ status: "loaded", snapshot });
  });

  it("falls back to Shopify when Redis read or lock acquisition fails", async () => {
    const readFailure = makeRedis({ get: vi.fn().mockRejectedValue(new Error("redis down")) });
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot);
    await expect(
      new ShopifyProductSalesCache({ redis: readFailure }).load({
        tenantId: "tenant-1",
        storeId: "store-1",
        from: "2026-08-01",
        to: "2026-08-07",
        fetchSnapshot,
      }),
    ).resolves.toEqual({ status: "loaded", snapshot });

    const lockFailure = makeRedis({ set: vi.fn().mockRejectedValue(new Error("redis down")) });
    await expect(
      new ShopifyProductSalesCache({ redis: lockFailure }).load({
        tenantId: "tenant-1",
        storeId: "store-1",
        from: "2026-08-01",
        to: "2026-08-07",
        fetchSnapshot,
      }),
    ).resolves.toEqual({ status: "loaded", snapshot });
  });

  it("returns Shopify data when writing the cache fails and does not cache loader errors", async () => {
    const cacheWriteFailure = makeRedis({
      set: vi.fn().mockImplementation(async (...args: unknown[]) =>
        String(args[0]).endsWith(":lock") ? "OK" : Promise.reject(new Error("redis down")),
      ),
    });
    await expect(
      new ShopifyProductSalesCache({ redis: cacheWriteFailure }).load({
        tenantId: "tenant-1",
        storeId: "store-1",
        from: "2026-08-01",
        to: "2026-08-07",
        fetchSnapshot: async () => snapshot,
      }),
    ).resolves.toEqual({ status: "loaded", snapshot });

    const loaderFailure = makeRedis();
    await expect(
      new ShopifyProductSalesCache({ redis: loaderFailure }).load({
        tenantId: "tenant-1",
        storeId: "store-1",
        from: "2026-08-01",
        to: "2026-08-07",
        fetchSnapshot: async () => {
          throw new Error("Shopify unavailable");
        },
      }),
    ).rejects.toThrow("Shopify unavailable");
    expect(loaderFailure.set).toHaveBeenCalledTimes(1);
  });
});
