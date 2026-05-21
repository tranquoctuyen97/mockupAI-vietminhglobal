# Template Default Readiness Design

**Date:** 2026-05-21
**Status:** Approved for planning
**Decision:** Block incomplete templates from becoming default.

## Problem

Store Templates can show a `DEFAULT` badge on a template that is not fully configured. In the current code, the default API only verifies store ownership and template ownership, then flips `isDefault`. It does not validate blueprint, provider, variants, colors, or placement readiness.

This creates a product contradiction:

- Store Templates says a default template exists.
- Wizard uses the default template and reports `Preset chưa hoàn thiện`.
- Wizard live preview can show a fallback front placement, making the user believe placement is configured even when the template has no saved placement.
- The UI currently contains a `handleSetDefault()` function, but the visible Star action was removed from the template table, so users cannot find "mark as default".

## Goal

Keep the `default template` concept, but make it reliable:

> A template may become default only when it is a ready, runnable template.

Wizard should be able to assume that the default template is usable. If no ready default exists, Store Settings must guide the user to finish a template before Wizard can proceed.

## Non-Goals

- Do not remove the default template concept.
- Do not add template selection to Wizard in this change.
- Do not rebuild the Store Templates page layout.
- Do not change Printify product generation or publish behavior beyond relying on a valid default.

## Readiness Rule

A template is `ready` when all of these are true:

1. `printifyBlueprintId` is present.
2. `printifyPrintProviderId` is present.
3. `enabledVariantIds.length > 0`.
4. The template has at least one linked color through `TemplateColor`.
5. `defaultPlacement` has at least one enabled placement view after normalization with `fallbackFront = false`.

The fallback front placement used by Wizard preview must not count as saved placement readiness.

`enabledSizes` is not a blocking readiness requirement because the current publish flow can fall back to all available sizes when no sizes are selected. The UI should still show size count as useful configuration context.

## Architecture

Add a small shared readiness helper in the store/template domain. The helper should accept a template including `colors` and return:

```ts
type TemplateReadiness = {
  ready: boolean;
  missing: Array<"blueprint" | "provider" | "variants" | "colors" | "placement">;
};
```

Use the helper in three places:

- `setDefaultTemplate()` service, to enforce the invariant server-side.
- Store Templates UI, to render `Ready`, `Incomplete`, and `Default` states.
- Store preset status computation, so store-level readiness and template-level readiness use the same definition.

The invariant belongs server-side. UI disabling is only guidance; API validation is the source of truth.

## API Behavior

`PUT /api/stores/:id/mockup-templates/:templateId/default` must:

1. Verify the store belongs to the tenant.
2. Load the target template with linked colors.
3. Compute readiness.
4. If not ready, return `400`:

```json
{
  "error": "Template is incomplete and cannot be set as default",
  "missing": ["variants", "placement"]
}
```

5. If ready, unset the current default and set the selected template as default in one transaction.

`createTemplate()` should no longer mark the first template as default unless the newly created template is ready. This prevents an incomplete first template from becoming a broken default automatically.

`deleteTemplate()` can keep its current behavior, but when a default template is deleted, the replacement default must be the first ready template by `sortOrder`. If no ready template exists, the store should have no default.

## UI Behavior

The Store Templates table should make default status and readiness visible:

- `DEFAULT`: current default and ready.
- `DEFAULT INCOMPLETE`: legacy/current default exists but is not ready; Wizard remains blocked until fixed.
- `READY`: can be made default.
- `INCOMPLETE`: cannot be made default yet.

Restore an explicit action for non-default templates:

- Ready non-default template: show enabled Star action with title `Đặt làm mặc định`.
- Incomplete non-default template: show a disabled Star action with a title listing missing setup items. Do not send a default request from this disabled state.

If the API rejects a default request because the template became incomplete after the UI rendered, show a concise toast:

`Template chưa hoàn tất: variants, placement. Hoàn tất template trước khi đặt default.`

The existing Edit, Duplicate, and Settings actions stay available. Incomplete templates remain useful drafts; they are just not runnable defaults.

If a store has templates but no ready default, show a Store Templates banner:

`Chưa có default template sẵn sàng. Hoàn tất một template rồi đặt làm default để Wizard có thể chạy.`

## Wizard Behavior

Wizard continues to load the default template through the existing store template endpoint.

If no ready default exists:

- The existing preset warning remains.
- The message should identify that the default template is missing or incomplete.
- The "Tạo Mockups" button remains disabled.

Wizard preview may still use a fallback placement for visual continuity, but the copy must not imply this fallback is saved preset configuration. Saved placement readiness is determined only from template `defaultPlacement`.

## Data Flow

1. Admin creates or edits a template.
2. Template is saved with blueprint, variants, colors, and placement.
3. Store Templates computes template readiness for display.
4. Admin clicks Star on a ready template.
5. API recomputes readiness and only then sets `isDefault = true`.
6. Wizard loads the default template and can safely use it for preview, mockup generation, and publish.

## Error Handling

- API returns structured missing keys for incomplete templates.
- UI maps missing keys to human labels:
  - `blueprint`: Blueprint
  - `provider`: Provider
  - `variants`: Variants
  - `colors`: Colors
  - `placement`: Placement
- Network or unexpected server errors keep the existing generic toast.
- If legacy data already has an incomplete default, Store Settings should show it as `DEFAULT INCOMPLETE`. Store-level preset remains not ready until the template is completed or a ready template is selected.

## Testing

Add focused tests around the invariant:

- Ready template can be set as default.
- Missing variants blocks default.
- Missing colors blocks default.
- Missing placement blocks default.
- First created incomplete template does not become default automatically.
- Deleting a default promotes the next ready template, not an incomplete one.
- Store preset status reports incomplete when the only default template is incomplete.

Manual verification:

- Store Templates table shows the Star action again.
- Incomplete template cannot be marked default from UI.
- Direct API call cannot mark incomplete template default.
- Wizard no longer sees a broken default as runnable.

## Acceptance Criteria

- Users can find the action to mark a template as default.
- Incomplete templates cannot become default through UI or API.
- Store Settings clearly explains why an incomplete template cannot become default.
- Wizard only treats the store as ready when the default template is ready.
- Existing incomplete templates are preserved and editable.
