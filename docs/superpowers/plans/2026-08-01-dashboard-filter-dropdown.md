# Dashboard Filter Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's wide preset-button row with compact Triple Whale-style date, comparison, and shop dropdown controls without changing analytics API contracts.

**Architecture:** Keep all filter interaction state inside `DashboardFilters`: one active popover, custom-date drafts, outside-click dismissal, and Escape dismissal. Continue emitting the existing `DashboardFilterValue` to `TripleWhaleDashboard`, so preset calculation, comparison calculation, shop query parameters, sync behavior, and server APIs remain unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Lucide React, Vitest, Biome

## Global Constraints

- Do not stage, commit, create a branch, or push; all changes remain uncommitted on main.
- Use top-level static imports only.
- The date trigger contains Today, Yesterday, Last 7 days, Last 14 days, Last 30 days, Last 90 days, This month, and Custom range.
- Presets query immediately; custom dates query only after a valid Apply.
- Only one custom dropdown panel can be open at a time.
- Clicking outside or pressing Escape closes the active panel without issuing a query.
- The comparison trigger contains None, Previous period, Previous week, Previous month, Previous quarter, and Previous year.
- Shop selection remains single-value; an empty shop id means All shops.
- Controls wrap on mobile and dropdown panels remain inside the viewport.
- Preserve the effective current/comparison range summary beneath the toolbar.

---

### Task 1: Compact dropdown filter behavior

**Files:**
- Modify: `src/app/(authed)/dashboard/dashboard-analytics.test.tsx`
- Modify: `src/app/(authed)/dashboard/DashboardFilters.tsx`

**Interfaces:**
- Consumes: `DashboardFilterValue`, `AnalyticsShop[]`, `DateRange | null`, and `onChange(value: DashboardFilterValue): void`.
- Produces: the unchanged `DashboardFilterValue` interface and `DashboardFilters` with one optional `syncAction?: ReactNode` presentation prop.

- [ ] **Step 1: Write the failing compact-toolbar test**

Replace the existing static “renders every date and comparison choice” expectation with a test that verifies three compact triggers and hidden panels:

```tsx
it("renders compact dropdown triggers instead of a wide preset row", () => {
  const markup = renderToStaticMarkup(
    <DashboardFilters
      comparison="previous_period"
      comparisonRange={{ from: "2026-07-31", to: "2026-07-31" }}
      from="2026-08-01"
      onChange={() => undefined}
      preset="today"
      selectedShopId=""
      shops={[{ id: "shop-a", customName: "Shop A", shopDomain: "a.myshopify.com" }]}
      to="2026-08-01"
    />,
  );

  expect(markup).toContain('aria-haspopup="dialog"');
  expect(markup).toContain('aria-haspopup="menu"');
  expect(markup).toContain("Today");
  expect(markup).toContain("Previous period");
  expect(markup).toContain("All shops");
  expect(markup).not.toContain('aria-pressed="false"');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/app/'(authed)'/dashboard/dashboard-analytics.test.tsx
```

Expected: FAIL because the current date presets use `aria-pressed` buttons and no compact popover triggers exist.

- [ ] **Step 3: Add dropdown constants and active labels**

In `DashboardFilters.tsx`, add top-level typed option arrays so labels are shared by triggers and panels:

```tsx
const DATE_OPTIONS: Array<{ value: DashboardPreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom range" },
];

const COMPARISON_OPTIONS: Array<{ value: ComparisonMode; label: string }> = [
  { value: "none", label: "None" },
  { value: "previous_period", label: "Previous period" },
  { value: "previous_week", label: "Previous week" },
  { value: "previous_month", label: "Previous month" },
  { value: "previous_quarter", label: "Previous quarter" },
  { value: "previous_year", label: "Previous year" },
];
```

Add `CalendarDays`, `Check`, and `ChevronDown` as top-level Lucide imports. Derive the active date, comparison, and shop labels from these arrays and `props.shops`.

- [ ] **Step 4: Implement one-open-panel state and dismissal**

Add these client-side state/ref boundaries:

```tsx
type OpenPanel = "date" | "comparison" | null;

const rootRef = useRef<HTMLDivElement>(null);
const [openPanel, setOpenPanel] = useState<OpenPanel>(null);

useEffect(() => {
  function dismissOnPointerDown(event: PointerEvent) {
    if (!rootRef.current?.contains(event.target as Node)) setOpenPanel(null);
  }
  function dismissOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape") setOpenPanel(null);
  }
  document.addEventListener("pointerdown", dismissOnPointerDown);
  document.addEventListener("keydown", dismissOnEscape);
  return () => {
    document.removeEventListener("pointerdown", dismissOnPointerDown);
    document.removeEventListener("keydown", dismissOnEscape);
  };
}, []);
```

Opening one trigger must set `openPanel` to its name, which inherently closes the other panel. Do not call `props.onChange` from trigger open/close handlers.

- [ ] **Step 5: Replace the preset row with the date trigger and anchored panel**

Render a compact trigger using `aria-expanded`, `aria-controls`, and `aria-haspopup="dialog"`. Its anchored panel uses `position: absolute`, `zIndex: 30`, `minWidth: 300`, `maxWidth: "calc(100vw - 32px)"`, and the existing card/border tokens.

Render each preset as a full-width option button. On selection:

```tsx
function selectPreset(preset: DashboardPreset) {
  if (preset === "custom") {
    update({ preset });
    return;
  }
  update({ preset });
  setOpenPanel(null);
}
```

Show a `Check` icon on the active option. When `props.preset === "custom"`, render the existing From/To draft inputs and Apply button inside the same panel. A successful Apply executes `update(draftRange)` and then `setOpenPanel(null)`.

- [ ] **Step 6: Replace comparison select with a custom menu**

Render a matching trigger with `aria-haspopup="menu"`. Inside its anchored menu, use buttons for all `COMPARISON_OPTIONS`. Each option must call:

```tsx
update({ comparison: option.value });
setOpenPanel(null);
```

Mark the current comparison with a `Check` icon and preserve the existing current/comparison range summary.

- [ ] **Step 7: Restyle the shop select as the third compact control**

Keep the native single-value `<select>` to preserve reliable keyboard behavior, but wrap it in the same compact visual shell and remove the uppercase `SHOP` label from above it. Add an `aria-label="Shop"`. The first option remains `<option value="">All shops</option>`.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/app/'(authed)'/dashboard/dashboard-analytics.test.tsx
```

Expected: all dashboard component tests PASS.

---

### Task 2: Toolbar integration and responsive verification

**Files:**
- Modify: `src/app/(authed)/dashboard/dashboard-analytics.test.tsx`
- Modify: `src/app/(authed)/dashboard/TripleWhaleDashboard.tsx`
- Modify: `src/app/(authed)/dashboard/DashboardFilters.tsx`

**Interfaces:**
- Consumes: `DashboardFilters` with the optional `syncAction?: ReactNode` prop from Task 1.
- Produces: a single responsive toolbar containing filters and `Sync All`, followed by the effective range summary.

- [ ] **Step 1: Write the failing integration assertion**

Extend the DashboardClient static markup test with stable toolbar semantics:

```tsx
expect(markup).toContain('aria-label="Analytics filters"');
expect(markup).toContain("Sync All");
expect(markup).not.toContain('class="card" style="display:flex;flex-wrap:wrap;gap:12px;padding:14px"');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run --exclude '.next/**' src/app/'(authed)'/dashboard/dashboard-analytics.test.tsx
```

Expected: FAIL because the current filters still render their own large card container and do not expose the compact toolbar label.

- [ ] **Step 3: Integrate filters and Sync All into one responsive toolbar**

In `TripleWhaleDashboard.tsx`, replace the current `flex: "1 1 760px"` filter wrapper with one toolbar container. Pass the existing Sync button to the `DashboardFilters` optional `syncAction?: ReactNode` prop so it renders inside the same flex row.

The filter component root must use:

```tsx
<div
  aria-label="Analytics filters"
  ref={rootRef}
  style={{
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    position: "relative",
    width: "100%",
  }}
>
```

Render the effective range summary with `flexBasis: "100%"` beneath the controls. Render `syncAction` after the shop control with `marginLeft: "auto"`; allow it to wrap naturally on narrow widths.

- [ ] **Step 4: Add mobile-safe panel sizing and focus styling**

Ensure each popover wrapper is `position: "relative"`. Panels use `left: 0`, `top: "calc(100% + 8px)"`, `width: "min(360px, calc(100vw - 32px))"`, and `boxShadow: "var(--shadow-lg)"`. Reuse `.btn`, `.input`, and theme border variables so keyboard focus remains visible through existing global styles.

- [ ] **Step 5: Run formatter and focused regression tests**

Run:

```bash
pnpm exec biome check --write src/app/'(authed)'/dashboard/DashboardFilters.tsx src/app/'(authed)'/dashboard/TripleWhaleDashboard.tsx src/app/'(authed)'/dashboard/dashboard-analytics.test.tsx
pnpm exec vitest run --exclude '.next/**' src/app/'(authed)'/dashboard/dashboard-analytics.test.tsx src/lib/triple-whale/date-ranges.test.ts src/lib/triple-whale/analytics.test.ts
```

Expected: Biome reports no errors and all focused tests PASS.

- [ ] **Step 6: Run production verification**

Run:

```bash
git diff --check
pnpm run build
```

Expected: `git diff --check` exits zero and Next.js production build succeeds. Existing unrelated Node engine or NFT tracing warnings may remain, but no dashboard error is allowed.

- [ ] **Step 7: Confirm repository state without committing**

Run:

```bash
git status --short
```

Expected: dashboard files and planning documents remain unstaged/uncommitted; existing unrelated working-tree changes are preserved.
