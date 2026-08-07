# Triple Whale Analytics Dashboard Design

**Date:** 2026-08-01
**Status:** Approved

## Goal

Replace the separate Overview and Triple Whale tabs with one analytics-first dashboard. Triple Whale analytics is the primary content. The existing MockupAI overview cards and quick-start actions remain available at the bottom of the page.

The dashboard must show the selected period, compare it with a configurable comparison period, explain increases and decreases, and fetch missing historical Triple Whale data in the background without blocking the page.

## Page Structure

The dashboard renders these sections in order:

1. Page heading and analytics filters.
2. Background sync or partial-data status banner when applicable.
3. Five primary KPI cards: Order Revenue, Ads, Total Cost, Net Profit, and Orders.
4. Five analytics charts: Revenue, Orders, Ads, Cost, and Profit.
5. Per-shop summary table.
6. Expandable daily breakdown.
7. Existing Overview cards: Designs, Active Listings, Orders today, and Revenue today.
8. Existing quick-start actions.

The Overview and Triple Whale tabs are removed.

## Filters

### Display period

The period control supports Today, Yesterday, Last 7 Days, Last 14 Days, Last 30 Days, Last 90 Days, This Month, and a custom inclusive date range.

The user chooses only the period to display. The server calculates the comparison range in the tenant's Triple Whale timezone.

### Comparison period

The comparison control supports:

- None
- Previous period
- Previous week
- Previous month
- Previous quarter
- Previous year

Previous period is the default. It is the immediately preceding inclusive range with the same number of calendar days as the display period. Previous week shifts both selected boundaries back seven days. Previous month, quarter, and year shift each boundary back one month, three months, or one year respectively, clamping invalid end-of-month dates to the final valid day.

Examples for Previous period:

- August 1 compares with July 31.
- August 1 through August 7 compares with July 25 through July 31.
- This Month through the current day compares with the immediately preceding range of equal length.

### Shop selection

The default is All shops. The UI allows either All shops or one selected shop. The server and request contract accept `shopIds: string[]` so a later multi-select UI does not require an API redesign.

All shop IDs are validated against the authenticated tenant.

## KPI Cards and Comparison Semantics

Each KPI card displays:

- Current-period value.
- Small current-period sparkline.
- Increase, decrease, or unchanged direction.
- Absolute change.
- Percentage change when mathematically meaningful.
- The comparison label and range.

When the previous value is zero, the UI must not show an infinite percentage. It shows the absolute change and either `New activity` or `No prior data`, depending on data completeness. Missing comparison data is never treated as zero.

The database stores daily Triple Whale statistics. For a one-day display period, there is no hourly series. The mini visualization therefore compares the previous and current daily values as two points and does not invent intraday observations.

## Charts

### 2026-08-07 clarification: Lark-style shop distribution

When All shops is selected, the five distribution panels must render Lark-style pie charts, not horizontal comparison bars. The panel labels are `Order revenue %`, `Order %`, `Ads`, `Cost %`, and `Net profit %`. Every pie uses the same deterministic shop-to-color mapping, and every panel exposes a shop legend, the signed metric value, and that shop's percentage of the displayed pie.

For metrics whose values are all non-negative, a slice percentage is `value / sum(values)`. Net profit may contain negative values, which a pie cannot represent as signed area. In that case, slice geometry and percentage use `abs(value) / sum(abs(values))`, while the label, tooltip, and legend retain the signed currency value and the panel explains that percentages represent absolute profit/loss magnitude. Zero-value shops remain in the legend at `0%` but do not create a visible slice. If every value is zero, the panel renders an explicit no-non-zero-data state instead of an empty chart.

The chart must remain usable on narrow screens: the pie stays inside its card, the legend may scroll horizontally, and external callout labels may be suppressed on small viewports as long as the same value and percentage remain available in the legend and tooltip.

When one shop is selected, distribution has no useful meaning. The five chart panels switch to daily trend charts for that shop.

The per-shop summary and daily breakdown remain available beneath the charts for drill-down.

## Analytics API

A consolidated authenticated analytics endpoint accepts:

```ts
type AnalyticsRequest = {
  from: string;
  to: string;
  comparison:
    | "none"
    | "previous_period"
    | "previous_week"
    | "previous_month"
    | "previous_quarter"
    | "previous_year";
  shopIds: string[];
};
```

Dates use `YYYY-MM-DD` and are inclusive. The server applies the tenant's `twTimezone` to database boundaries and all calendar arithmetic.

One response contains current totals, comparison totals, calculated deltas, daily series, per-shop distributions, data-completeness metadata, and active sync jobs. Current and comparison values must come from the same request so cards and charts cannot drift.

```ts
type AnalyticsResponse = {
  dataStatus: "complete" | "partial" | "syncing" | "failed";
  timezone: string;
  currentRange: { from: string; to: string };
  comparisonRange: { from: string; to: string } | null;
  missingRanges: MissingRange[];
  syncJobs: SyncJobSummary[];
  analytics: AnalyticsPayload;
};
```

The endpoint queries the local database. Changing dashboard filters never waits for a live Triple Whale request.

## Historical Data and Background Sync

Users may select old dates. The dashboard first checks local daily-stat coverage for every selected shop across both the current and comparison ranges.

When coverage is complete, analytics is returned immediately and no sync job is created.

When coverage is incomplete:

1. Return the data that is safely available with `partial` or `syncing` status.
2. Identify exact missing ranges per shop.
3. Enqueue background jobs for only those ranges.
4. Reuse an existing job for the same tenant, shop, and range instead of enqueueing duplicates.
5. Display a non-blocking banner explaining which dates are syncing.
6. Poll job status while a job is queued, syncing, or rate limited.
7. Reload analytics once after completion and stop polling.

Metrics and deltas that require incomplete dates are marked Syncing. Missing dates are not filled with zero and are not included in apparently complete totals.

Long backfills are split into bounded date chunks and processed sequentially per credential. Different shops may be scheduled independently, subject to the shared request gate.

## Triple Whale Request Contract

The existing live sync calls `POST https://api.triplewhale.com/api/v2/summary-page/get-data` with:

```json
{
  "shopDomain": "example.myshopify.com",
  "period": {
    "start": "YYYY-MM-DD",
    "end": "YYYY-MM-DD"
  },
  "todayHour": 10
}
```

Initial scheduled sync starts at the credential's `syncFromDate`. Recurring sync starts at the calendar date of `lastSyncedAt` and ends today, intentionally refreshing the latest partial day.

Background historical jobs use their explicit missing-range boundaries rather than changing the credential's normal scheduled-sync cursor.

## Rate-Limit Handling

The current client recognizes HTTP 429 but discards rate-limit headers. The implementation must add adaptive handling:

- Parse `Retry-After` as either delta-seconds or an HTTP date.
- Inspect `RateLimit-Policy` and `RateLimit` on successful and unsuccessful responses.
- Preserve parsed retry and quota metadata on the Triple Whale error type.
- Coordinate requests through a shared gate so multiple shop workers do not continue calling while the upstream quota is exhausted.
- On 429, delay the job according to `Retry-After` plus bounded jitter.
- Use exponential backoff only when the upstream retry value is absent or invalid.
- Expose `rate_limited` as a normal waiting state to the dashboard rather than immediately reporting failure.
- Log shop, requested range, status, quota metadata, and retry timing without logging API keys.

After the configured final attempt, the job becomes failed. The dashboard retains available data, explains the failure, and offers Retry.

## UI State and Error Handling

The page preserves the last successful analytics response while a new filter request is loading. Stale responses are aborted or ignored when filters change quickly.

The status banner distinguishes queued, syncing, waiting for quota, complete, partial, and failed states. It never blocks navigation or interaction.

An API or sync failure must not replace known values with zero. A failed background job leaves existing data visible and provides a retry action.

The Sync All button remains available. It uses the existing queued sync path and shows enqueue success or failure without blocking the dashboard.

## Responsive Behavior

On narrow screens, filters wrap into separate rows, KPI cards use one or two columns, chart panels stack vertically, and tables scroll horizontally. Dropdowns remain inside the viewport. The design follows the existing MockupAI visual language rather than copying Triple Whale's mobile modal.

## Component Boundaries

- Date-range utilities own inclusive range calculation and comparison shifting.
- Analytics query code owns tenant-scoped coverage checks, aggregates, series, and distribution payloads.
- Backfill orchestration owns missing-range compaction, job deduplication, chunking, and status.
- The Triple Whale client owns request formatting and upstream header parsing.
- The shared request gate owns rate-limit coordination.
- Dashboard filter, KPI, chart, sync banner, and detail components consume typed view models and contain no database rules.

These boundaries allow range arithmetic and upstream behavior to be tested without rendering the dashboard.

## Verification

Required focused coverage includes:

- Inclusive comparison ranges, month-end clamping, leap years, and tenant timezones.
- Tenant isolation and validation of every `shopIds` entry.
- Delta behavior for positive, negative, zero, and missing previous values.
- `None` comparison behavior.
- Daily series and per-shop distribution aggregation.
- Missing-range detection and duplicate-job prevention.
- Retry-After parsing for delta-seconds and HTTP dates.
- Rate-limit state transitions and absence of rapid retries after 429.
- Removal of dashboard tabs while retaining Overview and quick-start content at the bottom.
- Filter, loading, partial, rate-limited, failed, delta, and sparkline component states.
- Responsive layout behavior at representative desktop and mobile widths.

Before completion, run the focused Vitest suites, relevant lint and type checks, `pnpm run build`, and `git diff --check`. Existing unrelated worktree changes must remain untouched.

## Out of Scope

- Multi-shop selection in the UI; the API is only prepared for it.
- Intraday or hourly charts, because the current database stores daily records.
- Replacing Triple Whale's upstream metrics or recalculating its business definitions.
- Removing existing Overview or quick-start functionality.
