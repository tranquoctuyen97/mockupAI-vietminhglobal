# Global Mockup Library Clean Break Design

## Status

Approved design direction, pending implementation plan.

This spec supersedes the mockup-storage and mockup-frame parts of `docs/superpowers/specs/2026-06-17-template-pricing-and-composite-region-design.md`.
The template pricing work from that earlier spec remains valid. The old `StoreMockupTemplate.defaultCompositeRegionPx` design is obsolete and must be removed.

## Goal

Move CUSTOM mockups from store/template-scoped legacy storage to a global tenant-level mockup library.

The new model has one source of truth for uploaded mockup assets and their composite frames:

- `MockupLibraryItem`: global tenant-level mockup asset.
- `TemplateMockupItem`: template attachment and color mapping for a mockup.
- `WizardDraftMockupLibraryPick`: per-draft selected template mockup item, with optional draft-only composite region override.

This is a beta clean break. There is no legacy compatibility, no import flow, and no preservation requirement for existing `CustomMockupSource` data.

## Non-Goals

- No `CustomMockupSource` compatibility path.
- No legacy `/stores/[id]/mockup-library` UI or API.
- No `StoreMockupTemplate.defaultCompositeRegionPx`.
- No template-level composite region override.
- No `MockupLibraryItem` store/color metadata.
- No `FINAL` render mode behavior in this phase.
- No data backfill from legacy custom mockup rows.

## Data Model

### `MockupLibraryItem`

Global tenant-level asset. It is not tied to store, template, or color.

Fields:

- `id`
- `tenantId`
- `name`
- `storagePath`
- `previewPath`
- `width`
- `height`
- `view`
- `sceneType`
- `renderMode`, default `COMPOSITE`
- `compositeRegionPx`
- `uploadedById`
- `mimeType`
- `fileSizeBytes`
- `createdAt`
- `updatedAt`
- `isActive` and `deletedAt` only if the implementation follows the repo's soft-delete pattern for this model

Rules:

- `renderMode` supports `COMPOSITE` only in this phase.
- Prefer a Prisma enum with the single allowed runtime value `COMPOSITE`. If a string field is used instead, every API and service write path must strictly validate `COMPOSITE` only.
- `compositeRegionPx` may be nullable during upload/edit, but publish-ready mockups require a valid region.
- `POST /api/mockups` auto-generates a Smart Fit `compositeRegionPx` when the caller does not provide one, so uploaded mockups are immediately usable.
- If a library item frame is edited later, the new frame is live for future renders unless a draft pick has its own override.

### `TemplateMockupItem`

Join between a store template and a global mockup asset.

Fields:

- `id`
- `templateId`
- `mockupId`
- `appliesToColorIds` as JSON array of store color IDs
- `sortOrder`
- `isPrimary`
- `createdAt`
- `updatedAt`

Rules:

- `appliesToColorIds = []` means the mockup applies to all colors as a generic fallback.
- Non-empty `appliesToColorIds` must contain valid `StoreColor` IDs for the template's store.
- No `compositeRegionOverridePx` in this phase.
- Unique key: `[templateId, mockupId]`.
- At most one `TemplateMockupItem` per template can have `isPrimary = true`.
- Template mockup attach APIs only work for CUSTOM templates.
- `TemplateMockupItem` deletion is restricted if referenced by a draft pick.
- Relations from downstream rows to template attachments use explicit `onDelete: Restrict`.

### `WizardDraftMockupLibraryPick`

Draft-level selected mockup attachment. It points to the template attachment, not directly to the global mockup asset.

Fields:

- `id`
- `draftId`
- `templateMockupItemId`
- `colorId`
- `sortOrder`
- `isPrimary`
- `compositeRegionPx`
- timestamps

Rules:

- `templateMockupItemId` is required.
- `colorId` is required.
- No denormalized `mockupLibraryItemId`.
- Drop old `customMockupSourceId` and related indexes/FKs.
- Unique key: `[draftId, templateMockupItemId, colorId]`.
- Snapshot fields are `colorId`, `sortOrder`, and `isPrimary`.
- `compositeRegionPx` is only a per-draft override when the user edits the frame in the wizard.
- The relation to `TemplateMockupItem` uses explicit `onDelete: Restrict`.

## Effective Region Priority

CUSTOM render uses this priority:

1. `WizardDraftMockupLibraryPick.compositeRegionPx`
2. `TemplateMockupItem.mockup.compositeRegionPx`
3. Smart Fit fallback

Smart Fit fallback is render safety only. It does not make a mockup publish-ready.

## API Design

### Global Mockup Library

`GET /api/mockups`

- Lists tenant-level `MockupLibraryItem` rows.
- Requires `mockup_library` permission.
- Validates tenant scope through session.
- Supports filters: `q`, `view`, `sceneType`.
- Returns URL, dimensions, render mode, composite region, and `templateAttachmentCount` from `TemplateMockupItem`.

`POST /api/mockups`

- Uploads a new global mockup asset.
- Requires `mockup_library` permission.
- Accepts multipart `file`, `name`, `view`, `sceneType`, optional `compositeRegionPx`.
- Server normalizes image, stores it, extracts `width` and `height`.
- `renderMode` is forced/defaulted to `COMPOSITE`.
- If no valid region is provided, server saves an auto-generated Smart Fit region.

`PATCH /api/mockups/[mockupId]`

- Updates `name`, `view`, `sceneType`, and `compositeRegionPx`.
- Requires tenant ownership.
- Region edits are global and live for all future non-overridden renders.

`DELETE /api/mockups/[mockupId]`

- Hard-deletes only when no `TemplateMockupItem` references it.
- Deletes storage and preview objects for the mockup. Missing storage objects do not block deletion; other storage deletion errors return an error and leave the DB row intact.
- Returns `409` when attached to templates.

### Template Mockup Attachments

`GET /api/stores/[id]/mockup-templates/[templateId]/mockups`

- Lists template attachments joined with `MockupLibraryItem`.
- Requires tenant ownership of store, template, and mockups.

`POST /api/stores/[id]/mockup-templates/[templateId]/mockups`

- Attaches an existing global mockup to a CUSTOM template.
- Validates store/template/mockup tenant ownership.
- Validates template is CUSTOM.
- Validates `appliesToColorIds` against the store's colors.
- `[]` means all colors.
- Duplicate `[templateId, mockupId]` returns `409`.

`PATCH /api/stores/[id]/mockup-templates/[templateId]/mockups/[itemId]`

- Updates `appliesToColorIds`, `sortOrder`, and `isPrimary`.
- Does not update composite region.
- Setting `isPrimary = true` clears primary from other items in the same template.

`DELETE /api/stores/[id]/mockup-templates/[templateId]/mockups/[itemId]`

- Detaches a mockup from a template.
- Restricted when draft picks reference the attachment.

### Removed API/UI

Remove these paths and all runtime callers:

- `/stores/[id]/mockup-library`
- `/api/stores/[id]/mockup-library`
- `/api/stores/[id]/mockup-library/[sourceId]`

## UX Design

### Sidebar

Add `Mockups` under Workspace.

- Route: `/mockups`
- Permission: `mockup_library`

### `/mockups`

Global tenant-level mockup library page.

Core behavior:

- List all `MockupLibraryItem` rows in the tenant.
- Upload new mockup.
- Edit name, view, scene type, and frame.
- Delete when unused; disable delete or surface `409` when attached.
- `/mockups?edit=<mockupId>` opens the global edit/frame modal.

Each item shows:

- thumbnail or preview
- name
- image dimensions
- view
- scene type
- frame status
- attached template count when available

### Store Template Editor

PRINTIFY templates:

- Keep Placement tab.
- No Mockups tab and no mockup frame controls.

CUSTOM templates:

- Tabs: `Blueprint -> Variants -> Mockups -> Giá bán`.
- Mockups tab selects existing global mockups or uploads new ones.
- Upload first creates `MockupLibraryItem`, then attaches it to the template.
- Template tab never edits `compositeRegionPx` directly.
- Template tab links to `/mockups?edit=<mockupId>` for global frame edits.
- User chooses color applicability:
  - `All colors` stores `appliesToColorIds = []`.
  - `Specific colors` stores selected store color IDs.

Attached mockups display:

- thumbnail and name
- applies-to label
- `isPrimary`
- `sortOrder`
- detach action

## Wizard And Render Behavior

### Matching

For each selected color in a CUSTOM template:

1. Use attached template mockups whose `appliesToColorIds` contains the selected `colorId`.
2. If no exact match exists, use generic attached mockups where `appliesToColorIds = []`.
3. If still none exist, checklist fails for that color.

Exact color matches replace generic mockups for that color. Generic mockups are fallback only.

### Pick Rebuild

Pick rebuild is idempotent.

- Stable key: `draftId + templateMockupItemId + colorId`.
- Preserve `compositeRegionPx` override for unchanged keys.
- Create missing picks.
- Delete stale picks.
- Snapshot `colorId`, `sortOrder`, and `isPrimary`.
- Template mapping/order changes do not mutate existing draft picks unless picks are explicitly rebuilt.

### Checklist

CUSTOM publish readiness requires:

- every selected color has at least one matching attached mockup
- matching mockups have `renderMode = COMPOSITE`
- matching mockups have valid `compositeRegionPx`

Smart Fit fallback is render safety only and does not pass readiness.

PRINTIFY readiness continues to use Placement.

### Job And Render Idempotency

Mockup job idempotency includes:

- `draftId`
- `colorId`
- `templateMockupItemId`
- design or design-pair identity

Render order:

1. `isPrimary` descending
2. `sortOrder` ascending
3. `createdAt` ascending
4. `id` ascending

The rendered color label comes from the selected store color / pick `colorId`, not from `MockupLibraryItem`.

## Migration And Removal Plan

This is a clean break. It can be implemented as add/rewire/drop in the same phase.

Implementation order:

1. Add `MockupLibraryItem` and `TemplateMockupItem`.
2. Rewire APIs, UI, wizard, checklist, generation, worker, and publish paths to the new models.
3. Rewire `WizardDraftMockupLibraryPick` to `templateMockupItemId`, required `colorId`, `sortOrder`, `isPrimary`, and optional `compositeRegionPx`.
4. Remove `/stores/[id]/mockup-library` UI and API.
5. Run `rg` gates over `src` and `prisma/schema.prisma` to prove no runtime path reads legacy models or routes.
6. Remove `StoreMockupTemplate.defaultCompositeRegionPx`.
7. Remove `CustomMockupSource` model, relations, indexes, and table.
8. Add migration to drop `custom_mockup_sources` and obsolete columns/FKs.

No legacy data migration is required.

## Verification Requirements

Automated checks:

- `npx prisma validate`
- `npx prisma generate`
- focused tests for new global mockup API routes
- focused tests for template mockup attach routes
- tests for delete restrict
- tests for duplicate attach `409`
- tests for `appliesToColorIds` validation
- source guard that the Store Template Editor does not import/render `CompositeRegionEditor` or write `compositeRegionPx` for template mockups
- source guard that global frame edits happen only in `/mockups` page/API paths
- wizard matching tests:
  - exact color match replaces generic
  - generic fallback works
  - no match fails checklist
- effective region priority tests
- worker/generation source tests proving no `CustomMockupSource`
- existing placement tests
- existing wizard schema/source tests
- existing publish worker tests
- `npm run build`
- `git diff --check`

No-match gates over `src` and `prisma/schema.prisma`:

```bash
! rg -n "CustomMockupSource|customMockupSource|customMockupSources|/mockup-library|defaultCompositeRegionPx" src prisma/schema.prisma
```

Route/source checks:

- build route list includes `/mockups`
- build route list includes `/api/mockups`
- build route list does not include `/stores/[id]/mockup-library`
- build route list does not include `/api/stores/[id]/mockup-library`

Manual checks:

- Sidebar shows Mockups under Workspace.
- `/mockups` lists tenant mockups.
- `/mockups` uploads a mockup and auto-generates Smart Fit frame.
- `/mockups?edit=<mockupId>` opens edit/frame modal.
- Editing a global frame updates future non-overridden renders.
- Delete is disabled or returns `409` when attached.
- CUSTOM template selects existing library mockups.
- CUSTOM template upload creates a library item, then attaches it.
- CUSTOM template maps attachments to all colors or specific colors.
- CUSTOM template does not expose frame editing directly.
- PRINTIFY template keeps Placement and does not show Mockups.
- Wizard CUSTOM draft inherits matching template mockups by color.
- Checklist fails when selected color has no exact or generic valid COMPOSITE mockup.
- Publish/render uses library frame unless draft override exists.
