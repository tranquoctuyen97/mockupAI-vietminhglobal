# Multi-Design Wizard Design

Date: 2026-05-26
Status: Approved design, ready for implementation planning

## Goal

Allow one wizard run to select 1-5 designs, render real Printify mockups for every selected design, generate shared AI content, review grouped results, and publish one listing per design.

The run still uses one store, one mockup template, one selected color set, one size set, one placement configuration, one AI content payload, and one price. Printify products and final listings are per design because Printify supports one design per product.

## Current Constraints

The existing implementation is single-design in several places:

- `WizardDraft.designId` stores the selected design.
- `WizardDraft.printifyImageId` and `WizardDraft.printifyDraftProductId` store one Printify preview product.
- `MockupJob` belongs to a draft but not to a design.
- `Listing.wizardDraftId` is unique, so one draft can create only one listing.
- Step 3 reads the latest draft-level mockup job.
- The publish worker reads the latest completed draft-level mockup job and `draft.design`.

The implementation must break these assumptions without breaking old drafts and listings.

## Chosen Approach

Use `WizardDraft` as the wizard run container and add ordered child rows for the selected designs.

`WizardDraft` keeps shared state:

- tenant, store, template
- selected color IDs and sizes
- placement override
- AI content
- current step and status
- stale mockup flags
- legacy primary `designId`

`WizardDraftDesign` owns per-design state:

- selected design and sort order
- Printify uploaded image ID for that design
- Printify draft product ID for that design
- mockup jobs for that design
- listings for that design

This keeps the user-facing flow as one wizard run while making per-design Printify and publish state explicit.

## Data Model

Add `WizardDraftDesign`:

```prisma
model WizardDraftDesign {
  id                    String   @id @default(cuid())
  draftId               String   @map("wizard_draft_id")
  designId              String   @map("design_id")
  sortOrder             Int      @default(0) @map("sort_order")
  printifyImageId       String?  @map("printify_image_id")
  printifyDraftProductId String? @map("printify_draft_product_id")
  lastError             String?  @map("last_error")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  draft   WizardDraft @relation(fields: [draftId], references: [id], onDelete: Cascade)
  design  Design      @relation(fields: [designId], references: [id], onDelete: Cascade)
  jobs    MockupJob[]
  listings Listing[]

  @@unique([draftId, designId])
  @@index([draftId, sortOrder])
  @@index([designId])
  @@map("wizard_draft_designs")
}
```

Add relations:

- `WizardDraft.draftDesigns WizardDraftDesign[]`
- `Design.draftDesigns WizardDraftDesign[]`

Update `MockupJob`:

- Add nullable `draftDesignId String? @map("wizard_draft_design_id")`.
- Add nullable `designId String? @map("design_id")` as a query convenience and to match the existing proposed API shape.
- New jobs set both fields.
- Old jobs leave both null and continue to be interpreted through `WizardDraft.designId`.
- Add indexes for `[draftId, draftDesignId, status]` and `[designId]`.

Update `Listing`:

- Remove the uniqueness constraint from `wizardDraftId`.
- Add nullable unique `wizardDraftDesignId String? @unique @map("wizard_draft_design_id")`.
- Keep `wizardDraftId` for draft-level grouping and legacy listings.
- Keep `designId` on listing and set it to the child design ID.
- Add `@@index([wizardDraftId])` if missing.

Legacy fields on `WizardDraft` remain:

- `designId` remains the primary design and equals the first `WizardDraftDesign`.
- `printifyImageId` and `printifyDraftProductId` remain for existing single-design drafts and fallback compatibility. New multi-design code writes per-design Printify state to `WizardDraftDesign`.

## Draft State API

Extend `DraftPatch` with `designIds?: string[]`.

`PATCH /api/wizard/drafts/:id` behavior:

1. Sanitize `designIds` through the existing whitelist.
2. Validate that the value is an array of unique strings with length 1-5 when present.
3. Verify all designs belong to the draft tenant and are active.
4. In a transaction:
   - delete child rows for designs no longer selected,
   - upsert selected child rows with sequential `sortOrder`,
   - set `WizardDraft.designId` to the first selected ID,
   - mark mockups stale when the selected design set changes.
5. Return the updated draft with `draftDesigns` included.

`GET /api/wizard/drafts/:id` includes:

```ts
draftDesigns: {
  include: { design: true, jobs: { include: { images: true } } },
  orderBy: { sortOrder: "asc" }
}
```

The migration backfills one `WizardDraftDesign` row for every existing draft that has `designId`. Read paths still keep a fallback to `draft.designId` as defensive compatibility for any draft created between deploy steps.

## Mockup Generation

Add a shared server service instead of duplicating the current long `POST /api/mockup-jobs` route.

Suggested modules:

- `loadMockupGenerationContext(draftId, tenantId)` loads draft, store, template, colors, custom mockup picks, and validates global prerequisites.
- `validateMockupGenerationContext(context)` handles template readiness, selected colors, variants, custom-source coverage, custom composite regions, Printify fallback env guards, and catalog color availability.
- `createPrintifyMockupJobForDraftDesign(context, draftDesign)` uploads the design to Printify, creates or updates that design's Printify draft product, creates `MockupJob`, and enqueues polling.

Existing `POST /api/mockup-jobs` becomes a compatibility wrapper for the primary child design or `draft.designId`.

New `POST /api/mockup-jobs/batch`:

Request:

```json
{ "draftId": "xxx" }
```

Behavior:

1. Authenticate and tenant-scope the draft.
2. Load selected `WizardDraftDesign` rows.
3. Validate global prerequisites once.
4. Process designs sequentially to avoid Printify rate limits.
5. For each design:
   - use the design's `storagePath`,
   - use the child row's cached Printify image and draft product IDs,
   - create a `MockupJob` linked to `draftDesignId` and `designId`,
   - enqueue the existing poll job with `mockupJobId`, `draftId`, `storeId`, and product ID.
6. Return created jobs and per-design failures.

Response:

```json
{
  "jobs": [
    {
      "jobId": "job_1",
      "draftDesignId": "wdd_1",
      "designId": "design_1",
      "designName": "Design A",
      "status": "running"
    }
  ],
  "failures": [
    {
      "draftDesignId": "wdd_2",
      "designId": "design_2",
      "designName": "Design B",
      "error": "Printify upload failed"
    }
  ]
}
```

Global validation failures return `400`. Partial per-design failures return `200` with `failures` so earlier successful jobs remain visible.

Update all mockup processing code that currently uses `mockupJob.draft.design` so it resolves the design in this order:

1. `mockupJob.draftDesign.design`
2. `mockupJob.design`
3. `mockupJob.draft.design`

This affects custom composite workers, mockup image regeneration, manual mockup image routes, and publish selection.

## Step 2 UI

Step 2 becomes a bounded multi-select design picker.

Behavior:

- Initialize selected IDs from `draft.draftDesigns`.
- Fall back to `[draft.designId]` for legacy drafts.
- Toggle card click to add/remove a design.
- Limit selection to five designs.
- Disable unselected cards when five are already selected.
- Show header text `Chọn Design (N/5 đã chọn)`.
- Show subtitle `Chọn 1-5 designs để tạo listing`.
- Show a selected strip with thumbnail, name, and remove button.
- Save with `updateDraft({ designIds: selectedDesignIds })`.
- Keep `draft.designId` synchronized to the first selected design for compatibility.

The next-step gate must require at least one selected design, using `draftDesigns.length > 0 || Boolean(draft.designId)`.

## Step 3 UI

Step 3 remains the shared mockup setup screen:

- template selection
- color selection
- size selection
- mockup source selection
- placement editor
- live preview

Auto-trigger:

- On mount, after draft/template/color/size state is loaded, Step 3 checks selected child designs.
- If no current running or completed jobs exist for the selected design set, or if `draft.mockupsStale` is true, it calls `POST /api/mockup-jobs/batch`.
- It should avoid duplicate auto-trigger by using a local `hasTriggeredBatchRender` flag and by checking active jobs.

Progress:

- Replace single `mockupJobId`, `jobStatus`, and `jobProgress` state with a map keyed by `draftDesignId`.
- Poll `/api/mockup-jobs/:id` for each active job.
- Show a loading panel with one row per selected design:
  - thumbnail/name
  - status
  - completed/total/failed counts
  - progress bar
  - error message if failed

Results:

- Group results by design.
- Use tabs or a segmented control for selected designs.
- Reuse the existing color mockup cards inside the active design group where possible.
- Keep `Tạo lại Mockups` as batch retry for all selected designs in the first implementation.

Completion:

- A design is complete when its latest job is terminal or all images have completed/failed.
- The screen may allow moving forward when every selected design has at least one included mockup for every selected color, subject to the existing checklist rules.

## Step 4 UI

Step 4 continues to generate one shared AI content payload.

The generation input uses the primary design:

- first `draftDesigns` row if present,
- otherwise `draft.design`.

No separate AI content is generated per design in this feature.

## Step 5 UI

Step 5 becomes a batch review and publish screen.

Review:

- Group mockups by design using `draftDesignId`.
- Show tabs or grouped sections per design.
- Keep carousel behavior within the active design group, or flatten thumbnails with design labels if that is simpler.
- Summary shows:
  - number of designs
  - selected colors
  - selected sizes
  - selected mockup image count
  - `N designs x M colors = N listings, M color variants per listing`

Price:

- Step 5 currently lets the user edit price locally. For this feature, publish must either accept `priceUsd` from the client and apply it to all listings, or the field should be made read-only.
- Recommended: `POST /publish` accepts optional validated `priceUsd` and applies it to all listings.

Publish:

- `POST /api/wizard/drafts/:id/publish` creates or returns one listing per `WizardDraftDesign`.
- The response returns an array:

```json
{
  "listings": [
    {
      "listingId": "listing_1",
      "draftDesignId": "wdd_1",
      "designId": "design_1",
      "status": "PUBLISHING",
      "alreadyPublished": false
    }
  ]
}
```

Progress:

- Run the existing publish worker once per listing.
- SSE events should include `listingId`, `draftDesignId`, and `designId`.
- Step 5 shows per-listing rows so one design can fail without hiding successful designs.

Retry and force republish:

- Retry Printify should operate on a specific listing.
- Force republish should operate on a specific listing in the first implementation. Batch force-republish is out of scope.

## Publish Worker

Update `runPublishWorker` and Printify retry flows to use listing-specific design and mockup state.

Required behavior:

- Load listing with `wizardDraftDesign`, `design`, variants, and publish jobs.
- Resolve the design from `listing.wizardDraftDesign.design` first, then `listing.designId`, then legacy `draft.design`.
- Resolve mockup images from latest completed job for `listing.wizardDraftDesignId` first.
- Do not use the draft's latest completed job for new multi-design listings.
- Use `WizardDraftDesign.printifyDraftProductId` and `WizardDraftDesign.printifyImageId` when publishing that design to Printify.
- If a stale Printify draft product must be cleared, clear the child row's product ID. Only clear `WizardDraft.printifyDraftProductId` for legacy listings.

Idempotency:

- Generate idempotency keys from `draftId`, `draftDesignId`, tenant ID, and stage.
- Existing single-design listings continue using the old draft-level key path.

Draft status:

- Mark the draft `PUBLISHED` only when all child listings have reached a terminal success or partial-success state.
- If some listings fail, keep enough status detail in listing rows and publish jobs for Step 5 to report partial completion.

## Checklist And Gates

Update `buildChecklist` to evaluate every selected design.

Checklist rules:

- `mockupsMatchColors`: every selected design has included real/custom mockup coverage for every selected color.
- `contentComplete`: unchanged; one shared content payload.
- `placementValid`: validate the shared placement using the primary design metadata. If future designs have different aspect ratios, the implementation can expand this to validate all designs, but the first version follows the existing primary-design behavior.
- `mockupsNotStale`: unchanged draft-level stale flag.
- `readyToPublish`: all checks pass.

Step layout gates:

- Step 2 complete: at least one selected design.
- Step 3 complete: every selected design has required mockup coverage.
- Step 4 complete: shared AI content complete.
- Step 5 publish enabled: checklist ready.

## Analytics And Existing References

Existing analytics map listings to drafts and drafts to `designId`. Multi-design listings should prefer `Listing.designId`.

Follow-up updates:

- Update analytics queries to use `listing.designId` directly when present.
- Fall back to draft primary design for old listings.
- Keep `DesignUsage` behavior unchanged unless implementation discovers it is currently populated during publish.

## Error Handling

Batch mockup generation:

- Global missing prerequisites fail the request.
- Per-design Printify failures are returned in `failures`.
- Step 3 displays failed rows and keeps successful jobs visible.
- First implementation only needs a batch retry button.

Publish:

- Listing creation should be transactional per design so one invalid child does not duplicate other listings.
- Worker failures update only the affected listing and publish jobs.
- SSE events include enough identifiers for the UI to update the correct row.

Compatibility:

- Old drafts with only `designId` still load.
- Old mockup jobs without `draftDesignId` still display.
- Old listings without `wizardDraftDesignId` still retry/force-republish through the legacy draft path.

## Files Expected To Change

- `prisma/schema.prisma`
- new Prisma migration
- `src/lib/wizard/state.ts`
- `src/lib/wizard/use-wizard-store.ts`
- `src/app/api/wizard/drafts/[id]/route.ts`
- `src/app/api/mockup-jobs/route.ts`
- new `src/app/api/mockup-jobs/batch/route.ts`
- `src/app/api/mockup-jobs/[id]/route.ts`
- mockup worker and helper modules that resolve design files
- `src/app/api/wizard/drafts/[id]/checklist.ts`
- `src/app/api/wizard/drafts/[id]/publish/route.ts`
- `src/lib/publish/worker.ts`
- retry/force-republish routes as needed
- `src/app/(authed)/wizard/[draftId]/layout.tsx`
- `src/app/(authed)/wizard/[draftId]/step-2/page.tsx`
- `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`
- `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`
- `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`
- focused tests for state, routes, checklist, mockup grouping, and publish idempotency

## Testing Plan

Automated:

- Prisma migration generation and client generation.
- Unit tests for `sanitizeDraftPatch` and `updateDraft({ designIds })`.
- Route tests for draft PATCH/GET multi-design payloads.
- Route/service tests for batch mockup generation, including partial per-design failures.
- Checklist tests for all selected designs requiring mockup coverage.
- Publish route tests for idempotent N-listing creation.
- Publish worker tests for selecting mockups and Printify product state by `wizardDraftDesignId`.
- `npm run build`.

Manual:

1. Old single-design draft loads and publishes through the legacy path.
2. Step 2 selects 1 design, saves, reloads, and still works.
3. Step 2 selects 5 designs, disables additional selections, then re-enables after removing one.
4. Step 3 auto-starts batch mockup generation once.
5. Step 3 shows independent progress for every selected design.
6. Step 3 groups completed mockups by design.
7. Regenerate creates new jobs for every selected design.
8. Step 5 shows `N designs x M colors`.
9. Publish creates N listings with the correct `designId`.
10. A per-design failure is displayed without hiding successful designs.

## Out Of Scope

- Per-design AI content.
- Per-design template/color/placement choices.
- Parallel Printify product creation.
- More than five designs.
- Batch force-republish UX beyond what is needed to retry individual listing failures.
