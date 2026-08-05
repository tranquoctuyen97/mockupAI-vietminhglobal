# Unified Dashboard KPI Row Design

## Goal

Move Designs and Active Listings out of the separate Workspace Overview section and into the primary analytics KPI row. All seven KPI cards must respond to the existing Triple Whale shop selector.

## KPI Layout

The primary KPI row contains, in order:

1. Order Revenue
2. Ads
3. Total Cost
4. Net Profit
5. Orders
6. Designs
7. Active Listings

Desktop uses seven equal columns when space permits. Smaller breakpoints progressively use fewer columns without horizontal page scrolling. Designs and Active Listings use the same dimensions, typography, loading treatment, and card styling as the five analytics metrics.

The separate Workspace Overview heading and metric grid are removed. The existing Quick Start card remains at the bottom of the dashboard.

## Shop Filtering

The existing single-value shop selector remains the only shop filter.

- `All shops`: Designs counts every non-deleted tenant design, including designs with no store assignment. Active Listings counts every tenant listing with status `ACTIVE`.
- One Triple Whale shop: the server maps `TripleWhaleCredential.shopDomain` to `Store.shopifyDomain` within the same tenant. Designs and Active Listings are filtered by the matched internal `Store.id`.
- No internal Store match: both workspace KPI values are `null`. The cards render `—` and `Store not linked`; they must not render a misleading zero.

The five Triple Whale KPIs retain their existing filtering behavior.

## Data Contract

The analytics response adds:

```ts
workspace: {
  designs: number | null;
  activeListings: number | null;
  storeLinked: boolean;
}
```

The analytics repository gains a workspace-count operation that receives the tenant id and either `null` for all shops or an array of selected Triple Whale shop domains. The current UI sends at most one shop, while the server contract continues supporting an array. Every selected domain must resolve to a tenant-owned internal store before counting; otherwise the workspace metrics are returned as unlinked.

No additional client request is introduced. The seven cards update from the same analytics response, preventing mismatched filters or loading states.

## Server Rendering Boundary

`DashboardPage` no longer fetches the legacy dashboard summary solely for Workspace Overview. `DashboardClient` no longer receives a `summary` prop. It remains a Server Component that renders the interactive Triple Whale dashboard and the static Quick Start block.

The existing `/api/dashboard/summary` route is left intact because other callers may use it; this feature does not delete or change that API.

## States

- Initial analytics loading: skeleton includes seven cards.
- Analytics refresh: existing data stays visible.
- Selected shop without internal store mapping: Designs and Active Listings show `—` with `Store not linked`.
- Valid mapping with no records: cards show `0`.
- Analytics error and historical-data sync behavior remain unchanged.

## Testing

- Analytics service tests verify tenant totals, selected-store totals, and unmatched-domain null values.
- API/result type tests cover the new workspace contract.
- Dashboard component tests verify seven KPI cards render before Quick Start.
- UI tests verify linked zero and unlinked null are visually distinct.
- Existing analytics, date-range, request-gate, and dashboard tests remain green.
