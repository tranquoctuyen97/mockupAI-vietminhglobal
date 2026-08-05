# Triple Whale Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one analytics-first dashboard with Triple Whale KPIs, comparison periods, shop filtering, charts, and rate-limit-aware background backfill while retaining the existing Overview content at the bottom.

**Architecture:** The dashboard reads one tenant-scoped analytics API backed by local daily statistics. Pure date and aggregation modules calculate comparison ranges, data completeness, KPI deltas, and chart payloads; missing ranges enqueue deduplicated BullMQ jobs that call Triple Whale through a shared Redis cooldown gate. Client components render typed view models and poll only while a background job is active.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma/PostgreSQL, BullMQ/Redis/ioredis, date-fns/date-fns-tz, Recharts, Vitest, Biome.

## Global Constraints

- Do not commit, stage, push, or rewrite git history unless the user explicitly asks in a later message.
- Preserve all unrelated dirty-worktree files.
- Use top-level static imports; dynamic imports are forbidden except the explicit Next.js/code-splitting exceptions in `AGENTS.md`.
- Read the relevant local Next.js guide under `node_modules/next/dist/docs/` before editing route or client-component code.
- Dates are inclusive `YYYY-MM-DD` values interpreted in the tenant's `twTimezone`.
- The UI supports one selected shop, but every server interface uses `shopIds: string[]`.
- Missing days are never converted to zero or included in apparently complete deltas.
- Dashboard reads never wait for a live Triple Whale request.
- API keys must never be logged or returned.

---

## File Map

- Create `src/lib/triple-whale/date-ranges.ts`: display/comparison range arithmetic.
- Create `src/lib/triple-whale/date-ranges.test.ts`: timezone and calendar edge cases.
- Create `src/lib/triple-whale/analytics.ts`: tenant-scoped coverage, aggregation, deltas, and response view model.
- Create `src/lib/triple-whale/analytics.test.ts`: aggregation and completeness tests with an injected repository.
- Create `src/lib/triple-whale/backfill.ts`: missing-range compaction, chunking, deterministic job IDs, enqueue/reuse behavior.
- Create `src/lib/triple-whale/backfill.test.ts`: chunking and dedup tests.
- Create `src/lib/triple-whale/request-gate.ts`: Redis cooldown shared by Triple Whale workers.
- Create `src/lib/triple-whale/request-gate.test.ts`: cooldown behavior.
- Modify `src/lib/triple-whale/client.ts`: header parsing and typed rate-limit errors.
- Create `src/lib/triple-whale/client.test.ts`: request shape and header parsing.
- Modify `src/lib/triple-whale/types.ts`: analytics, job, and client metadata types.
- Modify `src/lib/triple-whale/sync.ts`: explicit range sync reusable by scheduled and historical jobs.
- Modify `src/lib/triple-whale/queue.ts`: backfill jobs and deterministic IDs.
- Modify `src/lib/jobs/workers/triple-whale-sync-worker.ts`: backfill execution and delayed retry state.
- Create `src/app/api/triple-whale/analytics/route.ts`: consolidated analytics endpoint.
- Create `src/app/api/triple-whale/analytics/route.test.ts`: validation and tenant-isolation source/behavior tests.
- Create `src/app/api/triple-whale/sync-status/route.ts`: status polling endpoint.
- Create `src/app/(authed)/dashboard/DashboardFilters.tsx`: date, comparison, and shop controls.
- Create `src/app/(authed)/dashboard/AnalyticsStatCard.tsx`: KPI, delta, and sparkline.
- Create `src/app/(authed)/dashboard/AnalyticsCharts.tsx`: distribution and trend charts.
- Create `src/app/(authed)/dashboard/SyncStatusBanner.tsx`: partial/sync/rate-limit/failure states.
- Rewrite `src/app/(authed)/dashboard/TripleWhaleDashboard.tsx`: analytics orchestration and details.
- Modify `src/app/(authed)/dashboard/DashboardClient.tsx`: remove tabs and move Overview content below analytics.
- Create `src/app/(authed)/dashboard/dashboard-analytics.test.tsx`: component behavior.

---

### Task 1: Date and Comparison Range Contract

**Files:**
- Create: `src/lib/triple-whale/date-ranges.ts`
- Test: `src/lib/triple-whale/date-ranges.test.ts`

**Interfaces:**
- Produces: `DateRange`, `ComparisonMode`, `inclusiveDayCount(range)`, `comparisonRange(range, mode)`, and `presetRange(preset, timezone, now?)`.

- [ ] **Step 1: Write failing tests for inclusive ranges and presets**

```ts
import { describe, expect, it } from "vitest";
import { comparisonRange, inclusiveDayCount, presetRange } from "./date-ranges";

describe("Triple Whale date ranges", () => {
  it("uses the immediately preceding equal-length period", () => {
    expect(comparisonRange({ from: "2026-08-01", to: "2026-08-07" }, "previous_period"))
      .toEqual({ from: "2026-07-25", to: "2026-07-31" });
    expect(inclusiveDayCount({ from: "2026-08-01", to: "2026-08-07" })).toBe(7);
  });

  it("clamps month and year shifts to valid calendar dates", () => {
    expect(comparisonRange({ from: "2026-03-31", to: "2026-03-31" }, "previous_month"))
      .toEqual({ from: "2026-02-28", to: "2026-02-28" });
    expect(comparisonRange({ from: "2024-02-29", to: "2024-02-29" }, "previous_year"))
      .toEqual({ from: "2023-02-28", to: "2023-02-28" });
  });

  it("builds Today in the tenant timezone", () => {
    const now = new Date("2026-08-01T05:30:00.000Z");
    expect(presetRange("today", "America/Los_Angeles", now))
      .toEqual({ from: "2026-07-31", to: "2026-07-31" });
  });
});
```

- [ ] **Step 2: Run the test and verify missing-module failure**

Run: `pnpm exec vitest run src/lib/triple-whale/date-ranges.test.ts`

Expected: FAIL because `date-ranges.ts` does not exist.

- [ ] **Step 3: Implement pure UTC-calendar arithmetic**

Define exact unions for presets and comparison modes. Parse date-only strings into UTC calendar values, validate `from <= to`, shift calendar fields without local-machine timezone arithmetic, and format back to `YYYY-MM-DD`. `none` returns `null`.

- [ ] **Step 4: Add cases for Previous week, quarter, None, 14D, 90D, and This Month**

Assert exact boundaries and an invalid-range error message: `Invalid date range: from must be on or before to`.

- [ ] **Step 5: Run focused tests**

Run: `pnpm exec vitest run src/lib/triple-whale/date-ranges.test.ts`

Expected: PASS.

---

### Task 2: Analytics Aggregation and Coverage Detection

**Files:**
- Create: `src/lib/triple-whale/analytics.ts`
- Test: `src/lib/triple-whale/analytics.test.ts`
- Modify: `src/lib/triple-whale/types.ts`

**Interfaces:**
- Consumes: `DateRange`, `ComparisonMode`, and `comparisonRange()` from Task 1.
- Produces: `getTripleWhaleAnalytics(input, repository)`, `AnalyticsResponse`, `MetricSummary`, `MissingRange`, and `DailyMetricPoint`.

- [ ] **Step 1: Define test fixtures and failing aggregate tests**

Use two shops and three dates. Assert current totals, previous totals, per-shop distribution, daily series, and `percentChange`.

```ts
expect(result.analytics.metrics.orderRevenue).toMatchObject({
  current: 300,
  previous: 200,
  absoluteChange: 100,
  percentChange: 50,
  direction: "up",
});
expect(result.analytics.distribution.orderRevenue).toEqual([
  { shopId: "shop-a", label: "A", value: 120 },
  { shopId: "shop-b", label: "B", value: 180 },
]);
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec vitest run src/lib/triple-whale/analytics.test.ts`

Expected: FAIL because the analytics module is missing.

- [ ] **Step 3: Implement an injected repository boundary**

```ts
export interface TripleWhaleAnalyticsRepository {
  listTenantShops(tenantId: string): Promise<Array<{ id: string; customName: string; shopDomain: string }>>;
  listDailyStats(input: { tenantId: string; shopIds: string[]; from: string; to: string; timezone: string }): Promise<AnalyticsDailyRow[]>;
}
```

Create a Prisma implementation in the same module. Reject any requested shop not owned by the tenant with `Unknown Triple Whale shop`.

- [ ] **Step 4: Implement completeness without zero filling**

Build expected `(shopId, date)` pairs for current and comparison ranges. Compact absent consecutive dates into `MissingRange[]`. Set `dataStatus` to `complete` only when no expected pair is absent. Omit incomplete KPI deltas and attach `complete: false` instead of summing missing days as zero.

- [ ] **Step 5: Test zero, negative, None, and missing previous data**

Assert previous zero yields `percentChange: null`; comparison None yields `comparisonRange: null`; missing prior rows yields `complete: false` and `previous: null`.

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run src/lib/triple-whale/analytics.test.ts src/lib/triple-whale/date-ranges.test.ts`

Expected: PASS.

---

### Task 3: Rate-Limit Metadata and Shared Request Gate

**Files:**
- Create: `src/lib/triple-whale/request-gate.ts`
- Test: `src/lib/triple-whale/request-gate.test.ts`
- Modify: `src/lib/triple-whale/client.ts`
- Create: `src/lib/triple-whale/client.test.ts`
- Modify: `src/lib/triple-whale/types.ts`

**Interfaces:**
- Produces: `parseRetryAfterMs(value, now?)`, `parseTripleWhaleRateLimitHeaders(headers)`, `TripleWhaleRequestGate.beforeRequest()`, `TripleWhaleRequestGate.afterResponse(metadata)`, `TWRateLimitError.retryAfterMs`, and `TWCooldownActiveError.retryAt`.

- [ ] **Step 1: Write failing Retry-After parser tests**

```ts
expect(parseRetryAfterMs("120", new Date("2026-08-01T00:00:00Z"))).toBe(120_000);
expect(parseRetryAfterMs("Sat, 01 Aug 2026 00:02:00 GMT", new Date("2026-08-01T00:00:00Z"))).toBe(120_000);
expect(parseRetryAfterMs("invalid", new Date())).toBeNull();
```

- [ ] **Step 2: Write failing fetch tests**

Mock `fetch`. Assert the body contains `period.start/end`, a 429 error preserves `Retry-After`, and 200 responses pass `RateLimit-Policy` and `RateLimit` metadata to the gate hook.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm exec vitest run src/lib/triple-whale/client.test.ts src/lib/triple-whale/request-gate.test.ts`

Expected: FAIL on missing exports and metadata.

- [ ] **Step 4: Implement header parsing and typed errors**

Extend `fetchSummaryData` with an optional injected request gate. Keep its existing POST payload unchanged. Parse headers before status branching. Throw `TWRateLimitError` with `retryAfterMs`, policy, limit, requested shop, and requested range; do not include the API key.

- [ ] **Step 5: Implement the Redis cooldown gate**

Follow the existing `PrintifyRequestGate` ownership/injection pattern. Use a global Triple Whale cooldown key, honor positive `PTTL`, and set cooldown after a 429 using upstream delay plus bounded jitter. If Redis is unavailable, log a warning and allow the request; do not mask the upstream error.

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run src/lib/triple-whale/client.test.ts src/lib/triple-whale/request-gate.test.ts`

Expected: PASS.

---

### Task 4: Explicit-Range Backfill Queue and Worker

**Files:**
- Create: `src/lib/triple-whale/backfill.ts`
- Test: `src/lib/triple-whale/backfill.test.ts`
- Modify: `src/lib/triple-whale/sync.ts`
- Modify: `src/lib/triple-whale/queue.ts`
- Modify: `src/lib/jobs/workers/triple-whale-sync-worker.ts`
- Modify: `src/lib/triple-whale/types.ts`

**Interfaces:**
- Consumes: `MissingRange`, `fetchSummaryData`, `TWRateLimitError`, and `TWCooldownActiveError`.
- Produces: `syncStoreRange({ credentialId, from, to })`, `enqueueMissingTripleWhaleRanges(input)`, deterministic `tripleWhaleBackfillJobId()`, and `getBackfillJobSummaries(jobIds)`.

- [ ] **Step 1: Write failing chunk and deterministic-ID tests**

```ts
expect(chunkDateRange({ from: "2026-01-01", to: "2026-03-15" }, 31)).toEqual([
  { from: "2026-01-01", to: "2026-01-31" },
  { from: "2026-02-01", to: "2026-03-03" },
  { from: "2026-03-04", to: "2026-03-15" },
]);
expect(tripleWhaleBackfillJobId("tenant", "shop", "2026-01-01", "2026-01-31"))
  .toBe("tw-backfill-tenant-shop-2026-01-01-2026-01-31");
```

- [ ] **Step 2: Write a failing enqueue reuse test**

Inject a fake Queue where `getJob(jobId)` returns an existing nonterminal job. Assert `queue.add` is not called and the existing job summary is returned.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm exec vitest run src/lib/triple-whale/backfill.test.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 4: Extract explicit range sync**

Implement `syncStoreRange` using top-level static imports. Scheduled `syncStore` computes its existing cursor and delegates to it. Historical sync must not update `lastSyncedAt`; scheduled sync updates it only after success.

- [ ] **Step 5: Add backfill queue jobs**

Use 31-day chunks, deterministic job IDs, and sequential child chunks per credential. Job data includes tenantId, credentialId, from, to, and kind. Preserve the existing recurring dispatcher behavior.

- [ ] **Step 6: Handle cooldown and 429 without rapid retry**

When the worker receives a typed cooldown/rate-limit error, move the job to a delayed retry based on `retryAt` or `retryAfterMs` and expose `rate_limited` in job progress data. Other retryable errors retain bounded exponential retry; auth errors remain terminal.

- [ ] **Step 7: Run Triple Whale queue tests**

Run: `pnpm exec vitest run src/lib/triple-whale/backfill.test.ts tests/triple-whale-daily-sync-source.test.ts tests/triple-whale-recurring-sync-source.test.ts tests/triple-whale-sync-schedule-source.test.ts`

Expected: PASS.

---

### Task 5: Consolidated Analytics and Sync-Status APIs

**Files:**
- Create: `src/app/api/triple-whale/analytics/route.ts`
- Test: `src/app/api/triple-whale/analytics/route.test.ts`
- Create: `src/app/api/triple-whale/sync-status/route.ts`

**Interfaces:**
- Consumes: `getTripleWhaleAnalytics`, `enqueueMissingTripleWhaleRanges`, and `getBackfillJobSummaries`.
- Produces: GET `/api/triple-whale/analytics` and GET `/api/triple-whale/sync-status`.

- [ ] **Step 1: Read local Next.js route-handler documentation**

Run: `rg -n "Route Handlers|NextRequest|searchParams" node_modules/next/dist/docs/ | head -30`

Read the matching guide fully before editing route code.

- [ ] **Step 2: Write failing route validation tests**

Cover missing dates, invalid comparison, inverted range, more than 366 selected days, and shop IDs outside the tenant. Assert status 400 for malformed input and 403/404 according to the existing auth guard contract.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm exec vitest run src/app/api/triple-whale/analytics/route.test.ts`

Expected: FAIL because the route is missing.

- [ ] **Step 4: Implement GET analytics flow**

Parse repeated `shopId` parameters into an array. Load tenant timezone, calculate comparison, aggregate local data, enqueue missing ranges, attach returned job summaries, and return `syncing` when any new or reused job is active. Never await job completion.

- [ ] **Step 5: Implement sync-status flow**

Accept repeated job IDs, verify every job belongs to the authenticated tenant, and map BullMQ states to `queued | syncing | rate_limited | complete | failed`. Do not expose raw job payloads or credentials.

- [ ] **Step 6: Run API and aggregation tests**

Run: `pnpm exec vitest run src/app/api/triple-whale/analytics/route.test.ts src/lib/triple-whale/analytics.test.ts src/lib/triple-whale/backfill.test.ts`

Expected: PASS.

---

### Task 6: Dashboard Filters, KPI Cards, and Charts

**Files:**
- Create: `src/app/(authed)/dashboard/DashboardFilters.tsx`
- Create: `src/app/(authed)/dashboard/AnalyticsStatCard.tsx`
- Create: `src/app/(authed)/dashboard/AnalyticsCharts.tsx`
- Create: `src/app/(authed)/dashboard/SyncStatusBanner.tsx`
- Create: `src/app/(authed)/dashboard/dashboard-analytics.test.tsx`

**Interfaces:**
- Consumes: `AnalyticsResponse`, display presets, comparison modes, and shop summaries.
- Produces: controlled filter callbacks, accessible KPI cards, All-shops distribution charts, selected-shop trend charts, and sync banners.

- [ ] **Step 1: Read local Next.js client-component documentation**

Run: `rg -n "Client Components|use client" node_modules/next/dist/docs/ | head -30`

Read the relevant guide fully. Preserve the existing explicit Recharts code-splitting exception through `next/dynamic` or the existing chart wrapper; use static imports elsewhere.

- [ ] **Step 2: Write failing component tests**

Assert all presets and comparison options render, shop selection emits an array, each KPI exposes value/direction/comparison text, previous zero never displays `Infinity`, partial status says data is syncing, and selected-shop mode renders trend charts instead of distribution charts.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm exec vitest run 'src/app/(authed)/dashboard/dashboard-analytics.test.tsx'`

Expected: FAIL because components are missing.

- [ ] **Step 4: Implement accessible controlled filters**

Use buttons/selects with labels and keyboard focus. Custom dates are applied only when both values are valid. Default to Today, Previous period, and All shops. On mobile, controls wrap without fixed modal dimensions.

- [ ] **Step 5: Implement KPI cards and sparklines**

Use semantic positive/negative colors, localized currency/count formatting, and SVG/Recharts mini lines. A one-day period renders the two-point previous-to-current comparison. Incomplete metrics render `Syncing` without fabricated values.

- [ ] **Step 6: Implement analytics chart switching**

All shops renders five distribution panels with a stable shop-color map. One shop renders five daily trend panels. Provide empty and incomplete states and horizontally scrollable legends where needed.

- [ ] **Step 7: Implement sync banner states**

Render specific copy for queued, syncing, waiting for quota, partial, failed, and complete. Failure includes a Retry callback. Use an `aria-live="polite"` region.

- [ ] **Step 8: Run component tests**

Run: `pnpm exec vitest run 'src/app/(authed)/dashboard/dashboard-analytics.test.tsx'`

Expected: PASS.

---

### Task 7: Unified Dashboard Orchestration

**Files:**
- Rewrite: `src/app/(authed)/dashboard/TripleWhaleDashboard.tsx`
- Modify: `src/app/(authed)/dashboard/DashboardClient.tsx`
- Modify: `src/app/(authed)/dashboard/page.tsx`
- Modify: `src/app/(authed)/dashboard/dashboard-analytics.test.tsx`

**Interfaces:**
- Consumes: Task 5 APIs and Task 6 components.
- Produces: one tab-free dashboard with analytics first and legacy Overview content last.

- [ ] **Step 1: Extend failing tests for page order and tab removal**

Assert source/rendered output contains no Overview/Triple Whale tab state, analytics appears before Designs, and quick-start links still point to `/stores`, `/designs`, and `/wizard`.

- [ ] **Step 2: Run and verify the tests fail against current tabs**

Run: `pnpm exec vitest run 'src/app/(authed)/dashboard/dashboard-analytics.test.tsx'`

Expected: FAIL because `DashboardClient` still renders tabs.

- [ ] **Step 3: Implement abortable analytics loading**

Use `AbortController` per filter request. Preserve the last successful response during refresh, ignore abort errors, surface real errors, and never replace known values with zero.

- [ ] **Step 4: Implement bounded polling**

Poll `/api/triple-whale/sync-status` only while any job is queued, syncing, or rate limited. Stop on unmount/filter change. When all jobs complete, reload analytics exactly once and show a completion toast. On failure, stop polling and preserve partial data.

- [ ] **Step 5: Remove tabs and move legacy content**

Render `TripleWhaleDashboard` directly below the page heading. Extract or retain the four legacy cards and quick-start block after analytics details. Keep existing links and summary props.

- [ ] **Step 6: Add responsive layout checks**

Verify one/two-column KPI behavior, stacked charts, viewport-safe dropdowns, and horizontal table scrolling at representative widths.

- [ ] **Step 7: Run dashboard and existing Triple Whale UI tests**

Run: `pnpm exec vitest run 'src/app/(authed)/dashboard/dashboard-analytics.test.tsx' tests/triple-whale-ui-source.test.ts`

Expected: PASS.

---

### Task 8: Regression and Production Verification

**Files:**
- Modify only files required by failures attributable to this feature.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified build-ready dashboard implementation.

- [ ] **Step 1: Run the complete focused Triple Whale suite**

Run: `pnpm exec vitest run src/lib/triple-whale/*.test.ts 'src/app/(authed)/dashboard/dashboard-analytics.test.tsx' src/app/api/triple-whale/analytics/route.test.ts tests/triple-whale-*.test.ts`

Expected: PASS.

- [ ] **Step 2: Run Biome only on changed source files**

Run: `git diff --name-only --diff-filter=ACMR -- 'src/**/*.ts' 'src/**/*.tsx' | xargs -r pnpm exec biome check`

Expected: no errors. Do not run the repository `lint` script because it fetches from the network and evaluates unrelated branch changes.

- [ ] **Step 3: Validate Prisma only if schema changed during an approved deviation**

Run: `pnpm db:generate`

Expected: Prisma client generation succeeds. This planned implementation does not require a schema migration.

- [ ] **Step 4: Run the production build**

Run: `pnpm run build`

Expected: Next.js build and standalone asset copy complete successfully.

- [ ] **Step 5: Check patch hygiene and worktree scope**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only planned dashboard/Triple Whale files plus the user's pre-existing unrelated files are present. Do not stage or commit anything.

- [ ] **Step 6: Manually verify primary flows**

Verify All shops and one shop, Today versus Yesterday, custom range versus Previous period, comparison None, old missing range entering background sync, 429 entering waiting-for-quota state, completion refresh, failure Retry, and mobile layout. Record exact evidence and any environment limitations in the handoff.
