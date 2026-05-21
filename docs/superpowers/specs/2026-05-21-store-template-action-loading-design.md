# Store Template Action Loading Design

**Date:** 2026-05-21
**Status:** Approved for planning
**Decision:** Use action-level loading and silent refresh for Store Template table actions.

## Problem

Store Template actions feel like a full page reload. The page is not actually reloading in the browser; the app is showing the route-level loading state because `fetchStore()` always calls `setLoading(true)`.

Template actions such as set default, duplicate, delete, and save call `onRefreshStore()`, which calls `fetchStore()`. That causes the whole Store Config page to render only the centered spinner. For small row-level actions, this removes context and makes the app feel slow.

## Goal

Keep data fresh after every mutation, but avoid replacing the whole page with a spinner for table actions.

The user should see exactly which action is running, on which template, and keep their place in the table.

## Non-Goals

- Do not redesign the Store Config page.
- Do not change the backend API contract.
- Do not introduce a new data-fetching library.
- Do not change the existing initial page loading behavior.

## Recommended UX

Use two refresh modes:

- Initial load: keep current full-page spinner.
- Background refresh: fetch store data without setting the full-page `loading` state.

Use row/action-level loading for template table actions:

- Set default: show loading on the Star action or disable the row actions; update the default badge immediately on success, then silently refresh.
- Duplicate: disable the duplicate action while running; silently refresh after success.
- Delete: disable row actions while confirmation/API is running; remove the row on success or silently refresh.
- Save template: keep the existing save-button loading, then silently refresh when returning to the list.

## UI Rules

- Do not blank the page for table actions.
- Disable all actions for a row while that row has an in-flight action.
- Show pointer/disabled states clearly.
- Keep toast success/error feedback.
- Keep the current destructive confirmation for delete.
- Keep full-page spinner only for first page load or when the store cannot be loaded.

## State Design

Parent `StoreConfigContent` should support silent refresh:

```ts
const fetchStore = useCallback(async (options?: { silent?: boolean }) => {
  if (!options?.silent) setLoading(true);
  try {
    const res = await fetch("/api/stores");
    if (res.ok) {
      const stores = await res.json();
      const found = stores.find((s: StoreDetail) => s.id === storeId);
      setStore(found || null);
      return found;
    }
  } finally {
    if (!options?.silent) setLoading(false);
  }
  return null;
}, [storeId]);
```

`TemplatesSection` should track the row action:

```ts
type TemplateAction =
  | { type: "default"; templateId: string }
  | { type: "duplicate"; templateId: string }
  | { type: "delete"; templateId: string }
  | null;
```

`onRefreshStore` should accept `{ silent?: boolean }` so child actions can refresh without page-level loading.

## Data Flow

1. User clicks an action in the template row.
2. `TemplatesSection` sets `templateAction`.
3. The clicked row actions become disabled.
4. API request runs.
5. On success, toast is shown.
6. `onRefreshStore({ silent: true })` refreshes store data without full-page spinner.
7. `templateAction` is cleared.

## Error Handling

- API errors keep the current toast behavior.
- `mark default` keeps structured `missing` handling for incomplete templates.
- `finally` must always clear `templateAction`.
- If silent refresh fails after mutation success, keep the current local UI and show a generic refresh error only if the mutation result cannot be trusted.

## Testing

Manual verification is sufficient for this UI-only interaction change:

- First visit still shows full-page loading.
- Set default no longer blanks the page.
- Duplicate no longer blanks the page.
- Delete no longer blanks the page.
- Save template no longer blanks the page after returning to list.
- Row actions are disabled while their API request is running.
- Toasts still appear for success and error states.

Automated checks:

- Run `git diff --check`.
- Run the existing targeted tests for template readiness.
- Run `npm run build`; if it still fails on the known unrelated `scripts/simulate-printify-publish.ts` issue, report that separately.

## Acceptance Criteria

- Template table actions do not trigger the route-level spinner.
- The active row/action shows an in-progress disabled state.
- Store data is still refreshed after successful mutations.
- Initial Store Config loading behavior remains unchanged.
