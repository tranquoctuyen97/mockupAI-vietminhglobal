# Store Template Action Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Store Config visible while template row actions run, using row/action loading and silent refresh instead of full-page spinner.

**Architecture:** Extend the existing `fetchStore` callback with a silent mode, pass silent refresh into `TemplatesSection`, and track row-level actions locally in the table.

**Tech Stack:** Next.js App Router, React client component state, TypeScript.

**Commit Policy:** Do not commit unless the user explicitly asks.

---

### Task 1: Silent Refresh Hook

**Files:**
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx`

- [ ] Update `fetchStore(options?: { silent?: boolean })` so it only calls `setLoading(true/false)` for non-silent refreshes.
- [ ] Update `refreshAndGoTo()` and `TemplatesSection` prop typing to accept `onRefreshStore(options?: { silent?: boolean })`.

### Task 2: Row Action Loading

**Files:**
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx`

- [ ] Add `TemplateAction` state inside `TemplatesSection`.
- [ ] Wrap `handleDuplicate`, `handleSetDefault`, `handleDelete`, and `handleSaveTemplate` refreshes with `onRefreshStore({ silent: true })`.
- [ ] Disable row buttons while that row has an in-flight action.
- [ ] Show a small spinner icon in the active action button.

### Task 3: Verification

**Files:**
- All changed files.

- [ ] Run `git diff --check`.
- [ ] Run `./node_modules/.bin/tsx --test src/lib/stores/template-readiness.test.ts src/lib/stores/store-service-default.test.ts`.
- [ ] Run `npm run build`; if it still fails on known `scripts/simulate-printify-publish.ts:49`, report it as unrelated.
