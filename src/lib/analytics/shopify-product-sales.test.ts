import { describe, expect, it } from "vitest";

import { ShopifyAuthError } from "@/lib/shopify/client";

import {
  getDashboardShopifyProductSales,
  type DashboardShopCandidate,
} from "./shopify-product-sales";

function snapshot(input: {
  currencyCode: string;
  title: string;
  netItemsSold: number;
  totalSales: string;
}) {
  return {
    from: "2026-08-01",
    to: "2026-08-01",
    currencyCode: input.currencyCode,
    fetchedAt: "2026-08-07T00:00:00.000Z",
    rows: [
      {
        productTitle: input.title,
        netItemsSold: input.netItemsSold,
        totalSales: input.totalSales,
      },
    ],
    totals: { netItemsSold: input.netItemsSold, totalSales: input.totalSales },
  };
}

function candidate(input: {
  shopId: string;
  domain: string;
  storeId: string;
  name: string;
  currencyCode?: string | null;
  tokenEncrypted?: Uint8Array | null;
  grantedScopes?: string[];
}): DashboardShopCandidate {
  return {
    shopId: input.shopId,
    shopDomain: input.domain,
    store: {
      id: input.storeId,
      name: input.name,
      status: "ACTIVE",
      currencyCode: input.currencyCode ?? "USD",
      tokenEncrypted: input.tokenEncrypted === undefined ? new Uint8Array([1]) : input.tokenEncrypted,
      grantedScopes: input.grantedScopes ?? ["read_reports"],
    },
  };
}

describe("dashboard Shopify product sales orchestration", () => {
  it("keeps equal product titles separate by store in All shops", async () => {
    const shops = [
      candidate({ shopId: "credential-a", domain: "a.myshopify.com", storeId: "store-a", name: "ThreadsMuse" }),
      candidate({ shopId: "credential-b", domain: "b.myshopify.com", storeId: "store-b", name: "Store B" }),
    ];
    const snapshots = {
      "store-a": snapshot({ currencyCode: "USD", title: "Good Day T-shirt", netItemsSold: 6, totalSales: "190.04" }),
      "store-b": snapshot({ currencyCode: "USD", title: "Good Day T-shirt", netItemsSold: 4, totalSales: "132.50" }),
    };

    const result = await getDashboardShopifyProductSales(
      { tenantId: "tenant", from: "2026-08-01", to: "2026-08-01", shopId: null },
      {
        listDashboardShops: async () => shops,
        loadReadyStore: async ({ candidate: shop }) => ({
          status: "loaded",
          snapshot: snapshots[shop.store!.id as keyof typeof snapshots],
        }),
      },
    );

    expect(result.rows).toEqual([
      expect.objectContaining({ storeId: "store-a", storeName: "ThreadsMuse", productTitle: "Good Day T-shirt" }),
      expect.objectContaining({ storeId: "store-b", storeName: "Store B", productTitle: "Good Day T-shirt" }),
    ]);
    expect(result.summary).toEqual({ netItemsSold: 10, totalSalesByCurrency: { USD: "322.54" } });
  });

  it("validates the selected tenant shop before loading one store", async () => {
    const shops = [candidate({ shopId: "credential-a", domain: "a.myshopify.com", storeId: "store-a", name: "Store A" })];
    let receivedShopId: string | null | undefined;
    let loads = 0;

    const result = await getDashboardShopifyProductSales(
      { tenantId: "tenant", from: "2026-08-01", to: "2026-08-01", shopId: "credential-a" },
      {
        listDashboardShops: async (input) => {
          receivedShopId = input.shopId;
          return shops;
        },
        loadReadyStore: async () => {
          loads += 1;
          return { status: "loaded", snapshot: snapshot({ currencyCode: "USD", title: "Product", netItemsSold: 1, totalSales: "9.00" }) };
        },
      },
    );

    expect(receivedShopId).toBe("credential-a");
    expect(loads).toBe(1);
    expect(result.selectedShopId).toBe("credential-a");
    expect(result.rows[0]).not.toHaveProperty("storeName", "Other Store");
  });

  it("rejects an unknown Triple Whale shop", async () => {
    await expect(
      getDashboardShopifyProductSales(
        { tenantId: "tenant", from: "2026-08-01", to: "2026-08-01", shopId: "unknown" },
        { listDashboardShops: async () => [], loadReadyStore: async () => ({ status: "loading" }) },
      ),
    ).rejects.toThrow("Unknown Triple Whale shop");
  });

  it("reports unmapped, disconnected, missing-scope, loading, and auth failures without fake zero rows", async () => {
    const shops: DashboardShopCandidate[] = [
      { shopId: "unmapped", shopDomain: "unmapped.myshopify.com", store: null },
      candidate({ shopId: "disconnected", domain: "disconnected.myshopify.com", storeId: "store-disconnected", name: "Disconnected", tokenEncrypted: null }),
      candidate({ shopId: "missing-scope", domain: "missing.myshopify.com", storeId: "store-missing", name: "Missing Scope", grantedScopes: [] }),
      candidate({ shopId: "loading", domain: "loading.myshopify.com", storeId: "store-loading", name: "Loading" }),
      candidate({ shopId: "expired", domain: "expired.myshopify.com", storeId: "store-expired", name: "Expired" }),
    ];

    const result = await getDashboardShopifyProductSales(
      { tenantId: "tenant", from: "2026-08-01", to: "2026-08-01", shopId: null },
      {
        listDashboardShops: async () => shops,
        loadReadyStore: async ({ candidate: shop }) => {
          if (shop.shopId === "loading") return { status: "loading" };
          throw new ShopifyAuthError("denied", 401);
        },
      },
    );

    expect(result.rows).toEqual([]);
    expect(result.partial).toBe(true);
    expect(result.stores.map((store) => store.status)).toEqual([
      "store_unmapped",
      "not_connected",
      "missing_scope",
      "loading",
      "token_expired",
    ]);
  });

  it("keeps mixed-currency totals separate and sorts sales numerically", async () => {
    const shops = [
      candidate({ shopId: "usd", domain: "usd.myshopify.com", storeId: "store-usd", name: "A Store" }),
      candidate({ shopId: "cad", domain: "cad.myshopify.com", storeId: "store-cad", name: "B Store", currencyCode: "CAD" }),
    ];
    const result = await getDashboardShopifyProductSales(
      { tenantId: "tenant", from: "2026-08-01", to: "2026-08-01", shopId: null },
      {
        listDashboardShops: async () => shops,
        loadReadyStore: async ({ candidate: shop }) => ({
          status: "loaded",
          snapshot: shop.shopId === "usd"
            ? snapshot({ currencyCode: "USD", title: "Nine", netItemsSold: 1, totalSales: "9.00" })
            : snapshot({ currencyCode: "CAD", title: "One hundred", netItemsSold: 2, totalSales: "100.00" }),
        }),
      },
    );

    expect(result.rows.map((row) => row.totalSales)).toEqual(["100.00", "9.00"]);
    expect(result.summary.totalSalesByCurrency).toEqual({ CAD: "100", USD: "9" });
  });

  it("limits ready store loading to three concurrent workers", async () => {
    const shops = Array.from({ length: 8 }, (_, index) =>
      candidate({
        shopId: `shop-${index}`,
        domain: `${index}.myshopify.com`,
        storeId: `store-${index}`,
        name: `Store ${index}`,
      }),
    );
    let active = 0;
    let maxActive = 0;

    const resultPromise = getDashboardShopifyProductSales(
      { tenantId: "tenant", from: "2026-08-01", to: "2026-08-01", shopId: null },
      {
        listDashboardShops: async () => shops,
        loadReadyStore: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { status: "loaded", snapshot: snapshot({ currencyCode: "USD", title: "Product", netItemsSold: 1, totalSales: "1.00" }) };
        },
      },
    );

    await resultPromise;
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
