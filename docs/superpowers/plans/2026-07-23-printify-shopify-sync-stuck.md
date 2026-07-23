# Printify Shopify Sync Stuck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a Printify-to-Shopify sync timeout from rerunning the same ten-minute wait five times or leaving Wizard Step 5 spinning from a stale active pointer.

**Architecture:** Preserve the existing Printify-first flow and durable attempt finalizer. Classify the already-bounded Shopify sync timeout as terminal for BullMQ, keep the Printify request gate alive for the entire channel flow, reset stale stage metadata on rerun, and require actual runnable job state before Step 5 renders retry progress.

**Tech Stack:** TypeScript, Next.js App Router Client Component, Prisma/PostgreSQL, BullMQ/Redis, Node test runner through `tsx --test`.

## Global Constraints

- Do not create, delete, or republish an external product automatically.
- Do not add a Prisma migration.
- Use top-level static imports only.
- Do not deploy, restart production, mutate production data, stage, or commit.

---

### Task 1: Terminal Shopify Sync Timeout Contract

**Files:**
- Modify: `src/lib/publish/errors.ts`
- Modify: `src/lib/publish/errors.test.ts`
- Modify: `src/lib/jobs/workers/publish-worker.ts`
- Modify: `src/lib/jobs/workers/publish-worker.test.ts`

**Interfaces:**
- Produces: stable `SHOPIFY_SYNC_TIMEOUT` user message and an `UnrecoverableError` when reconciliation sees that code on a failed stage.

- [x] **Step 1: Write failing tests**

Assert that the timeout message is terminal and that reconciliation selects
`lastErrorCode`, checks `SHOPIFY_SYNC_TIMEOUT`, and throws `UnrecoverableError`.

- [x] **Step 2: Verify RED**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/errors.test.ts src/lib/jobs/workers/publish-worker.test.ts
```

Expected: failure because reconciliation does not yet read or terminalize the code.

- [x] **Step 3: Implement minimal behavior**

Change the timeout user copy so it does not promise another automatic retry. Select
`lastErrorCode` in reconciliation; for `SHOPIFY_SYNC_TIMEOUT`, call
`finalizeFailedPublishAttemptIdempotently(...)` with the stable code and existing user
message before throwing `new UnrecoverableError(message)`.

- [x] **Step 4: Verify GREEN**

Run the same focused test command and expect all tests to pass.

### Task 2: Persist Timeout And Keep Request Gate Alive

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/lib/publish/worker.test.ts`

**Interfaces:**
- Consumes: `ShopifySyncTimeoutError` and `SHOPIFY_SYNC_TIMEOUT`.
- Produces: terminal stage metadata and exactly-once `closePrintifyClient()` cleanup.

- [x] **Step 1: Write failing tests**

Assert that the Shopify sync catch maps `ShopifySyncTimeoutError` to
`lastErrorCode: "SHOPIFY_SYNC_TIMEOUT"` and that the channel flow closes the Printify
client in `finally`, after sync/unpublish work.

- [x] **Step 2: Verify RED**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: failure because the timeout code is not persisted and the client closes before polling.

- [x] **Step 3: Implement minimal behavior**

Wrap the post-client channel body in `try/finally`, remove early closes, and close once in
the outer `finally`. Persist the stable timeout code only for `ShopifySyncTimeoutError`;
other failures retain their current classification.

- [x] **Step 4: Verify GREEN**

Run the worker test and expect all tests to pass.

### Task 3: Clean Rerun State And Honest Step 5 Retry UI

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`
- Modify: `src/app/(authed)/wizard/[draftId]/step-5-source.test.ts`

**Interfaces:**
- Produces: clean stage metadata when `RUNNING` and UI retry state derived from runnable jobs.

- [x] **Step 1: Write failing tests**

Assert that stage reruns clear `completedAt`, `nextRetryAt`, `reasonCode`, and
`lastErrorCode`, and that `hasActiveRetry` requires `hasRunningJob`.

- [x] **Step 2: Verify RED**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts 'src/app/(authed)/wizard/[draftId]/step-5-source.test.ts'
```

Expected: failure because stale metadata is retained and a pointer alone enables retry UI.

- [x] **Step 3: Implement minimal behavior**

Clear stale fields in both the initial Shopify-stage reset and the `RUNNING` transition.
Change Step 5 retry detection to require active attempt pointer, terminal retryable listing
status, and a selected runnable job.

- [x] **Step 4: Verify GREEN**

Run the same focused tests and expect all tests to pass.

### Task 4: Full Verification

**Files:**
- Verify all modified files.

- [x] **Step 1: Run focused publish tests**

```bash
./node_modules/.bin/tsx --test src/lib/publish/errors.test.ts src/lib/publish/shopify-sync.test.ts src/lib/jobs/workers/publish-worker.test.ts src/lib/publish/worker.test.ts 'src/app/(authed)/wizard/[draftId]/step-5-source.test.ts'
```

- [x] **Step 2: Run build and schema checks**

```bash
pnpm run build
pnpm exec prisma validate
git diff --check
```

- [x] **Step 3: Review the diff**

Confirm there are no external calls, schema changes, unrelated formatting, dynamic imports,
or production/deploy changes.
