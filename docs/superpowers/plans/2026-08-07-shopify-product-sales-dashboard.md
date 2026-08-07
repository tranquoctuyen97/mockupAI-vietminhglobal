# Shopify Product Sales Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Shopify-native `Total sales by product` dashboard table that follows the existing date/shop filters, preserves per-store rows in All shops, and caches each store/date report in Redis for 10 minutes.

**Architecture:** Persist the granted `read_reports` scope and shop currency during OAuth, query ShopifyQL independently for each selected store, and cache each complete per-store snapshot with `SET ... EX 600`. A tenant-scoped analytics service maps the existing Triple Whale selector to internal Stores, loads at most three stores concurrently, preserves rows by `storeId + productTitle`, and returns typed partial/loading states to a focused dashboard client component.

**Tech Stack:** Next.js 16.2.4 App Router, React 19.2.4, TypeScript, Shopify Admin GraphQL API 2026-01, ShopifyQL, Prisma 7.7, PostgreSQL, ioredis 5.10, Vitest 4.1, Biome.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-07-shopify-product-sales-dashboard-design.md` exactly.
- Do not merge equal product titles across stores. All shops must show a Store column.
- Do not recalculate `net_items_sold` or `total_sales` from local orders, Inkhub, or Triple Whale.
- Use the existing dashboard `from`, `to`, and optional Triple Whale credential `shopId` without adding timezone to the Shopify cache key.
- The cache key is exactly `shopify-product-sales:v1:{tenantId}:{storeId}:{from}:{to}`.
- Store the complete JSON snapshot with Redis `SET ... EX 600`.
- Acquire fill locks with a unique token and `SET ... NX PX 30000`; release only when the token still matches.
- Redis is an optimization. Redis failure falls back to a direct Shopify read.
- Use Shopify Admin GraphQL API `2026-01` for product reports without changing the publish client's default `2025-04` behavior.
- Money remains a decimal string across Shopify, cache, service, and API boundaries. Sum by currency with `Prisma.Decimal`, never binary floating point.
- Keep `Orders by listing`, Triple Whale KPIs/charts, and existing dashboard filters unchanged.
- Use top-level static imports. Do not add function-body `import()` or `await import()` calls.
- Before editing Next.js client or route files, read these installed guides fully:
  - `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- Preserve the user's existing modifications in `src/lib/triple-whale/analytics.ts` and `src/lib/triple-whale/analytics.test.ts`.
- Do not stage, commit, push, deploy, reconnect stores, release Shopify app versions, or mutate live Shopify configuration without explicit user authorization.

---

## File Map

- Modify `prisma/schema.prisma`: persist Shopify report scope grants and store currency.
- Create `prisma/migrations/20260807120000_shopify_report_access_metadata/migration.sql`: add metadata columns without touching tokens.
- Modify `src/lib/shopify/oauth.ts`: export one required-scope list and normalize granted scopes.
- Create `src/lib/shopify/oauth.test.ts`: lock scope and normalization behavior.
- Modify `src/lib/shopify/client.ts`: allow an explicit API version while retaining the existing default.
- Modify `src/app/api/shopify/callback/route.ts`: persist granted scopes and currency with the replacement token.
- Modify `src/app/(authed)/stores/new/page.tsx`: display `read_reports` in Required Scopes.
- Modify `src/app/(authed)/docs/custom-app/page.tsx`: keep the setup guide scope list consistent.
- Modify `src/app/api/stores/[id]/route.ts`: expose only report-readiness metadata, never secrets.
- Modify `src/app/(authed)/stores/[id]/config/page.tsx`: show Reports Ready or Reconnect required independently of general store status.
- Create `src/app/api/stores/shopify-report-access-source.test.ts`: guard schema, callback, setup UI, guide, and reconnect contract.
- Create `src/lib/shopify/product-sales.ts`: ShopifyQL builder, response parser, API call, and per-store snapshot types.
- Create `src/lib/shopify/product-sales.test.ts`: query, parsing, totals, and error tests.
- Create `src/lib/shopify/product-sales-cache.ts`: Redis key, JSON cache, fill lock, and token-safe release.
- Create `src/lib/shopify/product-sales-cache.test.ts`: hit, miss, TTL, lock, malformed cache, and Redis-degradation tests.
- Create `src/lib/analytics/shopify-product-sales.ts`: tenant mapping, readiness classification, bounded concurrency, combined rows, sorting, and currency summaries.
- Create `src/lib/analytics/shopify-product-sales.test.ts`: same-title preservation, concurrency, status, tenant-selection, and decimal-summary tests.
- Create `src/app/api/dashboard/shopify-product-sales/route.ts`: authenticated request adapter.
- Create `src/app/api/dashboard/shopify-product-sales/route.test.ts`: request validation and route contract tests.
- Create `src/app/(authed)/dashboard/ShopifyProductSalesTable.tsx`: loading/polling wrapper and presentational report card.
- Create `src/app/(authed)/dashboard/ShopifyProductSalesTable.test.tsx`: loading, columns, rows, summary, partial, error, and empty-state tests.
- Modify `src/app/(authed)/dashboard/TripleWhaleDashboard.tsx`: render the new panel with the current filters.
- Modify `src/app/(authed)/dashboard/dashboard-analytics.test.tsx`: verify placement and unchanged dashboard contracts.

---

### Task 1: Persist Report Scope and Currency Through OAuth

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260807120000_shopify_report_access_metadata/migration.sql`
- Modify: `src/lib/shopify/oauth.ts`
- Create: `src/lib/shopify/oauth.test.ts`
- Modify: `src/app/api/shopify/callback/route.ts`
- Modify: `src/app/(authed)/stores/new/page.tsx`
- Modify: `src/app/(authed)/docs/custom-app/page.tsx`
- Modify: `src/app/api/stores/[id]/route.ts`
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx`
- Create: `src/app/api/stores/shopify-report-access-source.test.ts`

**Interfaces:**
- Produces: `SHOPIFY_REQUIRED_SCOPES: readonly string[]` and `normalizeGrantedScopes(scope: string): string[]` from `src/lib/shopify/oauth.ts`.
- Produces: `Store.shopifyCurrencyCode: string | null` and `StoreCredentials.shopifyGrantedScopes: string[]`.
- Produces: `shopifyReportAccessReady: boolean` and `shopifyGrantedScopes: string[]` in the tenant-scoped Store detail response.
- Consumes: the existing OAuth token exchange `{ accessToken, scope }` and `ShopInfo.currencyCode`.

- [ ] **Step 1: Write failing OAuth scope tests**

Create `src/lib/shopify/oauth.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildAuthorizationUrl,
  normalizeGrantedScopes,
  SHOPIFY_REQUIRED_SCOPES,
} from "./oauth";

describe("Shopify OAuth report access", () => {
  it("requests read_reports with the existing publish scopes", () => {
    expect(SHOPIFY_REQUIRED_SCOPES).toEqual([
      "write_products",
      "read_products",
      "read_orders",
      "read_reports",
      "write_inventory",
      "read_publications",
      "write_publications",
    ]);

    const url = new URL(
      buildAuthorizationUrl(
        "state",
        "https://app.example/api/shopify/callback",
        "client-id",
        "threads.myshopify.com",
      ),
    );
    expect(url.searchParams.get("scope")?.split(",")).toEqual(SHOPIFY_REQUIRED_SCOPES);
  });

  it("normalizes comma and whitespace separated granted scopes", () => {
    expect(normalizeGrantedScopes("read_orders, read_reports write_products,read_reports")).toEqual([
      "read_orders",
      "read_reports",
      "write_products",
    ]);
  });
});
```

- [ ] **Step 2: Write a failing source contract test for every scope surface**

Create `src/app/api/stores/shopify-report-access-source.test.ts` using `readFileSync` and assert:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../../prisma/schema.prisma", import.meta.url), "utf8");
const callback = readFileSync(new URL("../shopify/callback/route.ts", import.meta.url), "utf8");
const newStore = readFileSync(
  new URL("../../(authed)/stores/new/page.tsx", import.meta.url),
  "utf8",
);
const guide = readFileSync(
  new URL("../../(authed)/docs/custom-app/page.tsx", import.meta.url),
  "utf8",
);
const config = readFileSync(
  new URL("../../(authed)/stores/[id]/config/page.tsx", import.meta.url),
  "utf8",
);

describe("Shopify report access surfaces", () => {
  it("persists granted scopes and currency", () => {
    expect(schema).toContain("shopifyCurrencyCode");
    expect(schema).toContain("shopifyGrantedScopes");
    expect(callback).toContain("normalizeGrantedScopes(scope)");
    expect(callback).toContain("shopifyCurrencyCode: shopInfo.currencyCode");
  });

  it("documents read_reports and exposes reconnect state", () => {
    expect(newStore).toContain('scope: "read_reports"');
    expect(guide).toContain("read_reports");
    expect(config).toContain("Reports access");
    expect(config).toContain("Reconnect required");
  });
});
```

- [ ] **Step 3: Run the new tests and verify they fail**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/lib/shopify/oauth.test.ts src/app/api/stores/shopify-report-access-source.test.ts
```

Expected: FAIL because the scope constant, metadata columns, callback writes, and report-access UI do not exist.

- [ ] **Step 4: Add the Prisma fields and SQL migration**

Add to `Store` near the existing Shopify identity fields:

```prisma
shopifyCurrencyCode String? @map("shopify_currency_code")
```

Add to `StoreCredentials`:

```prisma
shopifyGrantedScopes String[] @default([]) @map("shopify_granted_scopes")
```

Create the migration with exactly:

```sql
ALTER TABLE "stores"
  ADD COLUMN "shopify_currency_code" TEXT;

ALTER TABLE "store_credentials"
  ADD COLUMN "shopify_granted_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
```

- [ ] **Step 5: Centralize requested scopes and normalization**

Replace the private scope string in `src/lib/shopify/oauth.ts` with:

```ts
export const SHOPIFY_REQUIRED_SCOPES = [
  "write_products",
  "read_products",
  "read_orders",
  "read_reports",
  "write_inventory",
  "read_publications",
  "write_publications",
] as const;

const DEFAULT_SCOPES = SHOPIFY_REQUIRED_SCOPES.join(",");

export function normalizeGrantedScopes(scope: string): string[] {
  return [...new Set(scope.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))];
}
```

Keep `buildAuthorizationUrl` and all imports static.

- [ ] **Step 6: Persist metadata in the OAuth callback**

Import `normalizeGrantedScopes` at the top of `src/app/api/shopify/callback/route.ts`. In the existing Store update, add:

```ts
shopifyCurrencyCode: shopInfo.currencyCode,
```

In the existing StoreCredentials update, add:

```ts
shopifyGrantedScopes: normalizeGrantedScopes(scope),
```

Keep encrypted-token replacement and audit logging in the existing successful callback sequence; do not log the token.

- [ ] **Step 7: Update setup UI and guide**

Add this row to `REQUIRED_SCOPES` after `read_orders`:

```ts
{ scope: "read_reports", desc: "Đọc báo cáo doanh thu theo sản phẩm" },
```

Update the setup-step copy so it does not claim a fixed number of scopes. Add this item to the Custom App guide:

```tsx
<li><code>read_reports</code> — Đọc Shopify Analytics theo sản phẩm</li>
```

Ensure both pages also retain `read_publications` and `write_publications`; do not reduce the existing list while adding reports.

- [ ] **Step 8: Expose report readiness without exposing credentials**

In `GET /api/stores/[id]`, select only `shopifyGrantedScopes` from `credentials`, then return:

```ts
shopifyGrantedScopes: store.credentials?.shopifyGrantedScopes ?? [],
shopifyReportAccessReady:
  store.credentials?.shopifyGrantedScopes.includes("read_reports") ?? false,
```

Remove the nested `credentials` object from the serialized response. Never serialize encrypted token or client-secret fields.

Extend `StoreDetail` with:

```ts
shopifyCurrencyCode: string | null;
shopifyGrantedScopes: string[];
shopifyReportAccessReady: boolean;
```

In the Shopify connection card, show `Reports access · Ready` when true and `Reports access · Reconnect required` when false. Show the existing `/api/shopify/authorize?storeId=...` Reconnect action when either the token is expired or report access is missing.

- [ ] **Step 9: Run focused tests and Prisma validation**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/lib/shopify/oauth.test.ts src/app/api/stores/shopify-report-access-source.test.ts src/app/api/stores/store-detail-route-source.test.ts
pnpm exec prisma validate
pnpm prisma generate
```

Expected: all tests PASS, Prisma schema validates, and the patched Prisma generator completes.

- [ ] **Step 10: Review the Task 1 diff**

Run:

```bash
git diff --check
git diff -- prisma/schema.prisma prisma/migrations/20260807120000_shopify_report_access_metadata src/lib/shopify/oauth.ts src/lib/shopify/oauth.test.ts src/app/api/shopify/callback/route.ts 'src/app/(authed)/stores/new/page.tsx' 'src/app/(authed)/docs/custom-app/page.tsx' 'src/app/api/stores/[id]/route.ts' 'src/app/(authed)/stores/[id]/config/page.tsx' src/app/api/stores/shopify-report-access-source.test.ts
```

Expected: no whitespace errors and no unrelated file changes. Do not stage or commit without explicit authorization.

---

### Task 2: Implement and Validate the Per-Store ShopifyQL Report

**Files:**
- Modify: `src/lib/shopify/client.ts`
- Create: `src/lib/shopify/product-sales.ts`
- Create: `src/lib/shopify/product-sales.test.ts`

**Interfaces:**
- Produces: `SHOPIFY_REPORTS_API_VERSION = "2026-01"`.
- Produces: `buildShopifyProductSalesQuery({ from, to }): string`.
- Produces: `parseShopifyProductSalesResponse(response, options): ShopifyProductSalesSnapshot`, where options contain `currencyCode`, `from`, `to`, and an optional test clock.
- Produces: `fetchShopifyProductSales(client, input): Promise<ShopifyProductSalesSnapshot>`.
- Produces: `ShopifyProductSalesSnapshot` containing `rows`, `totals`, `currencyCode`, `from`, `to`, and `fetchedAt`.
- Consumes: `ShopifyClient.graphql<T>(query, variables)` and validated inclusive dates.

- [ ] **Step 1: Write failing query-builder tests**

Create `src/lib/shopify/product-sales.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  buildShopifyProductSalesQuery,
  fetchShopifyProductSales,
  parseShopifyProductSalesResponse,
  SHOPIFY_REPORTS_API_VERSION,
} from "./product-sales";

describe("Shopify product sales report", () => {
  it("builds the approved inclusive ShopifyQL report", () => {
    const query = buildShopifyProductSalesQuery({ from: "2026-08-01", to: "2026-08-07" });
    expect(SHOPIFY_REPORTS_API_VERSION).toBe("2026-01");
    expect(query).toContain("FROM sales");
    expect(query).toContain("SHOW net_items_sold, total_sales");
    expect(query).toContain("WHERE product_title != 'Shipping Insurance'");
    expect(query).toContain("GROUP BY product_title");
    expect(query).toContain("SINCE 2026-08-01");
    expect(query).toContain("UNTIL 2026-08-07");
    expect(query).toContain("ORDER BY total_sales DESC");
    expect(query).toContain("WITH TOTALS");
  });
});
```

- [ ] **Step 2: Add failing parser and transport tests**

Add tests requiring:

```ts
it("parses product rows, None, and Shopify totals without converting money to float", () => {
  const result = parseShopifyProductSalesResponse(
    {
      shopifyqlQuery: {
        parseErrors: [],
        tableData: {
          columns: [],
          rows: [
            {
              product_title: null,
              net_items_sold: "1",
              total_sales: "1488.28",
              net_items_sold__totals: "7",
              total_sales__totals: "1678.32",
            },
            {
              product_title: "Good Day To Cross Stitch T-shirt",
              net_items_sold: "6",
              total_sales: "190.04",
              net_items_sold__totals: "7",
              total_sales__totals: "1678.32",
            },
          ],
        },
      },
    },
    { currencyCode: "USD", from: "2026-08-01", to: "2026-08-01", now: () => new Date("2026-08-07T00:00:00Z") },
  );

  expect(result.rows).toEqual([
    { productTitle: null, netItemsSold: 1, totalSales: "1488.28" },
    { productTitle: "Good Day To Cross Stitch T-shirt", netItemsSold: 6, totalSales: "190.04" },
  ]);
  expect(result.totals).toEqual({ netItemsSold: 7, totalSales: "1678.32" });
  expect(result.fetchedAt).toBe("2026-08-07T00:00:00.000Z");
});

it("rejects ShopifyQL parse errors and malformed numeric rows", () => {
  expect(() =>
    parseShopifyProductSalesResponse(
      { shopifyqlQuery: { parseErrors: ["Invalid metric"], tableData: null } },
      { currencyCode: "USD", from: "2026-08-01", to: "2026-08-01" },
    ),
  ).toThrow("Invalid metric");
});

it("passes the report as a GraphQL variable", async () => {
  const graphql = vi.fn().mockResolvedValue({
    shopifyqlQuery: { parseErrors: [], tableData: { columns: [], rows: [] } },
  });
  await fetchShopifyProductSales(
    { graphql },
    { from: "2026-08-01", to: "2026-08-01", currencyCode: "USD" },
  );
  expect(graphql).toHaveBeenCalledWith(expect.stringContaining("$shopifyql: String!"), {
    shopifyql: expect.stringContaining("GROUP BY product_title"),
  });
});
```

Also test a legitimate empty `rows: []` result returns zero totals and can be cached.

- [ ] **Step 3: Run the report tests and verify they fail**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/lib/shopify/product-sales.test.ts
```

Expected: FAIL because the report module and explicit API version do not exist.

- [ ] **Step 4: Allow explicit Shopify API versions without changing defaults**

In `src/lib/shopify/client.ts`, keep the existing default constant and change the constructor to:

```ts
const DEFAULT_SHOPIFY_API_VERSION = "2025-04";

constructor(domain: string, accessToken: string, apiVersion = DEFAULT_SHOPIFY_API_VERSION) {
  this.domain = domain;
  this.accessToken = accessToken;
  this.graphqlUrl = `https://${domain}/admin/api/${apiVersion}/graphql.json`;
}
```

Do not update existing call sites. Product-sales orchestration will construct this client with `SHOPIFY_REPORTS_API_VERSION`.

Also preserve the HTTP status on authentication errors so report orchestration can distinguish an expired token from denied report access:

```ts
export class ShopifyAuthError extends Error {
  constructor(message: string, public readonly status: 401 | 403) {
    super(message);
    this.name = "ShopifyAuthError";
  }
}
```

Throw status 401 for an unauthorized response and status 403 for a forbidden response. Existing `instanceof ShopifyAuthError` consumers continue to work.

- [ ] **Step 5: Implement the report types, builder, parser, and fetcher**

Create `src/lib/shopify/product-sales.ts` with these public types:

```ts
export const SHOPIFY_REPORTS_API_VERSION = "2026-01";

export type ShopifyProductSalesSnapshotRow = {
  productTitle: string | null;
  netItemsSold: number;
  totalSales: string;
};

export type ShopifyProductSalesSnapshot = {
  from: string;
  to: string;
  currencyCode: string;
  fetchedAt: string;
  rows: ShopifyProductSalesSnapshotRow[];
  totals: { netItemsSold: number; totalSales: string };
};
```

Use one static GraphQL document with a `$shopifyql: String!` variable. Parse rows as records, validate `net_items_sold` as a finite integer, preserve `total_sales` as a normalized decimal string, and read `__totals` values from the first row. Treat missing totals on an empty report as zero; reject missing totals on a non-empty report.

Define a named `ShopifyProductSalesResponseError` for GraphQL/ShopifyQL shape failures so orchestration can distinguish malformed report data from authentication errors.

- [ ] **Step 6: Run the focused report tests**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/lib/shopify/product-sales.test.ts
```

Expected: all query, parser, empty-result, parse-error, malformed-row, and GraphQL-variable tests PASS.

- [ ] **Step 7: Review the Task 2 diff**

Run:

```bash
git diff --check
git diff -- src/lib/shopify/client.ts src/lib/shopify/product-sales.ts src/lib/shopify/product-sales.test.ts
```

Expected: the existing client default remains `2025-04`; only product reports select `2026-01`. Do not stage or commit without explicit authorization.

---

### Task 3: Add the Redis 10-Minute Cache and Fill Lock

**Files:**
- Create: `src/lib/shopify/product-sales-cache.ts`
- Create: `src/lib/shopify/product-sales-cache.test.ts`

**Interfaces:**
- Produces: `productSalesCacheKey(input): string`.
- Produces: `ShopifyProductSalesCache.load(input): Promise<{ status: "hit" | "loaded"; snapshot: ShopifyProductSalesSnapshot } | { status: "loading" }>`.
- Consumes: `ShopifyProductSalesSnapshot` and an injected `fetchSnapshot(): Promise<ShopifyProductSalesSnapshot>`.
- Uses: one shared Redis connection per cache instance and closes only connections it owns.

- [ ] **Step 1: Write failing key and cache-hit tests**

Create `src/lib/shopify/product-sales-cache.test.ts` with a fake Redis object and assert:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  productSalesCacheKey,
  ShopifyProductSalesCache,
} from "./product-sales-cache";

const snapshot = {
  from: "2026-08-01",
  to: "2026-08-07",
  currencyCode: "USD",
  fetchedAt: "2026-08-07T00:00:00.000Z",
  rows: [{ productTitle: "Product", netItemsSold: 2, totalSales: "59.98" }],
  totals: { netItemsSold: 2, totalSales: "59.98" },
};

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
  const redis = {
    get: vi.fn().mockResolvedValue(JSON.stringify(snapshot)),
    set: vi.fn(),
    eval: vi.fn(),
    disconnect: vi.fn(),
  };
  const cache = new ShopifyProductSalesCache({ redis });
  await expect(
    cache.load({ tenantId: "tenant-1", storeId: "store-1", from: "2026-08-01", to: "2026-08-07", fetchSnapshot }),
  ).resolves.toEqual({ status: "hit", snapshot });
  expect(fetchSnapshot).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Add failing miss, TTL, lock, and Redis-degradation tests**

Require the fake Redis calls to include:

```ts
expect(redis.set).toHaveBeenCalledWith(cacheKey, JSON.stringify(snapshot), "EX", 600);
expect(redis.set).toHaveBeenCalledWith(`${cacheKey}:lock`, expect.any(String), "PX", 30_000, "NX");
```

Add separate tests for:

- Lock acquisition returns `null`: result is `{ status: "loading" }` and Shopify is not called.
- Malformed cached JSON is treated as a miss and replaced after a successful load.
- `get` or lock `set` throws: call Shopify directly and return `loaded`.
- Cache-data `set` throws after Shopify succeeds: still return the successful snapshot.
- Loader throws: do not write the data key.
- Token-safe Lua release receives the lock key and original random token.
- `close()` disconnects an internally created Redis client but not an injected fake.

- [ ] **Step 3: Run the cache tests and verify they fail**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/lib/shopify/product-sales-cache.test.ts
```

Expected: FAIL because the cache module does not exist.

- [ ] **Step 4: Implement the cache class and safe release**

Create `src/lib/shopify/product-sales-cache.ts` with:

```ts
const CACHE_TTL_SECONDS = 600;
const LOCK_TTL_MS = 30_000;

const RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;
```

Use `randomUUID()` from `node:crypto`, `ioredis`, top-level imports, and a `RedisLike` type containing `get`, `set`, `eval`, and `disconnect`.

Cache behavior must be ordered exactly:

1. Read and validate the cached JSON snapshot.
2. On miss, acquire `<cacheKey>:lock` with the random token, `PX 30000`, and `NX`.
3. If another request holds the lock, return `loading`.
4. If this request holds the lock, call `fetchSnapshot`.
5. Store only a successful snapshot with `EX 600`.
6. Release by token comparison in `finally`.
7. Log Redis failures without domains, tokens, cached report contents, or credentials.
8. Fall back to direct Shopify loading when Redis is unavailable.

Validate cached JSON before trusting it: matching `from`, `to`, and `currencyCode`; array rows; integer Net items sold; decimal-string sales; and totals shape.

- [ ] **Step 5: Run the focused cache tests**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/lib/shopify/product-sales-cache.test.ts
```

Expected: all cache and lock tests PASS.

- [ ] **Step 6: Review the Task 3 diff**

Run:

```bash
git diff --check
git diff -- src/lib/shopify/product-sales-cache.ts src/lib/shopify/product-sales-cache.test.ts
```

Expected: the data key contains no product title or timezone, TTL is exactly 600 seconds, and the lock is exactly 30 seconds. Do not stage or commit without explicit authorization.

---

### Task 4: Build Tenant-Scoped Multi-Store Orchestration

**Files:**
- Create: `src/lib/analytics/shopify-product-sales.ts`
- Create: `src/lib/analytics/shopify-product-sales.test.ts`

**Interfaces:**
- Produces: `ShopifyProductSalesRow`, `ShopifyProductSalesStoreStatus`, and `ShopifyProductSalesResponse` exactly as defined in the spec.
- Produces: `getDashboardShopifyProductSales(input, dependencies?): Promise<ShopifyProductSalesResponse>`.
- Produces: `DashboardShopCandidate` shaped as `{ shopId, shopDomain, store }`, where `store` is null or `{ id, name, status, currencyCode, tokenEncrypted, grantedScopes }`.
- Produces: injectable `ShopifyProductSalesDependencies` with `listDashboardShops(input)` and `loadReadyStore(input)` so tenant selection and combination logic can be tested without real credentials, Redis, or Shopify.
- Consumes: Triple Whale credential IDs/domains, tenant-scoped Store records, encrypted per-store Shopify tokens, persisted scopes/currency, `ShopifyProductSalesCache`, and the report fetcher from Tasks 2-3.
- Guarantees: at most three active store loads and no cross-store title merge.

- [ ] **Step 1: Write failing same-title and selector tests**

Create `src/lib/analytics/shopify-product-sales.test.ts` with injected repository and loader dependencies. Require two same-title rows to remain separate:

```ts
import { describe, expect, it } from "vitest";

import { getDashboardShopifyProductSales } from "./shopify-product-sales";

it("keeps equal product titles separate by store in All shops", async () => {
  const shops = [
    {
      shopId: "credential-a",
      shopDomain: "a.myshopify.com",
      store: {
        id: "store-a",
        name: "ThreadsMuse",
        status: "ACTIVE" as const,
        currencyCode: "USD",
        tokenEncrypted: new Uint8Array([1]),
        grantedScopes: ["read_reports"],
      },
    },
    {
      shopId: "credential-b",
      shopDomain: "b.myshopify.com",
      store: {
        id: "store-b",
        name: "Store B",
        status: "ACTIVE" as const,
        currencyCode: "USD",
        tokenEncrypted: new Uint8Array([2]),
        grantedScopes: ["read_reports"],
      },
    },
  ];
  const snapshots = {
    "store-a": {
      from: "2026-08-01",
      to: "2026-08-01",
      currencyCode: "USD",
      fetchedAt: "2026-08-07T00:00:00.000Z",
      rows: [{ productTitle: "Good Day T-shirt", netItemsSold: 6, totalSales: "190.04" }],
      totals: { netItemsSold: 6, totalSales: "190.04" },
    },
    "store-b": {
      from: "2026-08-01",
      to: "2026-08-01",
      currencyCode: "USD",
      fetchedAt: "2026-08-07T00:00:00.000Z",
      rows: [{ productTitle: "Good Day T-shirt", netItemsSold: 4, totalSales: "132.50" }],
      totals: { netItemsSold: 4, totalSales: "132.50" },
    },
  };

  const result = await getDashboardShopifyProductSales(
    { tenantId: "tenant", from: "2026-08-01", to: "2026-08-01", shopId: null },
    {
      listDashboardShops: async () => shops,
      loadReadyStore: async ({ candidate }) => ({
        status: "loaded",
        snapshot: snapshots[candidate.store!.id as keyof typeof snapshots],
      }),
    },
  );

  expect(result.rows).toEqual([
    expect.objectContaining({ storeId: "store-a", storeName: "ThreadsMuse", productTitle: "Good Day T-shirt" }),
    expect.objectContaining({ storeId: "store-b", storeName: "Store B", productTitle: "Good Day T-shirt" }),
  ]);
  expect(result.summary).toEqual({ netItemsSold: 10, totalSalesByCurrency: { USD: "322.54" } });
});
```

Add a selected-shop test asserting only the requested tenant-owned credential is loaded. Add an unknown credential test expecting `Unknown Triple Whale shop`.

- [ ] **Step 2: Add failing readiness, partial, currency, sorting, and concurrency tests**

Add tests requiring:

- `store_unmapped` when a Triple Whale domain has no tenant Store.
- `not_connected` when the mapped Store has no token.
- `missing_scope` when persisted scopes omit `read_reports`; loader is not called.
- `token_expired` when `ShopifyAuthError` is thrown.
- `loading` when the cache reports a held fill lock.
- `failed` for parse/transport failures without zero rows.
- `partial: true` whenever any store status is not `ok`.
- Separate `{ USD: "...", CAD: "..." }` totals without FX conversion.
- Numeric sales sorting, not lexicographic sorting (`"100.00"` before `"9.00"`).
- Deterministic ties by Store name and Product title.
- A deferred-promise test that observes no more than three simultaneous store loaders.

- [ ] **Step 3: Run orchestration tests and verify they fail**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/lib/analytics/shopify-product-sales.test.ts
```

Expected: FAIL because the analytics service does not exist.

- [ ] **Step 4: Implement tenant-scoped repository mapping**

Define one focused repository method that:

1. Lists either the requested tenant-owned Triple Whale credential or all tenant credentials.
2. Loads non-deleted Stores by `tenantId + shopifyDomain`.
3. Selects only `id`, `name`, `shopifyDomain`, `shopifyCurrencyCode`, `status`, `credentials.shopifyTokenEncrypted`, and `credentials.shopifyGrantedScopes`.
4. Preserves a result for every selected credential, including unmapped domains.

Do not query all Stores independently of the dashboard selector. Do not serialize encrypted credentials into the final response.

- [ ] **Step 5: Implement bounded loading and typed status mapping**

Add a local static helper:

```ts
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]>;
```

Use `concurrency = 3`. For each report-ready Store:

1. Decrypt its token.
2. Construct `new ShopifyClient(domain, token, SHOPIFY_REPORTS_API_VERSION)`.
3. Call the per-store cache with the exact tenant/store/from/to key input.
4. Fetch Shopify only inside the cache loader.
5. Convert cache `loading` to store status `loading`.
6. Attach `storeId`, `storeName`, and `currencyCode` to each successful snapshot row.

Classify `ShopifyAuthError.status === 401` as `token_expired`. A 403 response after the persisted scope check becomes `failed` with the safe message `Shopify denied reports access`; it must not be mislabeled as an expired token. Convert all other upstream errors into safe store-level messages without leaking Shopify responses that could contain sensitive details.

- [ ] **Step 6: Implement decimal summaries and deterministic sorting**

Use `Prisma.Decimal` for:

- Per-currency accumulation of each successful snapshot's Shopify total.
- Numeric row comparison by `totalSales`.

Use the snapshot's Shopify totals for Summary; do not derive Summary from visible rows. Sum Net items sold as integers. Return each `Prisma.Decimal` currency total with `.toString()` and let the UI's currency formatter control display precision.

Set `partial` whenever any selected store is not `ok`. A legitimate empty successful store remains `ok` and contributes zero.

- [ ] **Step 7: Run orchestration tests**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/lib/analytics/shopify-product-sales.test.ts src/lib/shopify/product-sales.test.ts src/lib/shopify/product-sales-cache.test.ts
```

Expected: all service, parser, and cache tests PASS.

- [ ] **Step 8: Review the Task 4 diff**

Run:

```bash
git diff --check
git diff -- src/lib/analytics/shopify-product-sales.ts src/lib/analytics/shopify-product-sales.test.ts
```

Expected: no title-based cross-store aggregation, no unbounded `Promise.all`, and no secrets in response types or logs. Do not stage or commit without explicit authorization.

---

### Task 5: Expose the Authenticated Dashboard Endpoint

**Files:**
- Create: `src/app/api/dashboard/shopify-product-sales/route.ts`
- Create: `src/app/api/dashboard/shopify-product-sales/route.test.ts`

**Interfaces:**
- Consumes: `from`, `to`, and optional `shopId` query parameters.
- Produces: `ShopifyProductSalesResponse` JSON.
- Uses: `requireFeature("stores")` and `getDashboardShopifyProductSales`.

- [ ] **Step 1: Read the installed Next.js Route Handler guide**

Read fully:

```bash
sed -n '1,260p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
```

Expected: confirm the current Next.js 16 Request/Response and route-file conventions before editing.

- [ ] **Step 2: Write failing request-parser tests**

Create `src/app/api/dashboard/shopify-product-sales/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseShopifyProductSalesRequest } from "./route";

describe("Dashboard Shopify product sales request", () => {
  it("uses the dashboard date range and optional Triple Whale shop id", () => {
    expect(
      parseShopifyProductSalesRequest(
        new URLSearchParams("from=2026-08-01&to=2026-08-07&shopId=credential-1"),
      ),
    ).toEqual({ from: "2026-08-01", to: "2026-08-07", shopId: "credential-1" });
  });

  it("rejects missing, inverted, malformed, and oversized ranges", () => {
    expect(() => parseShopifyProductSalesRequest(new URLSearchParams("to=2026-08-01"))).toThrow("from and to required");
    expect(() => parseShopifyProductSalesRequest(new URLSearchParams("from=2026-08-08&to=2026-08-01"))).toThrow("Invalid date range");
    expect(() => parseShopifyProductSalesRequest(new URLSearchParams("from=x&to=2026-08-01"))).toThrow("Invalid date range");
    expect(() => parseShopifyProductSalesRequest(new URLSearchParams("from=2025-01-01&to=2026-01-02"))).toThrow("Date range cannot exceed 366 days");
  });
});
```

- [ ] **Step 3: Run route tests and verify they fail**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/app/api/dashboard/shopify-product-sales/route.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 4: Implement the thin authenticated route**

The route must:

1. Call `requireFeature("stores")`.
2. Validate strict `YYYY-MM-DD` values, inclusive ordering, and a maximum of 366 days using the existing date-range utility.
3. Normalize an empty `shopId` to `null`.
4. Call `getDashboardShopifyProductSales` with `session.tenantId`.
5. Return operational per-store failures inside a successful typed JSON response.
6. Return 400 for invalid ranges or unknown tenant shop IDs.
7. Avoid `Cache-Control: public`; this is tenant-authenticated data.

No route code may decrypt tokens, build ShopifyQL, construct Redis keys, or merge report rows.

- [ ] **Step 5: Run route and service tests**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/app/api/dashboard/shopify-product-sales/route.test.ts src/lib/analytics/shopify-product-sales.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Review the Task 5 diff**

Run:

```bash
git diff --check
git diff -- src/app/api/dashboard/shopify-product-sales/route.ts src/app/api/dashboard/shopify-product-sales/route.test.ts
```

Expected: route remains a thin auth/validation adapter. Do not stage or commit without explicit authorization.

---

### Task 6: Add Loading, Polling, and the Per-Store Product Table

**Files:**
- Create: `src/app/(authed)/dashboard/ShopifyProductSalesTable.tsx`
- Create: `src/app/(authed)/dashboard/ShopifyProductSalesTable.test.tsx`
- Modify: `src/app/(authed)/dashboard/TripleWhaleDashboard.tsx`
- Modify: `src/app/(authed)/dashboard/dashboard-analytics.test.tsx`

**Interfaces:**
- Consumes: `from: string`, `to: string`, and `selectedShopId: string` from the existing `DashboardFilterValue`.
- Fetches: `/api/dashboard/shopify-product-sales?from=...&to=...&shopId=...`.
- Produces: `ShopifyProductSalesPanel` for static presentation tests and default `ShopifyProductSalesTable` for loading/polling.

- [ ] **Step 1: Read the installed Client Component guide**

Read fully:

```bash
sed -n '1,260p' node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md
```

Expected: confirm client-boundary and serializable-prop constraints before adding the component.

- [ ] **Step 2: Write failing loading and selected-shop presentation tests**

Create `src/app/(authed)/dashboard/ShopifyProductSalesTable.test.tsx` using `renderToStaticMarkup`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShopifyProductSalesLoading, ShopifyProductSalesPanel } from "./ShopifyProductSalesTable";

it("shows a dedicated loading card before report data is ready", () => {
  const markup = renderToStaticMarkup(<ShopifyProductSalesLoading />);
  expect(markup).toContain('aria-label="Loading Shopify product sales"');
  expect(markup).toContain("Loading Shopify product sales");
});

it("hides Store for one shop and renders Shopify metrics", () => {
  const markup = renderToStaticMarkup(
    <ShopifyProductSalesPanel
      data={{
        from: "2026-08-01",
        to: "2026-08-01",
        selectedShopId: "credential-a",
        rows: [{ storeId: "store-a", storeName: "ThreadsMuse", productTitle: "Good Day T-shirt", netItemsSold: 6, totalSales: "190.04", currencyCode: "USD" }],
        summary: { netItemsSold: 6, totalSalesByCurrency: { USD: "190.04" } },
        stores: [{ storeId: "store-a", storeName: "ThreadsMuse", shopId: "credential-a", status: "ok" }],
        partial: false,
      }}
      onRetry={() => undefined}
    />,
  );
  expect(markup).toContain("Product title");
  expect(markup).not.toContain(">Store</th>");
  expect(markup).toContain("Net items sold");
  expect(markup).toContain("$190.04");
});
```

- [ ] **Step 3: Add failing All-shops, mixed-currency, partial, empty, and error tests**

Add static presentation tests requiring:

- All shops renders a Store header and two same-title rows with different Store names.
- `None` is shown for null product title.
- The Summary row shows global Net items sold.
- Mixed currencies show separate USD and CAD subtotals.
- Partial data shows `2/3 stores loaded` and the unavailable store reason.
- Zero successful rows with all stores terminal renders `No Shopify product sales for this period`.
- Every failed store renders an error state and Retry button.
- Table wrapper has horizontal overflow and numeric cells do not wrap.

Extend `dashboard-analytics.test.tsx` to require `ShopifyProductSalesTable` after metric cards and before `DashboardOrderAnalytics`.

- [ ] **Step 4: Run component tests and verify they fail**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' 'src/app/(authed)/dashboard/ShopifyProductSalesTable.test.tsx' 'src/app/(authed)/dashboard/dashboard-analytics.test.tsx'
```

Expected: FAIL because the component and dashboard integration do not exist.

- [ ] **Step 5: Implement the presentational card**

Create `ShopifyProductSalesPanel` with:

- Heading and selected range.
- Summary row before product rows.
- Conditional Store column based on `data.selectedShopId === null`.
- React row key `${row.storeId}:${row.productTitle ?? "__none__"}`.
- Per-row `Intl.NumberFormat` using `row.currencyCode`.
- Per-currency summary formatting.
- Partial warning with successful/selected counts and store messages.
- Empty and all-failed states.
- Retry button for partial/all-failed states.
- Existing dashboard CSS variables and card/table conventions; no new design system.

Do not aggregate equal titles in this component.

- [ ] **Step 6: Implement request, loading, lock polling, and cancellation**

The default client wrapper must:

1. Start with `loading = true` and no response for each new `{ from, to, selectedShopId }` key.
2. Abort the previous `fetch` through `AbortController` on filter change or unmount.
3. Build the endpoint query with `from`, `to`, and optional `shopId`.
4. Render only `ShopifyProductSalesLoading` until the first terminal response for the current key.
5. If any store status is `loading`, wait 1,000 ms and fetch the same endpoint again.
6. Stop lock polling after 30,000 ms, then render successful rows plus timed-out store status and Retry.
7. Ignore aborted/stale responses and never flash the previous date range under a new filter.
8. Clear retry timers in effect cleanup.

Use top-level static imports and no third-party data-fetching dependency.

- [ ] **Step 7: Integrate below KPI cards**

In `TripleWhaleDashboard.tsx`, render:

```tsx
<ShopifyProductSalesTable
  from={filters.from}
  selectedShopId={filters.selectedShopId}
  to={filters.to}
/>
```

Place it immediately after `AnalyticsMetricCards` and before `DashboardOrderAnalytics`. Do not change filter state, Triple Whale loading, charts, sync polling, or the user's existing analytics edits.

- [ ] **Step 8: Run dashboard component tests**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' 'src/app/(authed)/dashboard/ShopifyProductSalesTable.test.tsx' 'src/app/(authed)/dashboard/dashboard-analytics.test.tsx' 'src/app/(authed)/dashboard/DashboardOrderAnalytics.test.tsx'
```

Expected: loading, table, Store-column switching, partial/error/empty states, product-panel placement, and existing order panel tests PASS.

- [ ] **Step 9: Review the Task 6 diff**

Run:

```bash
git diff --check
git diff -- 'src/app/(authed)/dashboard/ShopifyProductSalesTable.tsx' 'src/app/(authed)/dashboard/ShopifyProductSalesTable.test.tsx' 'src/app/(authed)/dashboard/TripleWhaleDashboard.tsx' 'src/app/(authed)/dashboard/dashboard-analytics.test.tsx'
```

Expected: the component receives the existing filters, All shops shows Store, selected shop hides Store, and the previous report is not rendered during a new range load. Do not stage or commit without explicit authorization.

---

### Task 7: Full Verification and Controlled Shopify Comparison

**Files:**
- Verify all files listed above.
- Do not modify deployment, PM2, Shopify app versions, store tokens, or live Redis without separate authorization.

**Interfaces:**
- Consumes: completed Tasks 1-6.
- Produces: local verification evidence and a controlled live-read checklist.

- [ ] **Step 1: Run the complete focused test suite**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/lib/shopify/oauth.test.ts src/app/api/stores/shopify-report-access-source.test.ts src/lib/shopify/product-sales.test.ts src/lib/shopify/product-sales-cache.test.ts src/lib/analytics/shopify-product-sales.test.ts src/app/api/dashboard/shopify-product-sales/route.test.ts 'src/app/(authed)/dashboard/ShopifyProductSalesTable.test.tsx' 'src/app/(authed)/dashboard/dashboard-analytics.test.tsx' 'src/app/(authed)/dashboard/DashboardOrderAnalytics.test.tsx'
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run existing Shopify and dashboard regression suites**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/shopify.test.ts src/lib/publish/shopify-sync.test.ts src/lib/publish/shopify-post-sync.test.ts
pnpm exec vitest run --exclude '.next/**' src/lib/triple-whale/analytics.test.ts src/app/api/triple-whale/analytics/route.test.ts src/app/api/dashboard/order-analytics/route.test.ts
```

Expected: publish GraphQL behavior, Triple Whale analytics, and existing order analytics remain green. Report separately if the user's pre-existing Triple Whale edits cause a failure.

- [ ] **Step 3: Validate Prisma and production build**

Run:

```bash
pnpm exec prisma validate
pnpm prisma generate
pnpm run build
git diff --check
```

Expected: Prisma validates/generates, Next.js production build passes, and no whitespace errors exist. Label a build failure separately if it is unrelated to the product-sales diff.

- [ ] **Step 4: Audit the final worktree scope**

Run:

```bash
git status --short
git diff --stat
git diff --name-only
```

Expected: only the planned product-sales/OAuth/dashboard files plus the user's pre-existing `src/lib/triple-whale/analytics.ts` and `src/lib/triple-whale/analytics.test.ts` modifications appear. Do not stage or commit.

- [ ] **Step 5: Prepare the controlled live-read checklist**

After the user separately authorizes Shopify configuration and live verification:

1. Add `read_reports` in one store's Shopify app version and release it.
2. Reconnect only that Store in MockupAI.
3. Confirm Store Config reports `Reports access · Ready` and the persisted currency is correct.
4. Select that single shop and Yesterday in the dashboard.
5. Compare Summary, `None`, top product titles, Net items sold, and Total sales with Shopify Admin Analytics for the same store/date.
6. Reload within 10 minutes and confirm the response is a cache hit without a second Shopify report call.
7. After the data TTL expires, confirm one request fills the key and concurrent requests observe the fill lock.
8. Select All shops only after at least two stores have `read_reports`; confirm the Store column appears and equal titles remain separate.
9. If currencies differ, confirm separate subtotals and no combined FX value.
10. Record any ShopifyQL clause/field incompatibility as a blocker; do not silently fall back to local-order calculations.

Expected: the controlled store matches Shopify Admin, cache behavior matches the exact key/TTL contract, and All shops distinguishes stores.

---

## Final Acceptance Checklist

- [ ] Store setup, guide, and OAuth all request `read_reports`.
- [ ] Granted scopes and currency are persisted without exposing credentials.
- [ ] Existing stores clearly require Reconnect until the new scope is granted.
- [ ] The product report uses ShopifyQL and API version 2026-01.
- [ ] Shopify groups by product title inside each store.
- [ ] All shops appends rows and shows Store; equal titles are not merged.
- [ ] Selected shop hides Store.
- [ ] Dashboard `from` and `to` drive the report.
- [ ] Cache key is `shopify-product-sales:v1:{tenantId}:{storeId}:{from}:{to}`.
- [ ] Cache uses Redis String `SET ... EX 600`.
- [ ] Fill lock uses unique token `SET ... NX PX 30000` and token-safe release.
- [ ] Redis failure falls back to Shopify.
- [ ] Loading appears before uncached data; held locks poll for at most 30 seconds.
- [ ] Partial stores are disclosed and never counted as zero.
- [ ] Money is summed only within each currency.
- [ ] Existing Orders by listing and Triple Whale dashboard behavior remain intact.
- [ ] Focused tests, Prisma validation/generation, build, and `git diff --check` pass.
- [ ] No commit, push, deploy, Shopify configuration change, or live mutation occurs without explicit authorization.
