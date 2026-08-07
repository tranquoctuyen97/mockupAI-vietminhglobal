import { Prisma } from "@prisma/client";

import { decrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";
import {
  ShopifyAuthError,
  ShopifyClient,
} from "@/lib/shopify/client";
import {
  fetchShopifyProductSales,
  SHOPIFY_REPORTS_API_VERSION,
  ShopifyProductSalesResponseError,
  type ShopifyProductSalesSnapshot,
} from "@/lib/shopify/product-sales";
import {
  ShopifyProductSalesCache,
  type ShopifyProductSalesCacheResult,
} from "@/lib/shopify/product-sales-cache";

const STORE_LOAD_CONCURRENCY = 3;

export type DashboardShopCandidate = {
  shopId: string;
  shopDomain: string;
  store: {
    id: string;
    name: string;
    status: string;
    currencyCode: string | null;
    tokenEncrypted: Uint8Array | null;
    grantedScopes: string[];
  } | null;
};

export type ShopifyProductSalesRow = {
  storeId: string;
  storeName: string;
  productTitle: string | null;
  netItemsSold: number;
  totalSales: string;
  currencyCode: string;
};

export type ShopifyProductSalesStoreStatus = {
  storeId: string | null;
  storeName: string;
  shopId: string;
  status:
    | "ok"
    | "loading"
    | "store_unmapped"
    | "not_connected"
    | "missing_scope"
    | "token_expired"
    | "failed";
  message?: string;
};

export type ShopifyProductSalesResponse = {
  from: string;
  to: string;
  selectedShopId: string | null;
  rows: ShopifyProductSalesRow[];
  summary: {
    netItemsSold: number;
    totalSalesByCurrency: Record<string, string>;
  };
  stores: ShopifyProductSalesStoreStatus[];
  partial: boolean;
};

export type ShopifyProductSalesDependencies = {
  listDashboardShops(input: {
    tenantId: string;
    shopId: string | null;
  }): Promise<DashboardShopCandidate[]>;
  loadReadyStore(input: {
    tenantId: string;
    from: string;
    to: string;
    candidate: DashboardShopCandidate;
  }): Promise<ShopifyProductSalesCacheResult>;
};

export async function getDashboardShopifyProductSales(
  input: {
    tenantId: string;
    from: string;
    to: string;
    shopId: string | null;
  },
  dependencies?: Partial<ShopifyProductSalesDependencies>,
): Promise<ShopifyProductSalesResponse> {
  let ownedCache: ShopifyProductSalesCache | null = null;
  const listDashboardShops =
    dependencies?.listDashboardShops ?? prismaShopifyProductSalesRepository.listDashboardShops;
  const loadReadyStore =
    dependencies?.loadReadyStore ??
    (async (loadInput: {
      tenantId: string;
      from: string;
      to: string;
      candidate: DashboardShopCandidate;
    }) => {
      ownedCache ??= new ShopifyProductSalesCache();
      return loadReadyStoreFromShopify(ownedCache, loadInput);
    });

  try {
    const candidates = await listDashboardShops({
      tenantId: input.tenantId,
      shopId: input.shopId,
    });
    if (input.shopId && !candidates.some((candidate) => candidate.shopId === input.shopId)) {
      throw new Error("Unknown Triple Whale shop");
    }

    const selectedCandidates = input.shopId
      ? candidates.filter((candidate) => candidate.shopId === input.shopId)
      : candidates;
    const results = await mapWithConcurrency(selectedCandidates, STORE_LOAD_CONCURRENCY, async (candidate) =>
      loadCandidate({
        input,
        candidate,
        loadReadyStore,
      }),
    );

    const rows = results.flatMap((result) => result.rows);
    rows.sort(compareRows);

    const totalSalesByCurrency = new Map<string, Prisma.Decimal>();
    let netItemsSold = 0;
    for (const result of results) {
      if (!result.snapshot) continue;
      netItemsSold += result.snapshot.totals.netItemsSold;
      const current = totalSalesByCurrency.get(result.snapshot.currencyCode) ?? new Prisma.Decimal(0);
      totalSalesByCurrency.set(
        result.snapshot.currencyCode,
        current.add(new Prisma.Decimal(result.snapshot.totals.totalSales)),
      );
    }

    return {
      from: input.from,
      to: input.to,
      selectedShopId: input.shopId,
      rows,
      summary: {
        netItemsSold,
        totalSalesByCurrency: Object.fromEntries(
          [...totalSalesByCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => [
            currency,
            total.toString(),
          ]),
        ),
      },
      stores: results.map((result) => result.status),
      partial: results.some((result) => result.status.status !== "ok"),
    };
  } finally {
    const cacheToClose = ownedCache as ShopifyProductSalesCache | null;
    cacheToClose?.close();
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => runWorker()),
  );
  return results;
}

export const prismaShopifyProductSalesRepository: Pick<
  ShopifyProductSalesDependencies,
  "listDashboardShops"
> = {
  async listDashboardShops({ tenantId, shopId }) {
    const credentials = await prisma.tripleWhaleCredential.findMany({
      where: { tenantId, ...(shopId ? { id: shopId } : {}) },
      select: { id: true, shopDomain: true },
      orderBy: { shopDomain: "asc" },
    });
    const domains = credentials.map((credential) => credential.shopDomain);
    const stores = domains.length
      ? await prisma.store.findMany({
          where: { tenantId, shopifyDomain: { in: domains }, deletedAt: null },
          select: {
            id: true,
            name: true,
            shopifyDomain: true,
            shopifyCurrencyCode: true,
            status: true,
            credentials: {
              select: {
                shopifyTokenEncrypted: true,
                shopifyGrantedScopes: true,
              },
            },
          },
        })
      : [];
    const storesByDomain = new Map(stores.map((store) => [store.shopifyDomain, store]));

    return credentials.map((credential) => {
      const store = storesByDomain.get(credential.shopDomain);
      return {
        shopId: credential.id,
        shopDomain: credential.shopDomain,
        store: store
          ? {
              id: store.id,
              name: store.name,
              status: store.status,
              currencyCode: store.shopifyCurrencyCode,
              tokenEncrypted: store.credentials?.shopifyTokenEncrypted ?? null,
              grantedScopes: store.credentials?.shopifyGrantedScopes ?? [],
            }
          : null,
      };
    });
  },
};

async function loadReadyStoreFromShopify(
  cache: ShopifyProductSalesCache,
  input: {
    tenantId: string;
    from: string;
    to: string;
    candidate: DashboardShopCandidate;
  },
): Promise<ShopifyProductSalesCacheResult> {
  const store = input.candidate.store;
  if (!store?.currencyCode || !store.tokenEncrypted) {
    throw new Error("Shopify store is not ready for product sales");
  }

  const token = decrypt(store.tokenEncrypted);
  const client = new ShopifyClient(
    input.candidate.shopDomain,
    token,
    SHOPIFY_REPORTS_API_VERSION,
  );
  return cache.load({
    tenantId: input.tenantId,
    storeId: store.id,
    from: input.from,
    to: input.to,
    currencyCode: store.currencyCode,
    fetchSnapshot: () =>
      fetchShopifyProductSales(client, {
        from: input.from,
        to: input.to,
        currencyCode: store.currencyCode!,
      }),
  });
}

type CandidateResult = {
  status: ShopifyProductSalesStoreStatus;
  rows: ShopifyProductSalesRow[];
  snapshot: ShopifyProductSalesSnapshot | null;
};

async function loadCandidate(input: {
  input: {
    tenantId: string;
    from: string;
    to: string;
    shopId: string | null;
  };
  candidate: DashboardShopCandidate;
  loadReadyStore: ShopifyProductSalesDependencies["loadReadyStore"];
}): Promise<CandidateResult> {
  const store = input.candidate.store;
  if (!store) {
    return {
      status: {
        storeId: null,
        storeName: input.candidate.shopDomain,
        shopId: input.candidate.shopId,
        status: "store_unmapped",
        message: "No Shopify Store is mapped to this shop",
      },
      rows: [],
      snapshot: null,
    };
  }
  if (!store.tokenEncrypted) {
    return {
      status: {
        storeId: store.id,
        storeName: store.name,
        shopId: input.candidate.shopId,
        status: "not_connected",
        message: "Shopify is not connected",
      },
      rows: [],
      snapshot: null,
    };
  }
  if (!store.grantedScopes.includes("read_reports")) {
    return {
      status: {
        storeId: store.id,
        storeName: store.name,
        shopId: input.candidate.shopId,
        status: "missing_scope",
        message: "Shopify read_reports scope is required",
      },
      rows: [],
      snapshot: null,
    };
  }

  try {
    const result = await input.loadReadyStore({
      tenantId: input.input.tenantId,
      from: input.input.from,
      to: input.input.to,
      candidate: input.candidate,
    });
    if (result.status === "loading") {
      return {
        status: {
          storeId: store.id,
          storeName: store.name,
          shopId: input.candidate.shopId,
          status: "loading",
          message: "Another request is loading this Shopify report",
        },
        rows: [],
        snapshot: null,
      };
    }

    const rows = result.snapshot.rows.map((row) => ({
      storeId: store.id,
      storeName: store.name,
      productTitle: row.productTitle,
      netItemsSold: row.netItemsSold,
      totalSales: row.totalSales,
      currencyCode: result.snapshot.currencyCode,
    }));
    return {
      status: {
        storeId: store.id,
        storeName: store.name,
        shopId: input.candidate.shopId,
        status: "ok",
      },
      rows,
      snapshot: result.snapshot,
    };
  } catch (error) {
    const authStatus = error instanceof ShopifyAuthError ? error.status : null;
    return {
      status: {
        storeId: store.id,
        storeName: store.name,
        shopId: input.candidate.shopId,
        status: authStatus === 401 ? "token_expired" : "failed",
        message:
          authStatus === 401
            ? "Shopify access token expired"
            : authStatus === 403
              ? "Shopify denied reports access"
              : error instanceof ShopifyProductSalesResponseError
                ? "Shopify returned invalid product sales data"
                : "Unable to load Shopify product sales",
      },
      rows: [],
      snapshot: null,
    };
  }
}

function compareRows(left: ShopifyProductSalesRow, right: ShopifyProductSalesRow): number {
  const salesOrder = new Prisma.Decimal(right.totalSales).comparedTo(new Prisma.Decimal(left.totalSales));
  if (salesOrder !== 0) return salesOrder;
  const storeOrder = left.storeName.localeCompare(right.storeName);
  if (storeOrder !== 0) return storeOrder;
  const titleOrder = (left.productTitle ?? "").localeCompare(right.productTitle ?? "");
  if (titleOrder !== 0) return titleOrder;
  return left.storeId.localeCompare(right.storeId);
}
