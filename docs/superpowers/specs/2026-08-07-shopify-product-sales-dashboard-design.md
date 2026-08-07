# Shopify Product Sales Dashboard Design

**Date:** 2026-08-07
**Status:** Approved

## Goal

Add a Shopify-native product sales table to the existing analytics dashboard. The table uses the same inclusive `from` and `to` dates and the same single-shop versus All shops selector as the Order Revenue dashboard metrics.

The report must match Shopify Analytics semantics by querying ShopifyQL for `net_items_sold` and `total_sales`. The application must not reconstruct those metrics from local orders, Inkhub orders, or Triple Whale data.

## Confirmed Product Decisions

- Shopify performs `GROUP BY product_title` inside each individual store report.
- The application does not merge equal product titles across stores.
- All shops appends the per-store report rows and adds a visible Store column.
- A row is identified in the combined response by `storeId + productTitle`.
- Selecting one shop hides the Store column because every row belongs to the same shop.
- The report uses the dashboard's existing `from` and `to` date values.
- Date strings are sent to each Shopify store without a dashboard timezone in the cache key. Shopify interprets the report dates according to that store's reporting calendar.
- The Redis data cache key is exactly `shopify-product-sales:v1:{tenantId}:{storeId}:{from}:{to}`.
- `productTitle` is data inside the cached report and is not part of the Redis cache key.
- A fresh cache entry lives for 600 seconds.
- The first uncached load renders a dedicated loading card before rendering the table.
- The feature is a new Shopify Analytics panel. It does not replace the existing Inkhub-backed `Orders by listing` panel.

## Dashboard Placement and UI

The new `Total sales by product` card renders immediately below the KPI cards and before `Orders by listing`. This keeps Shopify revenue detail close to Order Revenue while preserving the current fulfillment-cost panel and analytics charts.

The card contains:

1. Heading: `Total sales by product`.
2. The selected inclusive date range.
3. A loading state while the requested cache keys are missing and Shopify requests are in flight.
4. A summary row.
5. A responsive table sorted by Total sales descending.

All shops columns:

| Store | Product title | Net items sold | Total sales |
|---|---|---:|---:|

Selected-shop columns:

| Product title | Net items sold | Total sales |
|---|---:|---:|

Rows with a null or empty Shopify product title display `None`, matching Shopify Admin. `Shipping Insurance` is excluded by the ShopifyQL query and never appears in the table.

Product thumbnails are out of scope. ShopifyQL does not return them, and adding them would require a separate product lookup and a cross-store image-selection rule.

On narrow screens, the card remains full width and the table scrolls horizontally. Numeric columns remain right-aligned and do not wrap.

## ShopifyQL Contract

Each store is queried independently through Shopify Admin GraphQL API version `2026-01`. The existing publish client can retain its current default API version; product-sales requests select `2026-01` explicitly so this feature does not silently change publish behavior.

The logical ShopifyQL report is:

```sql
FROM sales
SHOW net_items_sold, total_sales
WHERE product_title != 'Shipping Insurance'
GROUP BY product_title
SINCE <from>
UNTIL <to>
ORDER BY total_sales DESC
WITH TOTALS
```

The exact accepted clause order must be covered by a controlled live probe before production release. The GraphQL response requests:

```graphql
tableData {
  columns {
    name
    dataType
    displayName
  }
  rows
}
parseErrors
```

Any non-empty `parseErrors` result is an upstream failure. It is not an empty report and must not be cached.

Official contract: [Shopify Admin GraphQL `shopifyqlQuery`](https://shopify.dev/docs/api/admin-graphql/2026-01/queries/shopifyqlQuery). The operation requires `read_reports` and currently documents Level 2 protected customer data access.

## Store Authorization and Metadata

The required Shopify scopes become:

```text
write_products
read_products
read_orders
read_reports
write_inventory
read_publications
write_publications
```

The scope list must stay identical in:

- The store-connection setup UI.
- The Custom App guide.
- The OAuth authorization request.

Existing Shopify tokens do not become report-ready merely because the local scope constant changes. For each existing store, an administrator must add `read_reports` to the corresponding Shopify app version, release that version, and reconnect the store through OAuth.

The OAuth callback persists:

- The granted Shopify scopes returned by token exchange.
- The shop currency returned by `shop.currencyCode`.

`StoreCredentials.shopifyGrantedScopes` is the source of truth for whether the current token has `read_reports`. `Store.shopifyCurrencyCode` is the source of truth for formatting report money.

Missing report scope does not change the store's general `ACTIVE` status because product publishing may still work. Store configuration displays a separate report-access status and a Reconnect action whenever `read_reports` is absent.

The dashboard never attempts ShopifyQL for a store whose token is missing or whose persisted granted scopes do not include `read_reports`.

## Shop Selection Semantics

The existing dashboard selector contains Triple Whale credential IDs. The new endpoint preserves that contract rather than introducing a second selector.

- One shop: validate the requested Triple Whale credential against the tenant, then map `TripleWhaleCredential.shopDomain` to `Store.shopifyDomain` within the same tenant.
- All shops: list the tenant's Triple Whale credentials, map each domain to a non-deleted internal Store, and report unmapped stores as unavailable.
- The endpoint never includes an internal Shopify Store that is absent from the current dashboard selector.
- No store or credential from another tenant can enter the response or a Redis key.

This keeps All shops consistent across Order Revenue, charts, workspace metrics, Inkhub order analytics, and Shopify product sales.

## API Response

The authenticated endpoint is:

```text
GET /api/dashboard/shopify-product-sales?from=YYYY-MM-DD&to=YYYY-MM-DD&shopId=<optional>
```

Dates are inclusive. The maximum range is 366 days, matching the existing dashboard order analytics guard.

```ts
type ShopifyProductSalesRow = {
  storeId: string;
  storeName: string;
  productTitle: string | null;
  netItemsSold: number;
  totalSales: string;
  currencyCode: string;
};

type ShopifyProductSalesStoreStatus = {
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

type ShopifyProductSalesResponse = {
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
```

Rows remain separate per store even when titles match. The server sorts the combined rows by numeric Total sales descending, then Store name and Product title for deterministic ties.

Operational store failures are represented in `stores` and normally return HTTP 200 so successful stores remain visible. Authentication and invalid request parameters use 4xx responses.

## Summary and Currency Rules

The summary Net items sold value is the sum of successful store totals.

Money is never added across currencies. The API returns `totalSalesByCurrency`:

```json
{
  "USD": "7109.95",
  "CAD": "830.00"
}
```

If every successful store uses one currency, the UI displays one Total sales summary. If multiple currencies are present, the UI displays one subtotal per currency. No FX conversion is introduced.

Money remains a decimal string in server and API contracts. Decimal-safe arithmetic is used for per-currency summaries; binary floating-point addition is not used for money totals.

If any selected store is unavailable, the summary is labeled partial and the UI states how many stores loaded. Failed or missing stores are not treated as zero.

## Redis Cache and Fill Lock

Each store and date range has one Redis String value containing the complete JSON report snapshot:

```text
shopify-product-sales:v1:{tenantId}:{storeId}:{from}:{to}
```

The successful snapshot is stored atomically with:

```text
SET <cacheKey> <json> EX 600
```

This is the Redis `SET` command for a String value, not the Redis Set collection type.

Cache rules:

- Cache only a successfully parsed ShopifyQL response, including a legitimate empty report.
- Do not cache authorization errors, GraphQL errors, ShopifyQL parse errors, malformed rows, timeouts, or partial responses.
- All shops reads and fills one cache entry per store. There is no All-shops aggregate cache key.
- A selected-shop request reuses the same per-store key previously filled by All shops, and vice versa.
- Redis failure degrades to a direct Shopify request. Cache availability must not determine report correctness.

To prevent duplicate fills, the loader attempts:

```text
SET <cacheKey>:lock <randomToken> NX PX 30000
```

The lock holder loads Shopify and fills the data key. A contender returns `loading` for that store; the dashboard polls the endpoint after one second until no store remains loading. Lock release compares the random token before deletion through Lua, matching the repository's existing token-safe Redis lock pattern. The lock TTL prevents a crashed request from holding the key forever.

Official Redis contracts: [`SET ... EX`](https://redis.io/docs/latest/commands/set/) and [distributed locks with `SET ... NX PX`](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/).

## Loading, Refresh, and Error States

The client starts a new request whenever `from`, `to`, or `selectedShopId` changes.

- Abort or ignore the previous request when filters change quickly.
- While the new request has no completed response, show a dedicated loading card instead of the old date range's table.
- Cache hits resolve through the same endpoint and replace the loading card immediately.
- If any store status is `loading`, keep the loading card and poll after one second.
- Stop polling when all stores are terminal, the filters change, or 30 seconds elapse.
- After 30 seconds, render successful rows plus a Retry action and identify stores that are still unavailable.
- If some stores fail, render successful rows with a partial-data warning.
- If every selected store fails, render an error state with store-specific reasons and Retry.
- A successful report with no rows renders `No Shopify product sales for this period`.

The UI must never replace a failed store with zero values or label a partial summary as complete.

## Component Boundaries

- `src/lib/shopify/client.ts` owns authenticated GraphQL transport and explicit API-version selection.
- `src/lib/shopify/product-sales.ts` owns ShopifyQL construction, response validation, row parsing, and per-store snapshots.
- `src/lib/shopify/product-sales-cache.ts` owns Redis keys, JSON cache values, the 600-second TTL, fill locks, and token-safe release.
- `src/lib/analytics/shopify-product-sales.ts` owns tenant-scoped shop mapping, bounded three-store concurrency, per-store cache-aside loading, row ordering, partial status, and currency summaries.
- The route owns authentication and request validation.
- `ShopifyProductSalesTable.tsx` owns loading, polling, error, summary, and responsive table presentation. It contains no ShopifyQL, Redis, decryption, or tenant-mapping rules.

All imports remain top-level static imports. No function-body dynamic imports are introduced.

## Verification

Focused verification must cover:

- `read_reports` is present in setup UI, docs, and OAuth requests.
- OAuth callback persists normalized granted scopes and currency.
- Existing stores with no persisted `read_reports` are shown as Reconnect required.
- ShopifyQL uses the selected inclusive dates, excludes Shipping Insurance, groups by product title, orders by Total sales, and requests totals.
- ShopifyQL GraphQL errors and parse errors are not cached.
- Null titles become `None` only in presentation, not a synthetic product merge key.
- Cache key format is exact and excludes timezone and product title.
- Successful values use `SET ... EX 600`.
- Fill locks use unique tokens with `NX PX 30000` and token-safe release.
- Redis failures fall back to direct Shopify reads.
- Selected shop performs one store load and hides the Store column.
- All shops preserves same-title rows from different stores and shows the Store column.
- Tenant isolation and Triple Whale domain-to-Store mapping.
- Maximum three concurrent store loads.
- Mixed currencies produce separate subtotals.
- Partial, loading, empty, timeout, Retry, and stale-filter abort behavior.
- Focused Vitest suites, Prisma validation/generation, Next.js build, and `git diff --check`.

A controlled live verification on one authorized store must compare the selected dates, summary, `None` row, top product rows, Net items sold, and Total sales against Shopify Admin Analytics before rollout to all stores.

## Out of Scope

- Merging equal product titles across stores.
- Recalculating Shopify sales from local orders or Triple Whale.
- Currency conversion.
- Product thumbnails or product-detail GraphQL lookups.
- Persisting product-sales snapshots in PostgreSQL.
- Background workers or scheduled prefetching.
- Comparison-period product tables.
- Replacing the existing `Orders by listing` panel.
- Changing the global default Shopify API version used by publishing.
- Deploying, reconnecting stores, or changing Shopify app configuration as part of document creation.
