# Printify Shopify Sync Stuck Design

Date: 2026-07-23
Status: Approved for implementation

## Problem

A Printify Shopify-channel publish can remain `is_locked = true` without producing a
Shopify product. The worker currently waits ten minutes, records a partial failure, then
lets BullMQ retry the complete ten-minute wait up to five times. Wizard Step 5 treats a
terminal listing with any active attempt pointer as publishing, so the user sees a generic
spinner for close to an hour.

The Printify request gate is also closed before the Shopify-sync poll finishes. The HTTP GET
still runs, but every poll bypasses cooldown protection and logs `Connection is closed`.

## Approved Behavior

- Keep one bounded Shopify-sync wait per publish attempt. A sync timeout is terminal for
  automatic retry because re-running the same wait cannot change the already-submitted
  Printify publish and can occupy a worker for another ten minutes.
- Persist `SHOPIFY_SYNC_TIMEOUT` as the stable failure code and expose a Vietnamese terminal
  message. Do not automatically create, delete, or republish a Printify or Shopify product.
- Keep the Printify client/request gate open through Shopify matching and optional Printify
  unpublish, then close it exactly once in `finally`.
- Whenever a persisted stage is moved back to `RUNNING`, clear stale completion, retry, and
  error fields.
- Wizard Step 5 may show retrying only when the selected attempt has a genuinely
  `PENDING`, `RUNNING`, or `RETRY_SCHEDULED` job. A stale active pointer alone must not keep
  the UI spinning.
- Reconciliation must call the existing idempotent finalizer with
  `SHOPIFY_SYNC_TIMEOUT` before throwing BullMQ `UnrecoverableError`. The attempt becomes
  `FAILED`, the listing remains strategy-correct (`PARTIAL_FAILURE` for this case), and
  `activePublishAttemptId` is cleared without waiting for a fifth attempt.

## Non-Goals

- No Prisma migration.
- No production DB repair, worker restart, deploy, or manual republish.
- No automatic replacement product creation.
- No change to rate-limit, merchant-lock, Direct Shopify, media, collection, or sales-channel
  retry contracts.

## Verification

- A Shopify sync timeout is persisted with `SHOPIFY_SYNC_TIMEOUT`.
- Reconciliation converts that code to BullMQ `UnrecoverableError`, preventing normal
  five-attempt retry.
- The Printify request gate is closed only after all channel work exits.
- Rerun state has no stale `completedAt`, `nextRetryAt`, reason code, or last error.
- Step 5 does not show retrying for a terminal listing whose selected jobs are terminal.
- Focused publish tests, the production build, Prisma validation, and `git diff --check` pass.
