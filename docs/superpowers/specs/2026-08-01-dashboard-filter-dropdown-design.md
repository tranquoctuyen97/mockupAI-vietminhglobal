# Dashboard Filter Dropdown Design

## Goal

Replace the wide row of dashboard date preset buttons with compact Triple Whale-style dropdown controls while preserving the existing analytics query, comparison, custom range, and single-shop behavior.

## Layout

The filter area is no longer rendered as one large bordered card. It becomes a compact toolbar containing:

1. A date-range trigger showing a calendar icon and the active preset label, such as `Today`, `7D`, or `This Month`.
2. A comparison trigger showing the active comparison label, such as `Previous period`.
3. A shop selector showing `All shops` or the selected shop name.
4. The existing `Sync All` action aligned on the same row.

Below the toolbar, a muted summary displays the effective server ranges, for example `Aug 1–31, 2026 compared with Jul 1–31, 2026`.

On narrow screens, controls wrap without horizontal page scrolling. Dropdown panels are constrained to the viewport and become nearly full-width on mobile.

## Date Dropdown

The date trigger opens an anchored panel containing these presets:

- Today
- Yesterday
- Last 7 days
- Last 14 days
- Last 30 days
- Last 90 days
- This month
- Custom range

Selecting a preset immediately closes the panel and updates the analytics query using the existing `presetRange` behavior.

Selecting `Custom range` reveals From and To date inputs inside the panel. These inputs remain draft values until the user presses Apply. Apply is disabled while either date is empty or From is later than To. A successful Apply closes the panel and issues one analytics query.

The active option is marked with a check icon. The trigger uses text and a chevron rather than emoji.

## Comparison Dropdown

The comparison trigger opens a separate anchored menu containing:

- None
- Previous period
- Previous week
- Previous month
- Previous quarter
- Previous year

Selecting an option updates the analytics query and closes the menu. The server remains responsible for calculating and returning the effective comparison range.

## Shop Dropdown

The shop control remains a single-value selector. `All shops` queries the tenant aggregate; choosing one shop sends the existing single `shopId`. Its visual styling matches the other two toolbar controls.

## Interaction and Accessibility

- Only one custom dropdown panel can be open at a time.
- Clicking outside or pressing Escape closes the active panel.
- Triggers expose `aria-expanded`, `aria-haspopup`, and an associated menu/panel id.
- Options are keyboard-reachable buttons with a visible focus state.
- Menus use a high enough z-index to render over dashboard cards.
- No analytics query occurs merely from opening or closing a dropdown.
- Existing loading, sync, partial-data, and error states remain unchanged.

## Component Boundary

`DashboardFilters` owns dropdown visibility and custom-date draft state. It continues to emit the existing `DashboardFilterValue` through `onChange`, so `TripleWhaleDashboard`, API routes, date-range calculation, and backfill behavior require no contract changes.

## Testing

Component tests will verify:

- Compact date, comparison, and shop triggers render with their current labels.
- The eight preset buttons are contained within the date dropdown panel rather than the main toolbar.
- Custom range retains an Apply action and effective range summary.
- ARIA expanded/menu relationships are present.
- Existing dashboard analytics and date-range tests continue to pass.
