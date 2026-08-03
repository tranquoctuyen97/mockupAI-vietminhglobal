# Unified Dashboard KPI Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Designs and Active Listings to the shop-filtered analytics KPI row and remove the duplicate Workspace Overview metric section.

**Architecture:** Extend the existing Triple Whale analytics repository and response with workspace counts. Resolve a selected Triple Whale credential to an internal Store through the tenant-scoped Shopify domain, then render all seven values from the single analytics response.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma, Vitest, Biome

## Global Constraints

- Do not stage, commit, create a branch, or push.
- Use top-level static imports only.
- All shops includes unassigned tenant designs and all ACTIVE tenant listings.
- A selected shop filters Designs and Active Listings by the matched internal Store id.
- An unmatched selected shop returns null counts and renders Store not linked.
- Keep `/api/dashboard/summary` unchanged.
- Keep Quick Start at the bottom of the dashboard.

---

### Task 1: Workspace counts in analytics response

**Files:**
- Modify: `src/lib/triple-whale/analytics.test.ts`
- Modify: `src/lib/triple-whale/analytics.ts`

**Interfaces:**
- Add `WorkspaceMetrics = { designs: number | null; activeListings: number | null; storeLinked: boolean }`.
- Add repository method `getWorkspaceMetrics(input: { tenantId: string; shopDomains: string[] | null }): Promise<WorkspaceMetrics>`.
- Add `workspace: WorkspaceMetrics` to `TripleWhaleAnalyticsResult`.

- [ ] **Step 1: Write failing service tests**

Extend the test repository with a configurable `getWorkspaceMetrics` implementation and add these assertions:

```ts
expect(allShops.workspace).toEqual({ designs: 125, activeListings: 3, storeLinked: true });
expect(selectedShop.workspace).toEqual({ designs: 20, activeListings: 2, storeLinked: true });
expect(unlinkedShop.workspace).toEqual({ designs: null, activeListings: null, storeLinked: false });
```

Also assert the repository receives `shopDomains: null` for all shops and `shopDomains: ["a.myshopify.com"]` for `shopIds: ["shop-a"]`.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/lib/triple-whale/analytics.test.ts
```

Expected: FAIL because the repository and result do not contain workspace metrics.

- [ ] **Step 3: Implement repository counting**

Add the method to `prismaTripleWhaleAnalyticsRepository`. For all shops, run tenant-wide counts. For selected domains, resolve every store:

```ts
const stores = await prisma.store.findMany({
  where: { tenantId, shopifyDomain: { in: shopDomains } },
  select: { id: true },
});
```

Return null counts when `stores.length !== shopDomains.length`. Otherwise count using `{ storeId: { in: stores.map((store) => store.id) } }` for selected domains:

```ts
await Promise.all([
  prisma.design.count({ where: { tenantId, deletedAt: null, ...(storeIds ? { storeId: { in: storeIds } } : {}) } }),
  prisma.listing.count({ where: { tenantId, status: "ACTIVE", ...(storeIds ? { storeId: { in: storeIds } } : {}) } }),
]);
```

- [ ] **Step 4: Add workspace metrics to service result**

Pass all selected domains while preserving `null` as the all-shops sentinel:

```ts
const workspace = await repository.getWorkspaceMetrics({
  tenantId: input.tenantId,
  shopDomains: input.shopIds.length ? selectedShops.map((shop) => shop.shopDomain) : null,
});
```

Return `workspace` beside `analytics` in `TripleWhaleAnalyticsResult`.

- [ ] **Step 5: Verify GREEN**

Run the focused analytics test and expect all tests to pass.

---

### Task 2: Seven-card KPI row

**Files:**
- Modify: `src/app/(authed)/dashboard/dashboard-analytics.test.tsx`
- Modify: `src/app/(authed)/dashboard/AnalyticsStatCard.tsx`
- Modify: `src/app/(authed)/dashboard/TripleWhaleDashboard.tsx`

**Interfaces:**
- Consume `data.workspace.designs`, `data.workspace.activeListings`, and `data.workspace.storeLinked`.
- Add optional `statusText?: string` to `AnalyticsStatCard` for workspace cards without comparison metrics.

- [ ] **Step 1: Write failing rendering tests**

Add a card test that renders `current: null` with `statusText="Store not linked"` and asserts `—`, `Store not linked`, and absence of `$0`. Extend the dashboard markup test to assert Designs and Active Listings occur before Quick Start and that the skeleton has seven card placeholders.

- [ ] **Step 2: Verify RED**

Run the dashboard component test. Expected: FAIL because workspace cards are still rendered in the legacy section and `AnalyticsStatCard` has no workspace state.

- [ ] **Step 3: Support non-comparison workspace cards**

Add `statusText?: string` and `showTrend?: boolean` to `AnalyticsStatCard`. When `showTrend={false}`, render the number plus `statusText` and omit delta/sparkline markup.

- [ ] **Step 4: Render seven cards**

Keep the existing five metric definitions and append two workspace cards. Render the grid as:

```tsx
className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 gap-3"
```

Pass Designs and Active Listings with `currency={false}`, `showTrend={false}`, and `statusText={!data.workspace.storeLinked ? "Store not linked" : undefined}`. Use null values for unlinked stores and zero values for linked stores with no records.

- [ ] **Step 5: Expand skeleton to seven cards and verify GREEN**

Add the two workspace definitions to the skeleton source and run dashboard tests until green.

---

### Task 3: Remove legacy summary rendering

**Files:**
- Modify: `src/app/(authed)/dashboard/page.tsx`
- Modify: `src/app/(authed)/dashboard/DashboardClient.tsx`
- Modify: `src/app/(authed)/dashboard/dashboard-analytics.test.tsx`

**Interfaces:**
- `DashboardClient({ twTimezone }: { twTimezone: string })` no longer accepts `summary`.
- `DashboardPage` fetches only tenant timezone for dashboard rendering.

- [ ] **Step 1: Write failing structure assertions**

Update the DashboardClient test invocation to pass only `twTimezone`. Assert the markup does not contain `Workspace Overview`, while `Quick start`, `/stores`, `/designs`, and `/wizard` remain.

- [ ] **Step 2: Verify RED**

Run the dashboard test. Expected: TypeScript/render failure until the legacy summary contract is removed.

- [ ] **Step 3: Remove legacy server fetch and metric section**

Remove `getDashboardSummary` from `page.tsx` and load only the tenant timezone. Remove the Summary interface, metric array, Workspace Overview heading, and four legacy cards from `DashboardClient.tsx`. Preserve the Quick Start card after `TripleWhaleDashboard`.

- [ ] **Step 4: Run focused verification**

```bash
pnpm exec biome check --write src/lib/triple-whale/analytics.ts src/lib/triple-whale/analytics.test.ts src/app/'(authed)'/dashboard/AnalyticsStatCard.tsx src/app/'(authed)'/dashboard/TripleWhaleDashboard.tsx src/app/'(authed)'/dashboard/DashboardClient.tsx src/app/'(authed)'/dashboard/page.tsx src/app/'(authed)'/dashboard/dashboard-analytics.test.tsx
pnpm exec vitest run --exclude '.next/**' src/lib/triple-whale/analytics.test.ts src/app/'(authed)'/dashboard/dashboard-analytics.test.tsx src/lib/triple-whale/date-ranges.test.ts
git diff --check
pnpm run build
```

Expected: focused tests, Biome, diff check, and production build pass. Existing unrelated full-suite baseline failures are reported separately.

- [ ] **Step 5: Preserve working tree**

Run `git status --short` and leave all files unstaged and uncommitted.
