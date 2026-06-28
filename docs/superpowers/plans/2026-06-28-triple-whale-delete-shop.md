# Triple Whale Delete Shop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add row-level Triple Whale shop deletion that clears stats, credential, and pending sync jobs.

**Architecture:** Reuse the existing DELETE route and table action area. Add one queue helper that scans removable BullMQ states and removes jobs matching the credential id.

**Tech Stack:** Next.js route handlers, React client component, BullMQ, Prisma, Vitest source tests.

---

### Task 1: Backend Cleanup

**Files:**
- Modify: `src/lib/triple-whale/queue.ts`
- Modify: `src/app/api/integrations/triple-whale/[storeId]/route.ts`
- Test: `tests/triple-whale-delete-shop-source.test.ts`

- [ ] Add a source test asserting the DELETE route calls `removePendingTripleWhaleSyncJobs`, deletes stats, then deletes credential.
- [ ] Add `removePendingTripleWhaleSyncJobs(credentialId)` to `src/lib/triple-whale/queue.ts`.
- [ ] In DELETE route, call the helper before DB deletes.
- [ ] Run `npx vitest run tests/triple-whale-delete-shop-source.test.ts`.

### Task 2: Row UI Action

**Files:**
- Modify: `src/app/(authed)/integrations/triple-whale/TripleWhaleClient.tsx`
- Modify: `tests/triple-whale-ui-source.test.ts`

- [ ] Add `deleteOne(cred)` near `syncOne`.
- [ ] Add a trash icon button in the table row action group.
- [ ] Confirm with native `confirm()`.
- [ ] Call DELETE endpoint, toast, then reload.
- [ ] Update UI source test to assert the row delete action.
- [ ] Run `npx vitest run tests/triple-whale-ui-source.test.ts`.

### Task 3: Verify

- [ ] Run `npx vitest run tests/triple-whale-delete-shop-source.test.ts tests/triple-whale-ui-source.test.ts`.
- [ ] Run `npm run build`.
