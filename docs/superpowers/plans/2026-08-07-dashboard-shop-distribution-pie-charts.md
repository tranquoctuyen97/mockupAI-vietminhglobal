# Dashboard Shop Distribution Pie Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the All-shops dashboard's horizontal comparison bars with Lark-style pie charts while preserving selected-shop daily trends and truthful signed net-profit values.

**Architecture:** Keep the analytics API and `TripleWhaleAnalyticsResult` unchanged. Add a pure chart-model module that owns deterministic shop colors and percentage calculation, then add one focused Recharts client component for pie rendering; `AnalyticsCharts` remains responsible only for choosing All-shops distribution versus selected-shop trends.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Recharts 3.9.0, Vitest, Biome.

## Global Constraints

- Do not change analytics queries, API payloads, filters, sync behavior, KPI cards, per-shop tables, or daily breakdowns.
- Do not add a chart dependency; use the installed `recharts` package.
- Use top-level static imports. Do not introduce `await import()` or function-body `import()` calls.
- Before editing client components, read `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` fully and heed its serialization rules.
- All shops renders pie charts; one selected shop continues to render the existing daily line charts.
- Use one deterministic shop-to-color map across all five metric panels.
- Show signed values everywhere. Never present a negative net profit as positive currency.
- For an all-non-negative metric, calculate percentage from the normal sum. If any value is negative, calculate geometry and percentage from absolute magnitudes and disclose that rule in the panel.
- Zero-value shops remain in the legend at `0%` and do not create visible sectors.
- Preserve unrelated worktree changes. Do not stage, commit, push, deploy, or restart services without explicit authorization.

---

## File Map

- Create `src/app/(authed)/dashboard/analytics-chart-model.ts`: pure deterministic color assignment, slice normalization, and value/percentage formatting inputs.
- Create `src/app/(authed)/dashboard/analytics-chart-model.test.ts`: focused tests for percentages, stable colors, negative values, zero values, and empty totals.
- Create `src/app/(authed)/dashboard/AnalyticsDistributionPie.tsx`: Recharts pie, callout labels, tooltip, accessible legend, loss-magnitude disclosure, and zero-total state.
- Modify `src/app/(authed)/dashboard/AnalyticsCharts.tsx`: replace the horizontal `Distribution` renderer, build one color map, update Lark-style panel labels, and preserve `Trend` unchanged.
- Modify `src/app/(authed)/dashboard/dashboard-analytics.test.tsx`: integration assertions for pie semantics, labels, legends, signed losses, and selected-shop trend switching.
- Clarified contract: `docs/superpowers/specs/2026-08-01-triple-whale-analytics-dashboard-design.md`.

---

### Task 1: Lock the Distribution Model with Pure Tests

**Files:**
- Create: `src/app/(authed)/dashboard/analytics-chart-model.ts`
- Create: `src/app/(authed)/dashboard/analytics-chart-model.test.ts`

**Interfaces:**
- Consumes: `TripleWhaleAnalyticsResult["analytics"]["distribution"]` and metric items shaped as `{ shopId: string; label: string; value: number }`.
- Produces: `SHOP_CHART_COLORS`, `ShopColorMap`, `PieSlice`, `buildShopColorMap(distribution)`, and `buildPieSlices(items, colorByShop)`.

- [ ] **Step 1: Write failing tests for deterministic colors and ordinary percentages**

Create `analytics-chart-model.test.ts` with a test that passes shops in different orders across metrics and requires one stable color per `shopId`:

```ts
import { describe, expect, it } from "vitest";

import { buildPieSlices, buildShopColorMap } from "./analytics-chart-model";

describe("dashboard shop distribution chart model", () => {
  it("keeps shop colors stable across metrics and calculates normal shares", () => {
    const distribution = {
      orderRevenue: [
        { shopId: "tm", label: "TM", value: 75 },
        { shopId: "ym", label: "YM", value: 25 },
      ],
      orders: [
        { shopId: "ym", label: "YM", value: 1 },
        { shopId: "tm", label: "TM", value: 3 },
      ],
      blendedAdSpend: [],
      totalCost: [],
      netProfit: [],
    };
    const colors = buildShopColorMap(distribution);
    const revenue = buildPieSlices(distribution.orderRevenue, colors);
    const orders = buildPieSlices(distribution.orders, colors);

    expect(revenue.map(({ shopId, percent }) => ({ shopId, percent }))).toEqual([
      { shopId: "tm", percent: 75 },
      { shopId: "ym", percent: 25 },
    ]);
    expect(orders.find((slice) => slice.shopId === "tm")?.color).toBe(
      revenue.find((slice) => slice.shopId === "tm")?.color,
    );
  });
});
```

- [ ] **Step 2: Add failing tests for loss magnitude, zero shops, and all-zero data**

Add assertions requiring signed values to remain unchanged while geometry uses magnitude:

```ts
it("uses absolute magnitude for mixed-sign profit without losing signed values", () => {
  const items = [
    { shopId: "profit", label: "Profit", value: 40 },
    { shopId: "loss", label: "Loss", value: -10 },
    { shopId: "zero", label: "Zero", value: 0 },
  ];
  const slices = buildPieSlices(items, {
    profit: "#54a9ed",
    loss: "#6fcf97",
    zero: "#f2b84b",
  });

  expect(slices.find((slice) => slice.shopId === "profit")).toMatchObject({
    value: 40,
    magnitude: 40,
    percent: 80,
  });
  expect(slices.find((slice) => slice.shopId === "loss")).toMatchObject({
    value: -10,
    magnitude: 10,
    percent: 20,
  });
  expect(slices.find((slice) => slice.shopId === "zero")).toMatchObject({
    value: 0,
    magnitude: 0,
    percent: 0,
  });
  expect(buildPieSlices([{ shopId: "zero", label: "Zero", value: 0 }], { zero: "#54a9ed" }))
    .toEqual([{ shopId: "zero", label: "Zero", value: 0, magnitude: 0, percent: 0, color: "#54a9ed" }]);
});
```

- [ ] **Step 3: Run the model test and verify it fails**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' 'src/app/(authed)/dashboard/analytics-chart-model.test.ts'
```

Expected: FAIL because `analytics-chart-model.ts` does not exist.

- [ ] **Step 4: Implement the minimal pure model**

Implement these exact contracts:

```ts
import type { TripleWhaleAnalyticsResult } from "@/lib/triple-whale/analytics";

export const SHOP_CHART_COLORS = [
  "#54a9ed",
  "#9bd77b",
  "#f2b84b",
  "#f57835",
  "#818ce4",
  "#9fe870",
] as const;

export type ShopColorMap = Record<string, string>;

export interface PieSlice {
  shopId: string;
  label: string;
  value: number;
  magnitude: number;
  percent: number;
  color: string;
}

export function buildShopColorMap(
  distribution: TripleWhaleAnalyticsResult["analytics"]["distribution"],
): ShopColorMap;

export function buildPieSlices(
  items: Array<{ shopId: string; label: string; value: number }>,
  colorByShop: ShopColorMap,
): PieSlice[];
```

`buildShopColorMap` must collect the union of shops across all five metrics, deduplicate by `shopId`, sort by `label` and then `shopId`, and assign colors cyclically. `buildPieSlices` must preserve item order and signed `value`, calculate `magnitude = Math.abs(value)`, divide each magnitude by the sum of all magnitudes, return `0` when that sum is zero, and avoid rounding until display time.

- [ ] **Step 5: Run the model test and verify it passes**

Run the Task 1 Vitest command again.

Expected: PASS with no React or Recharts dependency involved.

---

### Task 2: Render the Lark-Style Pie and Integrate It

**Files:**
- Create: `src/app/(authed)/dashboard/AnalyticsDistributionPie.tsx`
- Modify: `src/app/(authed)/dashboard/AnalyticsCharts.tsx:3-10,146-203,214-230`
- Modify: `src/app/(authed)/dashboard/dashboard-analytics.test.tsx:352-402`

**Interfaces:**
- Consumes: `items`, `colorByShop`, `currency`, and `label` from `AnalyticsCharts`.
- Produces: `AnalyticsDistributionPie({ label, currency, items, colorByShop })` with `data-chart-type="pie"`, accessible legend rows, signed formatted values, displayed percentages, and a Recharts `PieChart` for non-zero slices.

- [ ] **Step 1: Strengthen the integration test before changing production code**

Update the All-shops half of the existing switching test to use two shops and assert the exact visual contract:

```ts
const allShopsMarkup = renderToStaticMarkup(<AnalyticsCharts {...common} selectedShopId="" />);
expect(allShopsMarkup).toContain("Distribution by shop");
expect(allShopsMarkup).toContain('data-chart-type="pie"');
expect(allShopsMarkup).toContain("Order revenue %");
expect(allShopsMarkup).toContain("Order %");
expect(allShopsMarkup).toContain("Cost %");
expect(allShopsMarkup).toContain("Net profit %");
expect(allShopsMarkup).toContain("Shop A");
expect(allShopsMarkup).toMatch(/100(?:\.0)?%/);
```

Retain the selected-shop assertion and strengthen it so the daily branch contains the existing trend aria-label and does not contain `data-chart-type="pie"`.

- [ ] **Step 2: Replace the old loss test with signed pie behavior**

Keep the existing `40` and `-18` fixtures, then assert:

```ts
expect(markup).toContain("Profitable");
expect(markup).toContain("Loss making");
expect(markup).toContain("-$18");
expect(markup).toContain("absolute profit/loss magnitude");
expect(markup).toContain('data-has-negative-values="true"');
```

Add an all-zero fixture and require the copy `No non-zero data for this period` plus a `0%` legend entry.

- [ ] **Step 3: Run the focused component test and verify it fails for the right reason**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' 'src/app/(authed)/dashboard/dashboard-analytics.test.tsx'
```

Expected: FAIL because the current All-shops renderer has horizontal bars and no pie semantics.

- [ ] **Step 4: Create the focused Recharts client component**

At the top of `AnalyticsDistributionPie.tsx`, use static imports only:

```tsx
"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { buildPieSlices, type ShopColorMap } from "./analytics-chart-model";
```

Implement the component with these exact behaviors:

- The outer element is a semantic `<figure>` with a visually hidden caption, `data-chart-type="pie"`, `data-has-negative-values`, and `aria-label={`${label} shop distribution pie chart`}`.
- The chart receives only `slices.filter((slice) => slice.magnitude > 0)` so zero shops never create sectors.
- `Pie` uses `dataKey="magnitude"`, `nameKey="label"`, `innerRadius={0}`, `outerRadius="62%"`, `isAnimationActive={false}`, and a white one-pixel sector separator.
- Each `Cell` uses `slice.color`; do not color negative shops red because shop identity color must stay consistent across panels.
- The tooltip and external labels display `label`, the original signed `value`, and `percent.toLocaleString("en-US", { maximumFractionDigits: 2 }) + "%"`.
- Render a semantic `<ul aria-label={`${label} shop legend`}>` outside the SVG. Every shop, including zero shops, gets a legend row with its color swatch, label, signed value, and percentage.
- When any value is negative, render: `Percentages use absolute profit/loss magnitude; signed values are shown.`
- When all magnitudes equal zero, skip `ResponsiveContainer` and render `No non-zero data for this period`; keep the zero-value legend visible.
- Keep the chart wrapper at a bounded height and allow the legend container to scroll horizontally on narrow screens. Do not add viewport reads or hydration-dependent branching merely to hide labels.

- [ ] **Step 5: Replace the horizontal distribution renderer**

In `AnalyticsCharts.tsx`:

1. Add top-level imports for `AnalyticsDistributionPie` and `buildShopColorMap`.
2. Change `CHARTS` labels to exactly:

```ts
[
  { key: "orderRevenue", label: "Order revenue %", currency: true },
  { key: "orders", label: "Order %", currency: false },
  { key: "blendedAdSpend", label: "Ads", currency: true },
  { key: "totalCost", label: "Cost %", currency: true },
  { key: "netProfit", label: "Net profit %", currency: true },
]
```

3. Delete the local `COLORS` constant and the entire horizontal `Distribution` function.
4. Build `const colorByShop = buildShopColorMap(distribution);` once inside `AnalyticsCharts`, before rendering the five panels.
5. In the All-shops branch render:

```tsx
<AnalyticsDistributionPie
  colorByShop={colorByShop}
  currency={currency}
  items={distribution[key]}
  label={label}
/>
```

Do not modify `Trend`, `EmptyChart`, the mode condition, or the existing responsive one/two-column panel grid.

- [ ] **Step 6: Run focused tests and correct only feature-attributable failures**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' \
  'src/app/(authed)/dashboard/analytics-chart-model.test.ts' \
  'src/app/(authed)/dashboard/dashboard-analytics.test.tsx'
```

Expected: PASS. Warnings about a zero-sized `ResponsiveContainer` in static rendering are not acceptable; if encountered, move the Recharts geometry behind a testable fixed-size chart shell or mock only `ResponsiveContainer` in the component test without weakening legend/model assertions.

---

### Task 3: Responsive, Regression, and Build Verification

**Files:**
- Modify only files from Tasks 1-2 when a failure is attributable to the pie-chart change.

**Interfaces:**
- Consumes: the completed pie component and unchanged analytics response.
- Produces: a verified dashboard change with no API, data, sync, or selected-shop regressions.

- [ ] **Step 1: Format and statically check the touched files**

Run:

```bash
pnpm exec biome check --write \
  'src/app/(authed)/dashboard/analytics-chart-model.ts' \
  'src/app/(authed)/dashboard/analytics-chart-model.test.ts' \
  'src/app/(authed)/dashboard/AnalyticsDistributionPie.tsx' \
  'src/app/(authed)/dashboard/AnalyticsCharts.tsx' \
  'src/app/(authed)/dashboard/dashboard-analytics.test.tsx'
```

Expected: exits zero. Review the diff after the formatter and revert no unrelated user changes.

- [ ] **Step 2: Run the complete focused dashboard and analytics suite**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' \
  'src/app/(authed)/dashboard/analytics-chart-model.test.ts' \
  'src/app/(authed)/dashboard/dashboard-analytics.test.tsx' \
  'src/lib/triple-whale/analytics.test.ts' \
  'src/app/api/triple-whale/analytics/route.test.ts'
```

Expected: all tests PASS; selected-shop trends, loss visibility, API aggregation, and tenant-scoped response behavior remain green.

- [ ] **Step 3: Visually verify representative dashboard states**

At desktop and narrow mobile widths, verify:

- All shops shows five circles with Lark-style labels and one consistent shop color across every card.
- Legend/value/percentage content remains readable without overflowing the card.
- A zero shop appears at `0%` in the legend without a visible sector.
- Mixed positive/negative net profit shows signed currency and the magnitude disclosure.
- Selecting one shop removes all pie charts and restores five daily trend panels.
- Loading, partial-sync, filter, table, and daily-breakdown sections are unchanged.

Do not use production as the first visual test. Use the existing local authenticated workflow, and do not deploy during this step.

- [ ] **Step 4: Run the production build and diff checks**

Run:

```bash
pnpm run build
git diff --check
git status --short
```

Expected: the Next.js production build succeeds, `git diff --check` exits zero, and only the planned chart, test, spec, and plan files are changed. Existing baseline warnings may remain only if they are unrelated and are reported explicitly.

- [ ] **Step 5: Stop for review**

Report the focused test counts, build result, visual states checked, exact changed files, and any remaining limitation. Do not stage, commit, push, deploy, or restart PM2 until the user explicitly requests the next action.

---

## Plan Self-Review Results

- Spec coverage: pie geometry, exact panel labels, stable colors, legend, signed values, negative-value disclosure, zero values, selected-shop trends, responsive behavior, and regression verification each map to a task.
- Placeholder scan: no `TBD`, `TODO`, deferred implementation, or unspecified error-handling step remains.
- Type consistency: `ShopColorMap`, `PieSlice`, `buildShopColorMap`, `buildPieSlices`, and `AnalyticsDistributionPie` use the same names and shapes in all tasks.
- Scope: no analytics API, database, queue, filter, table, or deployment work is included.
