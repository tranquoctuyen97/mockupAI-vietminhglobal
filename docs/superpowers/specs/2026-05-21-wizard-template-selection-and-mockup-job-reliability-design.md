# Wizard Template Selection and Mockup Job Reliability Design

**Status:** Approved for implementation plan
**Date:** 2026-05-21
**Scope:** Wizard Step 3 template selection, mockup generation loading reliability, and PM2 worker process setup
**Commit policy:** Do not commit. User requested no commit in this thread.

---

## Problem

Wizard Step 3 currently uses the store default template implicitly. The user can create multiple mockup templates in Store Settings, but the Wizard does not expose a place to choose one. That makes the "default" template carry two jobs:

1. It is the fallback template for fast Wizard flow.
2. It becomes the only usable template from the Wizard UI.

That is now too restrictive. If a store has multiple ready templates, such as Tee, Tank, Hoodie, or different placement setups, the user should not need to change the global default just to create one listing.

The second issue is mockup generation loading forever. `POST /api/mockup-jobs` creates a `MockupJob` as `running` with `totalImages = 0`, then enqueues `poll-printify-mockups` in `printify-mockup-poll-queue`. The Step 3 UI polls the job and keeps showing `Dang tao... (0/...)` while the job is non-terminal. If the Printify poll worker is not running, Redis does not process the job, or the job never updates itself to `failed`, the UI has no terminal path.

There is also an operations gap: `ecosystem.config.js` only runs the Next.js web process, and `start-worker.ts` starts the composite worker and Triple Whale sync worker but not the Printify mockup poll worker. Instrumentation starts the poll worker in some server contexts, but production PM2 should have an explicit worker process.

---

## Goals

- Let the Wizard choose a mockup template per draft.
- Keep default template as a convenience fallback, not the only path.
- Only allow ready templates for mockup generation.
- Persist `templateId` on the draft so mockup generation and publish use the selected template.
- Reset dependent selections when the template changes.
- Ensure PM2 starts a dedicated worker process.
- Ensure the worker entrypoint consumes `printify-mockup-poll-queue`.
- Prevent Step 3 from spinning forever when a mockup job stays `running,totalImages=0`.
- Keep changes scoped to Wizard Step 3, mockup job reliability, and worker setup.

## Non-Goals

- Do not redesign Store Settings.
- Do not change the default-template rules already implemented for Store Settings.
- Do not auto-change a store's global default when the user chooses a Wizard template.
- Do not rebuild Printify polling or queue architecture.
- Do not add a full worker dashboard.
- Do not implement new E2E tests unless the project already has a reliable E2E harness available.

---

## UX Design

### Template Selector Placement

Add a compact `Mockup template` section at the top of Wizard Step 3, above the current left-column panels for colors, sizes, and placement.

Why Step 3:

- Template choice changes colors, sizes, placement, and preview.
- The user can immediately see the impact in Live Preview.
- Step 1 should remain focused on choosing the Shopify store.

### Selector Behavior

When Step 3 loads:

1. Load all templates for the selected store.
2. If `draft.templateId` is set and the template still exists, select it.
3. Otherwise select the store default template for display.
4. If the selected template is incomplete, show it but disable `Tao Mockups`.
5. Let the user switch to any ready template.

Template rows/options show:

- Template name.
- `DEFAULT`, `READY`, or `INCOMPLETE` label.
- Blueprint title and print provider title.
- Color count.
- Size count.
- Placement count.

Incomplete templates are visible but disabled. Admin users get a link to Store Settings. Non-admin users see a short message saying the preset is managed by Admin.

### Template Change Behavior

Changing template is a draft-level change, not a global store setting.

When the user chooses a different template:

- Save `templateId` to the wizard draft.
- Replace selected colors with the selected template's color ids.
- Replace selected sizes with the selected template's enabled sizes.
- Clear `enabledVariantIdsOverride`.
- Clear `placementOverride`.
- Clear local mockup job/gallery state so old mockups are not presented as current.
- Mark existing mockups stale on the server.
- Refetch sizes with `templateId`.
- Recompute placement preview from the selected template's `defaultPlacement`.

### Generate Button States

`Tao Mockups` is enabled only when:

- Draft has a design.
- A ready template is selected.
- At least one color is selected.
- Placement exists for the selected template or draft override.
- The job is not currently generating.

If a job waits too long with no progress:

- Show a clear warning first: "Printify dang render lau hon binh thuong..."
- If it reaches a hard stall threshold, stop the loading state and show a retry action.
- Do not silently reload the page.

---

## Data and API Design

### Template List API

Add `GET /api/stores/:id/mockup-templates`.

The existing route already handles create/update for templates. The new GET should:

- Validate session.
- Validate store belongs to the tenant.
- Return templates ordered by `sortOrder`.
- Include template colors via `TemplateColor.color`.
- Include readiness computed with `getTemplateReadiness`.
- Include missing fields and a label for UI.

Response shape:

```ts
type StoreTemplateListResponse = {
  templates: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    sortOrder: number;
    printifyBlueprintId: number | null;
    printifyPrintProviderId: number | null;
    blueprintTitle: string;
    printProviderTitle: string;
    enabledVariantIds: number[];
    enabledSizes: string[];
    defaultPlacement: unknown | null;
    readiness: {
      ready: boolean;
      missing: string[];
      label: "DEFAULT" | "DEFAULT INCOMPLETE" | "READY" | "INCOMPLETE";
    };
    colors: Array<{
      id: string;
      name: string;
      hex: string;
      enabled: boolean;
      sortOrder: number;
    }>;
  }>;
};
```

Step 3 should stop relying on `GET /api/stores/:id/template` for the active template. That endpoint can remain for compatibility, but Step 3 should use the template list.

### Sizes API

Continue using `GET /api/stores/:id/sizes?templateId=:templateId`.

This endpoint already supports `templateId`. Step 3 must pass the selected template id instead of using the default implicitly.

### Draft State

The Prisma schema already has `WizardDraft.templateId`. Server-side draft sanitization already allows `templateId`, but the client `DraftData` type should be updated so Step 3 can use it safely.

`Step1StorePage` should reset `templateId` to `null` when the store changes.

`updateDraft` should validate template ownership when `templateId` is provided:

- The template must exist.
- It must belong to the selected draft store.
- The store must belong to the same tenant.

When `templateId` or `enabledSizes` changes, existing mockups should become stale. The current database trigger handles store, design, colors, variants, and placement, but not `template_id` or `enabled_sizes`. The implementation can handle this in `src/lib/wizard/state.ts` by setting `mockupsStale = true` and `mockupsStaleReason = "template_changed"` when the patch changes the selected template.

### Mockup Generation API

`POST /api/mockup-jobs` already prioritizes `draft.template` and falls back to the store default. Add stricter server-side validation before creating a Printify product:

- Selected template must be ready.
- Selected colors must all belong to the selected template.
- `enabledVariantIds` must be non-empty.
- Placement must be present.

This prevents the UI from being the only guard.

---

## Mockup Job Reliability Design

### Worker Process

PM2 should run two processes:

1. `mockupai` web process: existing `start.sh`.
2. `mockupai-worker` worker process: `npm run worker`.

`start-worker.ts` must start:

- `startMockupCompositeWorker()`
- `startPrintifyMockupPollWorker()`
- `startTripleWhaleSyncWorker()`

It should handle both `SIGINT` and `SIGTERM` and close all workers before exit.

### Stall Handling

Add shared constants/helper in `src/lib/mockup/job-timeout.ts`:

- `MOCKUP_JOB_SOFT_WAIT_MS = 120_000`
- `MOCKUP_JOB_STALL_MS = 360_000`

The soft wait is UI-only. The hard stall is server-side.

`GET /api/mockup-jobs/:id` should mark a job as failed if:

- Status is `pending` or `running`.
- `totalImages === 0`.
- Age since `createdAt` is greater than `MOCKUP_JOB_STALL_MS`.

Failed message:

```txt
Printify mockup job did not produce images in time. Worker may be offline or Printify may be delayed. Please retry.
```

Step 3 should show a soft warning after `MOCKUP_JOB_SOFT_WAIT_MS` without stopping the poll immediately. Once the API marks the job `failed`, Step 3 stops loading and shows retry.

This makes the behavior deterministic:

- Normal Printify completion ends as `completed`.
- Worker/Printify errors end as `failed`.
- No worker/no DB update eventually ends as `failed`.
- UI never spins forever.

---

## Error Handling

Template errors:

- No store selected: existing Step 3 message remains.
- No templates: show "Store chua co template. Vao Store Settings de tao template."
- All templates incomplete: show warning and disable generate.
- Selected template deleted: fallback to default for display and ask user to choose a ready template.
- Selected colors not in selected template: server returns 400 with clear message.

Worker/generation errors:

- `POST /api/mockup-jobs` validation errors are shown in Step 3 alert.
- Polling network errors stop local spinner and show retry.
- Backend-stalled jobs return `failed`, not `running`.
- Old completed mockups from another template are not shown as current after template switch.

---

## Testing Strategy

Automated tests:

- Template readiness tests remain the source of truth for ready/incomplete labels.
- Add route/source tests for `GET /api/stores/:id/mockup-templates` serialization.
- Add `updateDraft` tests for keeping `templateId`, rejecting invalid template ownership if practical with current test setup, or at minimum source-level assertions if DB test harness is not available.
- Add mockup timeout helper tests.
- Add route/source test that `GET /api/mockup-jobs/:id` calls the timeout helper.
- Add source-level test that `start-worker.ts` starts `startPrintifyMockupPollWorker`.

Manual verification:

- Store with one ready default template: Step 3 behaves like today, plus a compact template display.
- Store with multiple ready templates: switching template changes colors, sizes, placement, and persists on draft.
- Store default incomplete but another template ready: user can choose the ready template without changing global default.
- Click `Tao Mockups`: job progresses or fails clearly, never spins forever.
- PM2 `pm2 start ecosystem.config.js` shows both `mockupai` and `mockupai-worker`.
- Worker logs show Printify mockup poll worker ready.

Known unrelated verification caveat:

- `npm run build` currently fails on an unrelated TypeScript issue in `scripts/simulate-printify-publish.ts` where `store.include.template` should be `templates`. This spec does not fix that unless the user expands scope.

---

## Acceptance Criteria

- Wizard Step 3 has a visible mockup template selector/display.
- Selecting a template saves `draft.templateId`.
- Template switch resets dependent draft fields and local mockup state.
- Generate uses the selected template.
- Generate is blocked for incomplete templates.
- Server rejects invalid/incomplete template usage.
- PM2 config includes a worker process.
- Worker entrypoint starts the Printify mockup poll worker.
- A mockup job stuck with `totalImages=0` becomes failed after the hard stall threshold.
- UI stops loading and shows retry when a job fails.
- No commits are made.
