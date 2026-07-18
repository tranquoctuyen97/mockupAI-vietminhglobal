# Printify Publish Queue, Rate Limit, and Stuck Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Printify/Shopify publish durable, retryable, idempotent, and observable without leaving Wizard Step 5 stuck in `PUBLISHING`.

**Architecture:** Harden the Printify client and publish idempotency before enabling BullMQ retries. Move publish work into a BullMQ queue only after retryable errors are rethrown, fatal errors are marked unrecoverable, duplicate product creation is prevented, enqueue is durable or compensated, and user-facing status is separated from technical error detail. Coordinate Printify load by Merchant account, not by store or token, and distinguish endpoint rate-limit behavior instead of applying the product publishing quota to image uploads.

**Tech Stack:** Next.js App Router route handlers, Prisma/PostgreSQL, BullMQ/Redis, Printify REST API with PAT auth, Shopify Admin GraphQL, existing SSE channels, Node built-in test runner through `tsx --test`.

**Docs checked:** Context7 resolved Printify docs to `/websites/developers_printify`; current docs state PAT bearer authentication, scopes, required request metadata including `User-Agent`, global `600 requests/minute/account`, catalog `100 requests/minute/account`, product publishing `200 requests/30 minutes/account`, and `429` on exceeded limits. BullMQ docs confirm retries happen only when the processor throws, `moveToDelayed(..., token)` must be followed by `DelayedError`, special delayed errors do not consume normal `attemptsMade` so `maxStartedAttempts` is needed, and stalled/max-started failures can move a job to failed outside the business finalizer. Prisma docs confirm one-to-one relations require a unique foreign key side. Redis distributed lock docs require atomic release and renewal for long work.

**User constraint:** This is a plan for approval. Do not implement code, do not run production recovery SQL, and do not `git add` or commit unless the user explicitly approves execution.

---

## Verified Current State

- Correct repo: `/Users/tuyen.tq/Documents/freelancer/vietminhglobal/app`.
- Production app path checked earlier: `/root/code/mockupAI-vietminhglobal`.
- Publish route currently creates listing rows and then calls `void runPublishWorkersWithConcurrency(...)` from `src/app/api/wizard/drafts/[id]/publish/route.ts`.
- `runPublishWorkersWithConcurrency(...)` directly calls `runPublishWorker(...)` inside the Next.js web process. Publish is not BullMQ-backed.
- `start-worker.ts` starts mockup, Printify mockup poll, Triple Whale, mailbox sync, mailbox backfill, response metrics, and Gmail label workers. It does not start a publish worker.
- `retryWithBackoff(...)` in `src/lib/publish/worker.ts` uses in-process sleep and updates `publish_jobs.attempts`; BullMQ does not own publish retry today.
- `runPublishWorker(...)` catches unexpected errors, updates `listing.status = FAILED`, emits `publish.failed`, and does not rethrow. A BullMQ processor that simply returns `runPublishWorker(...)` would mark the job complete, not retry.
- `ensurePrintifyImage(...)` in `src/lib/printify/product.ts` falls back from URL upload to base64 for every URL upload error, including 401, 403, 429, 5xx, and unknown network errors.
- `PrintifyClient.request(...)` currently maps both 401 and 403 to the same auth error text and does not preserve endpoint, method, response body, request id, or retry-after metadata.
- Printify request headers currently include `Authorization` and `Content-Type`; the shared client needs `User-Agent`, and any older direct Printify `fetch(...)` path also needs it.
- Step 5 persisted state renders `PUBLISHING` when any publish job is `PENDING` or `RUNNING`, even if the listing is already `FAILED`.
- The two inspected wizard failures had `listing.status = FAILED`, `PRINTIFY` job still `RUNNING`, and `SHOPIFY` job still `PENDING`, causing the stuck UI.
- Variant cache for blueprint `12` / provider `99` was already fresh, so those two wizard cases did not need catalog or dummy product cache requests before upload.
- Each inspected wizard likely reached only about two Printify upload requests before failure: URL upload got 429, base64 fallback called the same upload endpoint and failed. Those two wizards did not themselves exceed `600/minute` or `200 publish requests/30 minutes`.

---

## Non-Negotiable Corrections From Review

- Do not describe upload 429 as hitting the product publishing `200 requests/30 minutes` limit. That quota is for the product publishing endpoint, not `/uploads/images.json`.
- Rate-limit coordination must model Printify Merchant account quota, not token quota. One Merchant account can have multiple PATs; creating another PAT does not create more quota.
- Do not enable BullMQ automatic retries until publish is idempotent enough to avoid duplicate Printify or Shopify products.
- Do not use a fixed `jobId = publish-${listingId}` for all manual retries while retaining completed/failed jobs.
- Do not hold worker slots in a long `while (true) sleep` waiting for an account lock.
- Do not release Redis locks with non-atomic `GET` then `DEL`.
- Do not show raw technical error strings directly in Step 5 user UI.
- Do not run production recovery before the new queue contract and failure-state handling are deployed.
- Do not change publish business flow in this BullMQ phase. The API route changes from inline worker execution to outbox/BullMQ execution, but BullMQ must call the existing `runPublishWorker(...)` flow.
- Do not reorder Direct or Channel publish stages.
- Do not change Shopify mutations, `publishToShopify(...)`, `repairAndVerifyShopifyPostSync(...)`, WebP handling, option repair, variant-media attach, gallery reorder, or sales-channel publish ordering in this phase.
- Placement fixes, if needed, must be isolated to Printify placement payload helpers and tests; they must not add new production GET/verify stages or reorder publish calls.

---

## P0 Blockers Before Approval

The plan is not approved for implementation until these six blockers are represented in code tasks and tests:

1. `start-worker.ts` must start and stop the publish worker and outbox dispatcher. Enqueue without a consumer is a stuck publish by another name.
2. Step 5 progress must work across processes. Because `src/lib/sse/channel.ts` is in-memory, publish worker emissions cannot reach the web process. Use DB polling every 2-5 seconds while a publish attempt is active; keep SSE only as an optimization.
3. Add an explicit `PublishAttempt` model and scope every `PublishJob`, `PublishOutbox`, and worker mutation by `publishAttemptId`. Existing code that finds jobs by stage alone must be changed to use the active attempt.
4. Outbox dispatch must retry temporary Redis enqueue failures. Do not mark outbox `FAILED_TO_ENQUEUE` permanently on the first Redis failure.
5. Lock wait must use one concrete mechanism: `moveToDelayed(...)` plus `DelayedError`, with a bounded lock-wait counter. Do not sleep while holding an active worker slot.
6. Define acceptance behavior separately for `EXISTING_SHOPIFY_DIRECT` and `PRINTIFY_SHOPIFY_CHANNEL`. Direct creates the Shopify product itself, then still runs `runPrintifyStage()`, so Direct must use Printify lock/cooldown only around the Printify stage.

---

## Publish Flow Acceptance Matrix

| Requirement | `EXISTING_SHOPIFY_DIRECT` | `PRINTIFY_SHOPIFY_CHANNEL` |
| --- | --- | --- |
| Queue/outbox | Yes | Yes |
| Active attempt guard | Yes | Yes |
| Shopify product | App creates directly with Shopify GraphQL | Printify syncs to Shopify after Printify publish |
| Printify product | App creates/updates separately in `runPrintifyStage()` | App creates/updates, then calls Printify publish |
| Printify Merchant lock/cooldown | Yes, but only around Printify stage/API calls | Yes, around Printify upload/create/publish and short Printify GET calls |
| Long Shopify waits | No Printify lock | No Printify lock while waiting on Shopify sync/repair |
| Early ID persistence | Shopify product ID first, then Printify product ID | Printify product ID, then synced Shopify product ID |
| Variant mapping | Shopify variant plan/SKU, not index-only | Printify matrix to Shopify SKU mapping |
| Option/media/gallery repair | Required after Shopify create | Required after sync |
| Sales channel publish strictness | Required after repair | Required after sync/repair |
| Existing final checks | Preserve current behavior | Preserve current behavior |
| Shopify fail before Printify | `FAILED` | Not applicable in this order |
| Printify fail after Shopify success | `PARTIAL_FAILURE` | Printify fail before Shopify sync -> `FAILED` |
| Shopify sync/repair fail after Printify | Direct repair failure after Shopify product exists -> `PARTIAL_FAILURE`; before Shopify product exists -> `FAILED` | `PARTIAL_FAILURE` |
| Final `listing.status` | `ACTIVE`, `FAILED`, or `PARTIAL_FAILURE` | `ACTIVE`, `FAILED`, or `PARTIAL_FAILURE` |

---

## Retryability Contract

| Error | Retry behavior |
| --- | --- |
| Printify 429 | Delay with Merchant cooldown and `nextRetryAt` |
| Printify GET/network after product ID checkpoint | Retry |
| Printify create/update/publish timeout with ambiguous external write and no persisted product ID | Terminalize the attempt with manual-retry-required reason; do not use `RETRY_SCHEDULED`; throw `UnrecoverableError` after DB finalization |
| Printify 5xx before external write or after persisted checkpoint | Retry |
| Printify 401/402/403 | Fatal, no retry |
| Printify 400/422 | Fatal, no retry, except documented URL download failure `10300` fallback path |
| Shopify throttled/429 | Retry with Shopify throttle/backoff metadata |
| Shopify read/poll/throttle/network during sync polling | Retry |
| Shopify error before any external write | Retry |
| Shopify mutation timeout where it is unknown whether the mutation executed | Terminalize the attempt with manual-retry-required reason; do not use `RETRY_SCHEDULED`; throw `UnrecoverableError` after DB finalization |
| Shopify media mutation timeout after product exists | Terminalize the attempt with manual-retry-required reason and checkpoint-aware `PARTIAL_FAILURE`; require manual retry/recovery because media flow is not changed in this phase |
| Shopify 5xx/network after durable checkpoint and before non-idempotent media write | Retry only when the existing flow can resume without re-running succeeded non-idempotent stages |
| Shopify GraphQL userErrors validation | Fatal, no retry |
| Missing variant/SKU/config | Fatal, no retry |
| Shopify sync timeout | Retry only after product IDs/checkpoints are persisted enough to avoid duplicate products |
| Lock unavailable/cooldown active | Delay via `moveToDelayed(..., token)` + `DelayedError`, not normal attempt retry |

Every retry-scheduled DB state must store:

```text
status = RETRY_SCHEDULED
nextRetryAt
reasonCode
lastError = Vietnamese user-facing retry message
progressData.technicalError = sanitized metadata only
```

---

## File Structure

- Modify `src/lib/printify/client.ts`
  - Add `User-Agent`.
  - Add typed Printify errors.
  - Preserve endpoint, method, status, sanitized response summary, request id, and retry-after in milliseconds.

- Modify `src/lib/printify/product.ts`
  - Restrict URL-to-base64 fallback to documented remote image download failures.
  - Do not fallback for 401, 402, 403, 429, 422, 5xx, or unknown network failures.

- Modify `src/lib/publish/worker.ts`
  - Make publish stages idempotent before queue retries.
  - Keep `EXISTING_SHOPIFY_DIRECT` strategy-aware: Shopify stage first, then Printify stage with Printify lock/cooldown.
  - Persist Printify image IDs and product IDs immediately.
  - Persist Shopify product IDs immediately when discovered.
  - Remove nested retry ownership from non-idempotent write paths.
  - Rethrow retryable errors for BullMQ and throw `UnrecoverableError` for fatal errors.
  - Mark DB final failure only on final attempt, using strategy-aware final status rules.
  - Scope every publish job lookup/update by `publishAttemptId`.

- Create `src/lib/publish/errors.ts`
  - Map technical errors to stable error codes and Vietnamese user-facing messages.
  - Define `AmbiguousExternalWriteError` for writes that cannot be safely retried without changing the existing publish/media flow.

- Create `src/lib/publish/queue.ts`
  - Define publish queue, payload, and `publishAttemptId`-based job IDs.

- Create `src/lib/jobs/workers/publish-worker.ts`
  - BullMQ publish worker.
  - Calls queue-aware wrapper that handles final attempt failure state.

- Create `src/lib/publish/outbox.ts`
  - Transactional outbox helpers for durable enqueue.
  - Claims rows atomically, uses `PENDING` / `DISPATCHING` / `DISPATCHED` / `DEAD`, and retries temporary enqueue failures with `nextAttemptAt`.

- Modify `prisma/schema.prisma`
  - Add `PublishAttempt`.
  - Add `publishAttemptId` to `PublishJob`.
  - Add `PublishOutbox`.
  - Add fields needed for stable user error codes and active attempt guarding.

- Modify `src/app/api/wizard/drafts/[id]/publish/route.ts`
  - Write listing, active publish attempt, publish jobs, and outbox rows inside one DB transaction.
  - Return an existing active attempt on double-click instead of creating a second active attempt.
  - Do not call `runPublishWorker(...)` inline.

- Modify `src/app/api/listings/[id]/retry-printify/route.ts`
  - Create a new `publishAttemptId` and outbox row for manual retry.
  - Do not reuse a retained BullMQ job ID.
  - Do not create a new attempt when another attempt for the same listing is active.

- Modify `start-worker.ts`
  - Start and stop the publish worker.
  - Start and stop the outbox dispatcher/watchdog.
  - Log worker `ready`, `error`, and `failed` events.

- Create `src/lib/publish/merchant-account-lock.ts`
  - Redis lock by Merchant account identity.
  - Atomic Lua release.
  - Heartbeat renewal for long publish work.
  - If lock is unavailable, delay the job with `moveToDelayed(...)` and throw `DelayedError`; do not occupy an active worker slot.
  - Check and set Merchant account cooldown keys after 429.

- Modify `src/lib/printify/client.ts` and create `src/lib/printify/request-gate.ts`
  - Add `beforeRequest` and `onRateLimit` hooks to the shared Printify client.
  - Centralize cooldown checks in a request gate used by all Printify calls in Direct and Channel mode.

- Modify `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`
  - Render Vietnamese status/error messages from stable error codes.
  - Show "Đang thử lại" while BullMQ has attempts remaining.
  - Keep technical details out of normal user-facing text.
  - Poll the draft/listing status API every 2-5 seconds while publish is active because worker SSE events are cross-process.

- Tests:
  - `src/lib/printify/client.test.ts`
  - `src/lib/printify/product.test.ts`
  - `src/lib/publish/errors.test.ts`
  - `src/lib/publish/worker.test.ts`
  - `src/lib/publish/queue.test.ts`
  - `src/lib/publish/outbox.test.ts`
  - `src/lib/publish/merchant-account-lock.test.ts`
  - `src/lib/jobs/workers/publish-worker.test.ts`
  - `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`
  - `src/app/api/listings/[id]/retry-printify-route-source.test.ts`
  - `src/app/(authed)/wizard/[draftId]/step-5-source.test.ts`

---

## Phase 1: Harden Printify Client

### Task 1: Add User-Agent And Request Metadata To Printify Client

**Files:**
- Modify: `src/lib/printify/client.ts`
- Modify: `src/lib/printify/client.test.ts`

- [ ] **Step 1: Add a failing test that every request sends User-Agent**

Add to `src/lib/printify/client.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");

test("PrintifyClient sends a User-Agent on every request", () => {
  assert.match(source, /"User-Agent":/);
  assert.match(source, /PRINTIFY_USER_AGENT/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/printify/client.test.ts
```

Expected: FAIL if `User-Agent` is not set.

- [ ] **Step 3: Add User-Agent default**

In `src/lib/printify/client.ts`, add:

```ts
const PRINTIFY_USER_AGENT =
  process.env.PRINTIFY_USER_AGENT || "MockupAI/1.0 (support@vmgfashion.online)";
```

In the shared request headers, add before `...options?.headers`:

```ts
"User-Agent": PRINTIFY_USER_AGENT,
```

- [ ] **Step 4: Scan older direct Printify fetch paths**

Run:

```bash
rg -n "PRINTIFY_BASE_URL|fetch\\(`?\\$\\{PRINTIFY_BASE_URL\\}|fetch\\(\"https://api.printify.com" src
```

Expected: list any direct Printify fetch paths outside `PrintifyClient`.

- [ ] **Step 5: Add User-Agent to any direct Printify fetch path**

For any direct Printify fetch still required, add:

```ts
"User-Agent": process.env.PRINTIFY_USER_AGENT || "MockupAI/1.0 (support@vmgfashion.online)",
```

- [ ] **Step 6: Run client test**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/printify/client.test.ts
```

Expected: PASS.

---

### Task 2: Split Printify Error Types And Preserve Retry Metadata

**Files:**
- Modify: `src/lib/printify/client.ts`
- Modify: `src/lib/printify/client.test.ts`

- [ ] **Step 1: Add source tests for typed errors**

Add to `src/lib/printify/client.test.ts`:

```ts
test("PrintifyClient exposes typed errors with status and retry metadata", () => {
  assert.match(source, /class PrintifyAuthenticationError extends Error/);
  assert.match(source, /class PrintifyPermissionError extends Error/);
  assert.match(source, /class PrintifyBillingError extends Error/);
  assert.match(source, /class PrintifyRateLimitError extends Error/);
  assert.match(source, /class PrintifyValidationError extends Error/);
  assert.match(source, /class PrintifyServerError extends Error/);
  assert.match(source, /retryAfterMs/);
  assert.match(source, /requestId/);
  assert.match(source, /responseBody/);
  assert.match(source, /endpoint/);
  assert.match(source, /method/);
});
```

- [ ] **Step 2: Run and verify failing**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/printify/client.test.ts
```

Expected: FAIL until typed errors exist.

- [ ] **Step 3: Add a metadata type**

Add:

```ts
export type PrintifyErrorMetadata = {
  status: number;
  endpoint: string;
  method: string;
  responseBody: string;
  retryAfterMs?: number | null;
  requestId?: string | null;
};
```

- [ ] **Step 4: Add typed error classes**

Add classes for:

```ts
PrintifyAuthenticationError
PrintifyPermissionError
PrintifyBillingError
PrintifyRateLimitError
PrintifyValidationError
PrintifyServerError
PrintifyApiError
```

Each class must expose:

```ts
status
endpoint
method
responseBody
retryAfterMs
requestId
```

- [ ] **Step 5: Map status codes correctly**

In `request(...)`, map:

```ts
401 -> PrintifyAuthenticationError
402 -> PrintifyBillingError
403 -> PrintifyPermissionError
429 -> PrintifyRateLimitError
400/422 -> PrintifyValidationError
500..599 -> PrintifyServerError
other !ok -> PrintifyApiError
```

- [ ] **Step 6: Parse retry and request id**

Extract:

```ts
const retryAfterHeader = response.headers.get("retry-after");
const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
const requestId = parsedBody?.request_id ?? response.headers.get("x-request-id") ?? null;
```

`parseRetryAfterMs(...)` must support both official `Retry-After` forms:

```ts
export function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/printify/client.test.ts
```

Expected: PASS.

---

### Task 3: Restrict Base64 Fallback To Remote URL Download Failures

**Files:**
- Modify: `src/lib/printify/product.ts`
- Modify: `src/lib/printify/product.test.ts`

- [ ] **Step 1: Add tests for no fallback on non-download errors**

Add tests proving `uploadImageBase64` is not called for:

```text
PrintifyAuthenticationError
PrintifyPermissionError
PrintifyBillingError
PrintifyRateLimitError
PrintifyValidationError
PrintifyServerError
unknown network error
```

Use a shared fake client:

```ts
let base64Called = false;
const client = {
  uploadImageUrl: async () => {
    throw error;
  },
  uploadImageBase64: async () => {
    base64Called = true;
    return { id: "base64-id" };
  },
} as any;
```

Assert:

```ts
await assert.rejects(() => ensurePrintifyImage(...));
assert.equal(base64Called, false);
```

- [ ] **Step 2: Add test for valid fallback**

Add a test where URL upload fails with Printify's remote download failure code `10300` parsed from JSON response body. Assert base64 is called exactly once only when the local file is within the configured safe base64 size limit.

- [ ] **Step 3: Implement fallback predicate**

In `src/lib/printify/product.ts`, add:

```ts
const MAX_PRINTIFY_BASE64_FALLBACK_BYTES = Number(
  process.env.MAX_PRINTIFY_BASE64_FALLBACK_BYTES ?? 5 * 1024 * 1024,
);
if (!Number.isFinite(MAX_PRINTIFY_BASE64_FALLBACK_BYTES) || MAX_PRINTIFY_BASE64_FALLBACK_BYTES <= 0) {
  throw new Error("MAX_PRINTIFY_BASE64_FALLBACK_BYTES must be a positive number.");
}

function isRemoteImageDownloadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (!("status" in error) || Number((error as any).status) !== 400) return false;

  const responseBody = "responseBody" in error ? String((error as any).responseBody ?? "") : "";
  try {
    const body = JSON.parse(responseBody);
    const code = body?.code ?? body?.errors?.code;
    return Number(code) === 10300;
  } catch {
    return false;
  }
}
```

Update URL upload catch:

```ts
    } catch (err) {
      if (!isRemoteImageDownloadFailure(err)) {
        throw err;
      }
      console.warn("[Printify] URL image download failed, falling back to base64:", {
        storagePath: input.designStoragePath,
        publicUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
```

Before base64 upload, use the existing storage abstraction:

```ts
const buffer = await storage.getBuffer(input.designStoragePath);
if (buffer.byteLength > MAX_PRINTIFY_BASE64_FALLBACK_BYTES) {
  throw new PrintifyValidationError("Printify could not download the image URL and the file is too large for base64 fallback.", {
    status: 400,
    endpoint: "/uploads/images.json",
    method: "POST",
    responseBody: "",
    retryAfterMs: null,
    requestId: null,
  });
}

await client.uploadImageBase64({
  fileName,
  contentsBase64: buffer.toString("base64"),
});
```

Do not use `fs.stat(storage.resolvePath(...))`; that would couple Printify upload retry to local disk storage and break alternate storage backends.
- [ ] **Step 4: Run product tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/printify/product.test.ts
```

Expected: PASS.

---

## Phase 2: Publish Idempotency Before Queue Retry

### Task 4: Persist Printify Image IDs Immediately For Paired Designs

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/lib/publish/worker.test.ts`

- [ ] **Step 1: Add source test for immediate image persistence**

Add to `src/lib/publish/worker.test.ts`:

```ts
test("pair publish persists each Printify image id immediately after upload", () => {
  const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");
  const resolverIndex = source.indexOf("async function resolvePrintifyProductPublishInput");
  assert.ok(resolverIndex > -1);

  const pairBlock = source.slice(resolverIndex, resolverIndex + 7000);
  const lightUploadIndex = pairBlock.indexOf("const lightImageId = await ensurePrintifyImage");
  const lightPersistIndex = pairBlock.indexOf("where: { id: lightDraftDesign.id }");
  const darkUploadIndex = pairBlock.indexOf("const darkImageId = await ensurePrintifyImage");
  const darkPersistIndex = pairBlock.indexOf("where: { id: darkDraftDesign.id }");

  assert.ok(lightUploadIndex > -1);
  assert.ok(lightPersistIndex > lightUploadIndex);
  assert.ok(lightPersistIndex < darkUploadIndex);
  assert.ok(darkPersistIndex > darkUploadIndex);
});
```

- [ ] **Step 2: Move persistence after each upload**

Use this order in every pair upload branch:

```ts
const lightImageId = await ensurePrintifyImage(...);
await prisma.wizardDraftDesign.update({
  where: { id: lightDraftDesign.id },
  data: { printifyImageId: lightImageId },
});

const darkImageId = await ensurePrintifyImage(...);
await prisma.wizardDraftDesign.update({
  where: { id: darkDraftDesign.id },
  data: { printifyImageId: darkImageId },
});
```

- [ ] **Step 3: Search for every pair upload branch**

Run:

```bash
rg -n "const lightImageId = await ensurePrintifyImage|const darkImageId = await ensurePrintifyImage" src/lib/publish/worker.ts
```

Expected: every branch follows immediate persistence order.

- [ ] **Step 4: Run worker tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: PASS.

---

### Task 5: Persist Product IDs Immediately And Prefer Existing IDs On Retry

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/lib/publish/worker.test.ts`

- [ ] **Step 1: Add tests for persisted ID preference**

Add source/behavior tests asserting:

```text
Printify retry uses listing.printifyProductId first.
Then draftDesign.printifyDraftProductId.
Then draft.printifyDraftProductId.
It only creates a new product when no persisted ID exists or the persisted ID is confirmed 404.
Shopify product ID is persisted as soon as sync finds it.
```

- [ ] **Step 2: Persist Printify product ID immediately after create/update returns**

After `createOrUpdatePrintifyProduct(...)` returns a product id, call the existing persistence helper before `getProduct(...)`, `publishProduct(...)`, or Shopify sync.

- [ ] **Step 3: Persist Shopify product ID immediately after discovered**

When `waitForShopifyProductSync(...)` or fallback Shopify search returns `shopifyProductId`, update listing before option/media/category repair.

- [ ] **Step 4: Preserve existing validation rules and classify failures**

Do not introduce new variant acceptance/rejection rules in this BullMQ phase. Preserve the existing behavior for:

```text
variant matrix shape
selected variant ids
color/size mapping
SKU correlation
```

If the existing code already fails on a validation/config/SKU condition, classify that failure as fatal for BullMQ and throw `UnrecoverableError` after updating DB state. New validation rules belong in a separate bugfix/validation task, not this queue infrastructure phase.

- [ ] **Step 5: Run focused worker tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: PASS.

---

### Task 6: Use Concrete Correlation Per Publish Strategy

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/lib/printify/product.ts`
- Modify: `src/lib/publish/worker.test.ts`
- Modify: `src/lib/printify/product.test.ts`

- [ ] **Step 1: Add tests for strategy-specific correlation**

Add tests proving:

```text
Shopify Direct does not add a new Shopify metafield or change Shopify mutation shape in this phase.
Shopify Direct recovery uses persisted shopifyProductId first.
Printify Shopify Channel does not add a customer-visible mockupai-listing tag.
Printify Shopify Channel recovery prefers persisted Printify product ID.
If no persisted Printify ID exists, fallback matching requires shop ID + exact SKU set + expected blueprint/provider + tight creation window.
Title-only recovery is rejected.
```

- [ ] **Step 2: Shopify Direct correlation without mutation changes**

Do not add Shopify metafields in this phase and do not change the Shopify create/productSet mutation. For Direct retry/recovery, use only durable checkpoints already available in this flow:

```text
1. persisted listing.shopifyProductId
2. exact SKU set + store/shop domain + tight creation window only when needed
```

Persist `shopifyProductId` as early as the current flow already exposes it, but keep the existing business order and Shopify mutation shape.

- [ ] **Step 3: Printify Shopify Channel correlation**

Printify product API does not provide a clear hidden arbitrary metadata field in the current docs. Do not add `mockupai-listing:<listingId>` to public product tags unless a separate verification proves Printify strips it before storefront sync.

Use this recovery order:

```text
1. persisted listing.printifyProductId
2. persisted draftDesign.printifyDraftProductId or draft.printifyDraftProductId
3. exact SKU set + Printify shop ID + blueprint/provider + tight creation window
```

- [ ] **Step 4: Update recovery lookup**

Any fallback that searches recent products must reject title-only matches. If a product is found by SKU set, persist its Printify product ID before continuing.

- [ ] **Step 5: Run tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/printify/product.test.ts src/lib/publish/worker.test.ts
```

Expected: PASS.

---

### Task 6A: Preserve Existing Shopify Media/WebP Flow Boundary

**Files:**
- Modify: `src/lib/publish/worker.test.ts`
- Modify: `src/lib/publish/shopify.test.ts`
- Modify: `src/lib/publish/shopify-post-sync.test.ts`

This BullMQ/recovery phase must not change Shopify media or post-sync business logic. Keep the current runtime order and helper ownership intact:

```text
publishToShopify(...)
repairAndVerifyShopifyPostSync(...)
publishShopifyChannelsStrict(...)
```

The exact helper names must be taken from the branch being implemented. Do not hard-code a function name in the test if the current code uses a different helper for the same existing step. The test must extract the relevant strategy block from `runPublishWorker(...)` or its current strategy-specific branch before checking order; do not use `source.indexOf(...)` across the whole file, because an occurrence from the other strategy can make the test pass falsely.

Do not do any of the following in this phase:

```text
Do not replace productCreateMedia with productUpdate/productSet media changes.
Do not split publishToShopify into a new media pipeline.
Do not add uploadMedia: false.
Do not add ListingMedia.
Do not introduce CanonicalVariantRow.
Do not change current WebP MIME detection or staged upload behavior.
Do not change option repair, variant-media attach, or gallery reorder ordering.
Do not add new Shopify media readiness polling to the production flow.
Do not add technical media alt markers.
```

- [ ] **Step 1: Add no-flow-change source tests**

Add tests asserting the existing function boundaries are still present and called in the current order. The tests should fail if implementation tries to move media ownership into a new pipeline during the BullMQ work.

Required assertions:

```text
Direct strategy block preserves the current order from the implementation branch:
  publishToShopify
  persist Shopify product/variant IDs at the same point the current flow already does
  existing repair/verification helper
  existing Shopify channel publication helper
  runPrintifyStage
  finalize

Channel strategy block preserves the current order from the implementation branch:
  Printify create/update
  Printify publish
  Shopify sync wait
  persist Shopify product ID
  update Shopify category
  attach manual collections
  repair option/media/gallery
  persist Printify-Shopify variant mapping
  publish Shopify channels
  optional Printify unpublish
  mark ACTIVE/finalize

repairAndVerifyShopifyPostSync still owns current option/media/gallery repair behavior.
publishToShopify signature is not changed with uploadMedia: false.
No ListingMedia model is introduced by this plan.
No CanonicalVariantRow replacement is introduced by this plan.
```

If the current branch names a step differently, update the assertion labels to that real helper name while preserving the order above. The goal is to lock the existing business order, not to invent a new naming contract.

- [ ] **Step 2: Keep WebP behavior unchanged**

Existing WebP tests may remain, but this phase must only protect current behavior. Do not alter MIME detection, staged upload file naming, or existing media upload ordering as part of BullMQ.

- [ ] **Step 3: Run boundary tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/shopify.test.ts src/lib/publish/shopify-post-sync.test.ts src/lib/publish/worker.test.ts
```

Expected: PASS.

---

### Task 6B: Printify Placement Payload Regression Fix Without Flow Changes

**Files:**
- Modify: `src/lib/printify/product.ts`
- Modify: `src/lib/printify/product.test.ts`
- Modify: `src/lib/publish/worker.test.ts`
- Modify: `src/lib/publish/worker.ts` only if the failing placement helper lives there

This task is required for this release because the print-frame/placement bug is part of the current wizard case scope. It must not change publish orchestration.

Implement this as a separate commit before or after the queue infrastructure work:

```text
Commit A: Printify placement payload regression fix
Commit B: BullMQ/outbox/recovery infrastructure
```

The two commits must not depend on each other and neither may change publish order.

If the current code already emits the correct Channel placement payload, this commit should add regression tests only; do not force an implementation change just to touch code.

Do not change:

```text
runPublishWorker(...) stage order
runPrintifyStage(...) call order
createOrUpdatePrintifyProduct(...) call location
Shopify Direct flow
Printify Shopify Channel flow
```

- [ ] **Step 1: Add placement payload regression tests**

Add tests around `buildPrintifyProductPayload(...)` proving:

```text
PRINTIFY_SHOPIFY_CHANNEL keeps the existing buildFullWidthPlacementData() path.
PRINTIFY_SHOPIFY_CHANNEL does not use custom/saved mockup placement for Printify product payload.
PRINTIFY_SHOPIFY_CHANNEL full-frame payload produces x = 0.5, y = 0.5, scale = 1, angle = 0.
PRINTIFY_SHOPIFY_CHANNEL full-frame payload does not regress to scale = 0.618.
paired light/dark area 0 uses light image ID + light variant IDs + scale = 1.
paired light/dark area 1 uses dark image ID + dark variant IDs + scale = 1.
front-only payload does not create images for back/sleeves.
Other flows keep their current placementData behavior; do not apply one new placement rule across every strategy.
```

Use the existing `placementData` input shape and existing helper path; do not introduce a new publish stage. Add an orchestration/input-builder source test in `src/lib/publish/worker.test.ts` proving Channel still calls the existing `buildFullWidthPlacementData()` path before building the Printify payload.

- [ ] **Step 2: Fix only the placement payload helper**

If the regression test fails, fix only the helper that converts stored placement into Printify image coordinates:

```text
buildPrintifyProductPayload(...)
buildPlaceholders(...)
mmToPrintifyCoords(...)
buildFullWidthPlacementData(...) if this helper lives in worker.ts and is the source of the regression
```

Allowed behavior:

```text
For PRINTIFY_SHOPIFY_CHANNEL, keep buildFullWidthPlacementData() and emit x=0.5, y=0.5, scale=1, angle=0.
Do not replace Channel full-width placement with custom/saved placement data.
For other flows, preserve the current placementData behavior already used by that flow.
Keep paired imageGroups mapped to their own imageId and variantIds.
```

Not allowed:

```text
No new Printify GET/verify step in production flow.
No new Shopify step.
No reorder of product create/update/publish calls.
No change to mockup/media/gallery repair.
```

- [ ] **Step 3: Run placement tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/printify/product.test.ts
```

Expected: PASS.

---

## Phase 3: Queue Contract And Retry Ownership

### Task 7: Add Publish Attempt ID And Queue Payload

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/publish/queue.ts`
- Create: `src/lib/publish/queue.test.ts`

- [ ] **Step 1: Add queue source tests**

Create `src/lib/publish/queue.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./queue.ts", import.meta.url), "utf8");

describe("publish queue contract", () => {
  it("uses publishAttemptId in payload and job id", () => {
    assert.match(source, /publishAttemptId: string/);
    assert.match(source, /jobId:\s*`publish-\$\{input\.listingId\}-\$\{input\.publishAttemptId\}`/);
    assert.doesNotMatch(source, /jobId:\s*`publish-\$\{input\.listingId\}`/);
  });

  it("uses BullMQ retry ownership", () => {
    assert.match(source, /attempts:\s*5/);
    assert.match(source, /type:\s*"exponential"/);
    assert.match(source, /delay:\s*60_000/);
    assert.match(source, /removeOnComplete:\s*\{/);
    assert.match(source, /age:\s*24\s*\*\s*60\s*\*\s*60/);
    assert.match(source, /removeOnFail:\s*\{/);
  });
});
```

- [ ] **Step 2: Add queue module**

Create `src/lib/publish/queue.ts`:

```ts
import { Queue } from "bullmq";
import { redisConnection } from "@/lib/queue/queue";

export const PUBLISH_QUEUE_NAME = "publish-jobs";

export interface PublishJobPayload {
  listingId: string;
  draftId: string;
  tenantId: string;
  publishAttemptId: string;
}

const globalForPublishQueue = globalThis as unknown as {
  publishQueue?: Queue<PublishJobPayload>;
};

export function getPublishQueue(): Queue<PublishJobPayload> {
  if (!globalForPublishQueue.publishQueue) {
    globalForPublishQueue.publishQueue = new Queue<PublishJobPayload>(PUBLISH_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: {
          age: 24 * 60 * 60,
          count: 5000,
        },
        removeOnFail: {
          age: 7 * 24 * 60 * 60,
          count: 10000,
        },
      },
    });
  }
  return globalForPublishQueue.publishQueue;
}

export async function enqueuePublishJob(input: PublishJobPayload) {
  return getPublishQueue().add("publish-listing", input, {
    jobId: `publish-${input.listingId}-${input.publishAttemptId}`,
  });
}
```

- [ ] **Step 3: Add schema support**

Add an explicit publish attempt model:

```prisma
model Listing {
  id                     String          @id @default(cuid())
  activePublishAttemptId String?         @unique @map("active_publish_attempt_id")
  activePublishAttempt   PublishAttempt? @relation("ListingActivePublishAttempt", fields: [activePublishAttemptId], references: [id], onDelete: SetNull)
  publishAttempts        PublishAttempt[] @relation("ListingPublishAttempts")
  publishJobs            PublishJob[]
  ...
}

model PublishAttempt {
  id          String    @id @default(cuid())
  listingId   String    @map("listing_id")
  tenantId     String    @map("tenant_id")
  attemptNo    Int       @map("attempt_no")
  status       String    @default("PENDING")
  baselineListingStatus String @map("baseline_listing_status")
  resumeFromAttemptId   String? @map("resume_from_attempt_id")
  firstExternalWriteStartedAt DateTime? @map("first_external_write_started_at")
  startedAt    DateTime? @map("started_at")
  completedAt  DateTime? @map("completed_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  listing       Listing  @relation("ListingPublishAttempts", fields: [listingId], references: [id], onDelete: Cascade)
  activeListing Listing? @relation("ListingActivePublishAttempt")
  jobs    PublishJob[]
  outbox  PublishOutbox?

  @@unique([listingId, attemptNo])
  @@index([listingId, status])
  @@map("publish_attempts")
}
```

Update `PublishJob`:

```prisma
model PublishJob {
  id               String       @id @default(cuid())
  listingId        String       @map("listing_id")
  idempotencyKey   String       @unique @map("idempotency_key")
  publishAttemptId String       @map("publish_attempt_id")
  stage            PublishStage
  nextRetryAt      DateTime?    @map("next_retry_at")
  reasonCode       String?      @map("reason_code")
  ...

  attempt PublishAttempt @relation(fields: [publishAttemptId], references: [id], onDelete: Cascade)

  @@unique([publishAttemptId, stage], name: "attempt_stage")
  @@index([listingId, publishAttemptId])
}
```

Use:

```ts
idempotencyKey = `${listingId}:${publishAttemptId}:${stage}`;
```

Do not keep the old listing/draft/stage-only idempotency key format, because manual retry creates new `PublishJob` rows and the old `idempotencyKey @unique` would collide. If `@@unique([publishAttemptId, stage])` fully replaces the old field later, remove `idempotencyKey` in a separate explicit migration; do not leave it undefined.

Before backfill, run a read-only preflight:

```sql
select listing_id, stage, count(*)
from publish_jobs
group by listing_id, stage
having count(*) > 1;
```

If any rows are returned, do not blindly create one attempt per listing; decide whether to create multiple historical attempts or deduplicate legacy jobs before adding `@@unique([publishAttemptId, stage])`.

Migration order:

```text
1. add nullable publish_attempt_id / active_publish_attempt_id / outbox fields
2. preflight duplicate stage rows
3. backfill attempts and publish_attempt_id
4. backfill baselineListingStatus from current listing status, leave firstExternalWriteStartedAt null for legacy attempts unless a reviewed recovery script can prove an external write started, and backfill idempotencyKey = listingId:publishAttemptId:stage
5. verify no nulls and no duplicate (publishAttemptId, stage)
6. add FK / unique / not-null constraints
```

- [ ] **Step 4: Add initial publish and active attempt guards**

Initial publish is different from manual retry because the listing does not exist yet. Guard it at wizard/draft level before creating listings:

```text
DB transaction:
  acquire PostgreSQL advisory transaction lock by tenantId + wizardDraftId
  reload wizard/current active publish batch state
  if the draft already has active listing attempts:
      return the existing publish state
  create listings
  create PublishAttempt rows with baselineListingStatus = new listing status before switching to PUBLISHING
  create PublishJob rows
  create PublishOutbox rows
  update wizard/listing state
  commit
```

This prevents two concurrent publish requests for the same draft from creating two independent listing/attempt/outbox sets.

Manual retry on an existing listing must use the `Listing.activePublishAttemptId` CAS path:

```text
DB transaction:
  SELECT listing row FOR UPDATE or use PostgreSQL advisory transaction lock by listingId
  reload listing.activePublishAttemptId
  if activePublishAttemptId exists:
      return that active attempt/listing state
  create attemptNo = max(attemptNo) + 1
  create PublishAttempt with baselineListingStatus = listing.status before retry state changes
  create PublishJob rows with idempotencyKey = listingId:publishAttemptId:stage, carrying forward only safe succeeded checkpoints
  create PublishOutbox row
  set Listing.activePublishAttemptId = publishAttemptId
  commit
```

If Prisma cannot express `SELECT ... FOR UPDATE` cleanly, use `$queryRaw` inside the transaction for the row lock or use a PostgreSQL advisory transaction lock. Do not rely on plain `max(attemptNo) + 1` under the default transaction isolation.

Worker updates must include `publishAttemptId` in every mutation:

```ts
where: {
  attempt_stage: {
    publishAttemptId,
    stage: "PRINTIFY",
  },
}
```

or:

```ts
where: {
  listingId,
  publishAttemptId,
  status: { in: ["PENDING", "RUNNING", "RETRY_SCHEDULED"] },
}
```

Do not use `listing.publishJobs.find(job => job.stage === "PRINTIFY")` without filtering to the active attempt.

When an attempt reaches a terminal state, clear the active pointer with CAS:

```ts
await prisma.listing.updateMany({
  where: {
    id: listingId,
    activePublishAttemptId: publishAttemptId,
  },
  data: {
    activePublishAttemptId: null,
    status: finalStatus,
  },
});
```

An old attempt must never clear or overwrite a newer active attempt.

- [ ] **Step 4A: Carry forward safe succeeded stage checkpoints on manual retry**

Manual retry creates a new `publishAttemptId`, so it must not lose durable stage checkpoints from the previous attempt.

When creating a manual retry attempt:

```text
read the previous attempt and jobs for this listing

carry forward a stage only when:
  previous stage status = SUCCEEDED
  and the durable product ID for that stage exists

do not carry forward:
  FAILED
  PENDING
  RUNNING
  RETRY_SCHEDULED
  productId-only evidence without previous stage SUCCEEDED
```

Strategy-specific carry-forward:

```text
EXISTING_SHOPIFY_DIRECT:
  previous SHOPIFY SUCCEEDED + listing.shopifyProductId exists
    -> create new SHOPIFY job with status SUCCEEDED
    -> set progressData.resumedFromAttemptId = previousAttemptId
    -> do not call publishToShopify on this manual retry

PRINTIFY_SHOPIFY_CHANNEL:
  previous PRINTIFY SUCCEEDED + listing.printifyProductId exists
    -> create new PRINTIFY job with status SUCCEEDED
    -> set progressData.resumedFromAttemptId = previousAttemptId
    -> do not call createOrUpdatePrintifyProduct or publishProduct on this manual retry
```

Store `resumeFromAttemptId` on `PublishAttempt` when any stage is carried forward, or store the same value in each carried-forward job's `progressData`; the behavior must be testable either way.

Required tests:

```text
Direct manual retry: previous SHOPIFY SUCCEEDED + shopifyProductId, previous PRINTIFY FAILED/429
  -> new attempt SHOPIFY job starts SUCCEEDED
  -> worker does not call publishToShopify again

Channel manual retry: previous PRINTIFY SUCCEEDED + printifyProductId, previous SHOPIFY sync timeout
  -> new attempt PRINTIFY job starts SUCCEEDED
  -> worker does not call createOrUpdatePrintifyProduct or publishProduct again

Previous stage FAILED/PENDING/RUNNING is not carried forward even if a product ID exists.
```

- [ ] **Step 5: Run validation**

Run:

```bash
npx prisma validate
./node_modules/.bin/tsx --test src/lib/publish/queue.test.ts
```

Expected: PASS.

---

### Task 8: Make BullMQ The Retry Owner

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Create: `src/lib/jobs/workers/publish-worker.ts`
- Create: `src/lib/jobs/workers/publish-worker.test.ts`

- [ ] **Step 1: Add tests for retry ownership**

Create `src/lib/jobs/workers/publish-worker.test.ts`. Source assertions can exist as guardrails, but behavioral tests are required:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./publish-worker.ts", import.meta.url), "utf8");

test("publish worker rethrows retryable errors so BullMQ owns retries", () => {
  assert.match(source, /throw error/);
  assert.match(source, /UnrecoverableError/);
  assert.match(source, /attemptsMade/);
  assert.match(source, /opts\.attempts/);
});
```

Also add behavior tests with mocked worker dependencies proving:

```text
processor throws a retryable PrintifyRateLimitError so BullMQ can retry
intermediate retry marks RETRY_SCHEDULED, not FAILED
final retry marks terminal failure by stage
fatal validation error updates DB then throws UnrecoverableError
ambiguous external write updates DB as manual-recovery failure and throws UnrecoverableError, with no second BullMQ execution
old publishAttemptId cannot update the active newer attempt
strategy-aware finalizer returns PARTIAL_FAILURE for Direct when Shopify succeeded but Printify failed
strategy-aware finalizer returns PARTIAL_FAILURE for Direct when shopifyProductId is persisted but existing Shopify stage failed
strategy-aware finalizer returns FAILED for Channel when Printify failed before Shopify sync
Direct retry with SHOPIFY job already SUCCEEDED and PRINTIFY hit 429 does not call publishToShopify again
Channel retry with PRINTIFY job already SUCCEEDED and Shopify sync timeout does not call createOrUpdatePrintifyProduct or publishProduct again
```

- [ ] **Step 2: Refactor publish worker behavior**

`runPublishWorker(...)` must support queue mode:

```ts
runPublishWorker(input, { retryOwner: "bullmq" })
```

In queue mode:

```text
retryable errors are thrown
fatal errors update DB immediately and are then thrown as UnrecoverableError
DelayedError is rethrown unchanged and is not mapped to RETRY_SCHEDULED/FAILED/UNKNOWN
intermediate attempts do not mark final FAILED
final attempt marks DB FAILED
```

The generic catch must start with:

```ts
if (error instanceof DelayedError) {
  throw error;
}
```

Ambiguous writes must use a dedicated error type and must not fall through to retryable handling:

```ts
class AmbiguousExternalWriteError extends Error {
  stage: "PRINTIFY" | "SHOPIFY";
  reasonCode:
    | "PRINTIFY_AMBIGUOUS_WRITE"
    | "SHOPIFY_AMBIGUOUS_WRITE"
    | "SHOPIFY_MEDIA_AMBIGUOUS_WRITE";
  operation: string;
}
```

When this error is caught:

```text
do not set RETRY_SCHEDULED
do not moveToDelayed
do not throw a normal retryable Error

PublishJob -> FAILED
PublishAttempt -> FAILED + completedAt
Listing -> FAILED/PARTIAL_FAILURE using checkpoint-aware finalizer
Listing.activePublishAttemptId -> null only if it still equals publishAttemptId
UI message -> "Cần thử lại thủ công"
throw UnrecoverableError
```

Use `error.stage` to mark the affected `PublishJob` (`PRINTIFY` or `SHOPIFY`) as `FAILED`, and pass `error.reasonCode` into `finalizeFailedPublishAttemptIdempotently(...)` as `errorCode`. Log `error.operation` with sanitized metadata so the admin/debug log says which external mutation became ambiguous.

This specifically covers ambiguous mutation timeouts where the external system may have executed the write but the app did not receive a definitive response. Because this phase does not change Shopify media ownership, those writes are not safe for automatic whole-flow retry.

- [ ] **Step 2A: Persist first external write marker**

`hasStartedExternalStage` must be derived from durable DB state, not from in-memory worker state.

Add to `PublishAttempt`:

```prisma
firstExternalWriteStartedAt DateTime? @map("first_external_write_started_at")
```

Set it exactly once, immediately before the first external write of the attempt:

```ts
await prisma.publishAttempt.updateMany({
  where: {
    id: publishAttemptId,
    firstExternalWriteStartedAt: null,
  },
  data: {
    firstExternalWriteStartedAt: new Date(),
  },
});
```

External writes include:

```text
Printify upload/create/update/publish
Shopify create/update/media/publication mutation
```

Do not set it for:

```text
loading DB state
cooldown active before a request
waiting for Redis lock
idempotent reads/polls
outbox enqueue attempts
```

Finalizers and watchdog reconciliation must compute:

```ts
const hasStartedExternalStage =
  publishAttempt.firstExternalWriteStartedAt !== null;
```

Required tests:

```text
Outbox DEAD before worker start -> firstExternalWriteStartedAt null -> baseline ACTIVE/PARTIAL_FAILURE is restored/preserved.
Cooldown active before first Printify request -> marker remains null.
Worker begins Printify or Shopify mutation -> marker is persisted before the mutation.
Watchdog after process restart uses firstExternalWriteStartedAt to compute final status.
```

- [ ] **Step 2B: Resume only non-terminal stages**

Queue mode must reload `PublishJob` rows for the current `publishAttemptId` before running any stage.

Rules:

```text
If PRINTIFY job is SUCCEEDED:
  do not run Printify create/update/publish again;
  use persisted printifyProductId;
  continue the next non-terminal stage according to the existing flow.

If SHOPIFY job is SUCCEEDED:
  do not run publishToShopify, current Shopify repair/media helpers, or Shopify channel publish again;
  for EXISTING_SHOPIFY_DIRECT, continue runPrintifyStage if Printify is not terminal.

Only run stages that are not terminal for the active publishAttemptId.
Terminal statuses: SUCCEEDED, FAILED.
```

This is a recovery wrapper around the existing flow. It must not reorder the happy-path business sequence.

- [ ] **Step 3: Remove nested retry from non-idempotent writes**

Do not wrap product create/update/publish in `retryWithBackoff(...)` when BullMQ owns retry. Keep short local retry only for idempotent reads such as `GET product` or Shopify sync polling, and cap it tightly.

- [ ] **Step 4: Add final attempt handler**

In `src/lib/jobs/workers/publish-worker.ts`, detect final attempt:

```ts
const attempts = Number(job.opts.attempts ?? 1);
const isFinalAttempt = job.attemptsMade + 1 >= attempts;
```

On final attempt failure, call a helper that marks DB jobs and listing status by stage:

```ts
type PublishJobStatus = "PENDING" | "RUNNING" | "WAITING_EXTERNAL" | "RETRY_SCHEDULED" | "SUCCEEDED" | "FAILED";

function resolveFinalListingStatus(input: {
  strategy: "EXISTING_SHOPIFY_DIRECT" | "PRINTIFY_SHOPIFY_CHANNEL";
  shopifyStatus: PublishJobStatus;
  printifyStatus: PublishJobStatus;
  shopifyProductId: string | null;
  printifyProductId: string | null;
  baselineListingStatus: "ACTIVE" | "FAILED" | "PARTIAL_FAILURE" | "PUBLISHING" | string;
  firstExternalWriteStartedAt: Date | null;
}): "ACTIVE" | "FAILED" | "PARTIAL_FAILURE" {
  const hasStartedExternalStage = input.firstExternalWriteStartedAt !== null;
  if (!hasStartedExternalStage) {
    if (input.baselineListingStatus === "ACTIVE") return "ACTIVE";
    if (input.baselineListingStatus === "PARTIAL_FAILURE") return "PARTIAL_FAILURE";
  }

  if (input.strategy === "EXISTING_SHOPIFY_DIRECT") {
    if (!input.shopifyProductId) return "FAILED";
    if (input.shopifyStatus !== "SUCCEEDED" || input.printifyStatus !== "SUCCEEDED") {
      return "PARTIAL_FAILURE";
    }
    if (!input.printifyProductId) return "PARTIAL_FAILURE";
    return "ACTIVE";
  }

  if (input.printifyStatus !== "SUCCEEDED") return "FAILED";
  if (!input.printifyProductId) return "FAILED";
  if (input.shopifyStatus !== "SUCCEEDED") return "PARTIAL_FAILURE";
  if (!input.shopifyProductId) return "PARTIAL_FAILURE";
  return "ACTIVE";
}
```

Do not use stage status alone. A listing cannot become `ACTIVE` if the required durable product IDs are missing:

```text
Direct: SHOPIFY SUCCEEDED but shopifyProductId null -> FAILED
Direct: PRINTIFY SUCCEEDED but printifyProductId null -> PARTIAL_FAILURE
Channel: PRINTIFY SUCCEEDED but printifyProductId null -> FAILED
Channel: SHOPIFY SUCCEEDED but shopifyProductId null -> PARTIAL_FAILURE
```

If `shopifyProductId` is already persisted in Direct and the existing Shopify stage later fails, the final status is `PARTIAL_FAILURE`, not `FAILED`.

Do not infer "listing was ACTIVE before retry" from product IDs. Use `PublishAttempt.baselineListingStatus`, captured when the attempt was created, so an enqueue failure or pre-external-stage failure can restore/preserve the previous visible listing state:

```text
attempt has not started any external stage + baselineListingStatus = ACTIVE
  -> restore ACTIVE

attempt has not started any external stage + baselineListingStatus = PARTIAL_FAILURE
  -> preserve PARTIAL_FAILURE
```

Fatal errors must update DB before throwing `UnrecoverableError`, because BullMQ will stop retrying immediately.

On non-final retryable failure, set attempt/job status to `RETRY_SCHEDULED` with a Vietnamese retry message and sanitized technical metadata. Do not show final failure while attempts remain.

Also persist:

```text
nextRetryAt
reasonCode
```

for lock wait, cooldown, Shopify throttle, and network/server retries.

- [ ] **Step 5: Reconcile BullMQ terminal failures outside processor**

Processor finalizer is not enough. BullMQ can terminal-fail a job because of `maxStartedAttempts`, stalled limits, lock errors, or worker-level failures before business code reaches the final attempt branch.

Create one shared idempotent helper:

```ts
type FinalizeFailedPublishAttemptInput = {
  listingId: string;
  publishAttemptId: string;
  error: unknown;
  errorCode?: PublishErrorCode;
  userMessage?: string;
};

export async function finalizeFailedPublishAttemptIdempotently(
  input: FinalizeFailedPublishAttemptInput,
): Promise<void> {
  // reload attempt, listing, jobs, durable product IDs
  // if attempt is already terminal, return
  // compute final listing status with resolveFinalListingStatus(...), deriving hasStartedExternalStage from publishAttempt.firstExternalWriteStartedAt
  // mark non-succeeded jobs failed where appropriate
  // mark PublishAttempt FAILED + completedAt
  // clear Listing.activePublishAttemptId only when it still equals publishAttemptId
}
```

Use it in the processor final-attempt branch and in the worker failed event. The event handler must catch finalizer failures so logging/reconciliation errors do not become unhandled promise rejections:

```ts
worker.on("failed", (job, error) => {
  if (!job) return;

  void (async () => {
    const state = await job.getState();
    if (state !== "failed") return;

    await finalizeFailedPublishAttemptIdempotently({
      listingId: job.data.listingId,
      publishAttemptId: job.data.publishAttemptId,
      error,
    });
  })().catch((finalizeError) => {
    logger.error("Publish failed-event finalizer failed", {
      listingId: job.data.listingId,
      publishAttemptId: job.data.publishAttemptId,
      error: finalizeError,
    });
  });
});
```

Add a watchdog reconciliation path:

```text
DB active attempt + BullMQ job state failed/missing
  -> finalizeFailedPublishAttemptIdempotently(...)
```

Tests must prove:

```text
maxStartedAttempts terminal failure closes PublishAttempt and active pointer
stalled/failed event closes PublishAttempt even when processor final branch did not run
calling finalizer twice is safe
old attempt finalizer cannot clear a newer active attempt
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/jobs/workers/publish-worker.test.ts src/lib/publish/worker.test.ts
```

Expected: PASS.

---

### Task 8A: Start Publish Worker And Outbox Dispatcher In Worker Process

**Files:**
- Modify: `start-worker.ts`
- Modify: `src/lib/jobs/workers/publish-worker.ts`
- Modify: `src/lib/publish/outbox.ts`
- Create/modify: `src/lib/jobs/workers/publish-worker.test.ts`

- [ ] **Step 1: Add start-worker source test**

Add a source test proving the standalone worker imports and starts:

```text
startPublishWorker
startPublishOutboxDispatcher
publishWorker?.close()
publishOutboxDispatcher?.close()
Publish worker is ready and listening to queue.
Publish outbox dispatcher is ready.
```

The test must also assert `ready`, `error`, and `failed` handlers are registered for the publish worker.

- [ ] **Step 2: Export worker start/stop contract**

`src/lib/jobs/workers/publish-worker.ts` must export:

```ts
export function startPublishWorker(): Worker<PublishJobPayload>
```

It must attach structured logging for:

```text
ready
active
completed
failed
error
stalled
```

Worker options must include:

```ts
{
  connection: redisConnection,
  concurrency: Number(process.env.PUBLISH_WORKER_CONCURRENCY ?? 3),
  maxStartedAttempts: Number(process.env.PUBLISH_WORKER_MAX_STARTED_ATTEMPTS ?? 50),
}
```

`maxStartedAttempts` is the second guard for jobs repeatedly re-entering the processor through `DelayedError`, because special delayed errors do not consume normal `attemptsMade`.

- [ ] **Step 3: Export outbox dispatcher lifecycle**

`src/lib/publish/outbox.ts` must export:

```ts
export function startPublishOutboxDispatcher(): { close: () => Promise<void> }
```

The dispatcher runs on an interval, dispatches due `PENDING` rows, rescues stale `DISPATCHING` rows, and stops cleanly on `close()`.

- [ ] **Step 4: Wire `start-worker.ts`**

Update `start-worker.ts` to:

```text
import/start publish worker
import/start outbox dispatcher
store both in module-level variables
close both in SIGINT/SIGTERM shutdown
log ready/error/failed events
```

Do not rely on the Next.js web process to process publish queue jobs.

- [ ] **Step 5: Verify PM2 worker path**

Before deployment, confirm the PM2 worker process runs `start-worker.ts` from the new build and logs:

```text
Publish worker is ready and listening to queue.
Publish outbox dispatcher is ready.
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/jobs/workers/publish-worker.test.ts
```

Expected: PASS.

---

## Phase 4: Durable Enqueue

### Task 9: Add Transactional Publish Outbox

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/publish/outbox.ts`
- Create: `src/lib/publish/outbox.test.ts`
- Modify: `src/app/api/wizard/drafts/[id]/publish/route.ts`
- Modify: `src/app/api/listings/[id]/retry-printify/route.ts`

- [ ] **Step 1: Add outbox schema**

Add:

```prisma
model PublishOutbox {
  id               String    @id @default(cuid())
  listingId        String    @map("listing_id")
  draftId          String    @map("wizard_draft_id")
  tenantId         String    @map("tenant_id")
  publishAttemptId String    @unique @map("publish_attempt_id")
  status           String    @default("PENDING")
  attempts         Int       @default(0)
  nextAttemptAt    DateTime  @default(now()) @map("next_attempt_at")
  lockedAt         DateTime? @map("locked_at")
  lockedBy         String?   @map("locked_by")
  lastError        String?   @map("last_error")
  dispatchedAt     DateTime? @map("dispatched_at")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  attempt PublishAttempt @relation(fields: [publishAttemptId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
  @@index([status, lockedAt])
  @@map("publish_outbox")
}
```

This is intentionally one outbox row per `PublishAttempt`. Prisma one-to-one relation requires the foreign key side to be unique, so `publishAttemptId` must be `@unique`. If implementation later needs multiple outbox events per attempt, change `PublishAttempt.outbox` to `PublishOutbox[]` and remove the one-to-one assumption explicitly.

Allowed statuses:

```text
PENDING
DISPATCHING
DISPATCHED
DEAD
```

- [ ] **Step 2: Create outbox helpers**

Create `src/lib/publish/outbox.ts` with:

```ts
export async function createPublishOutboxRow(...)
export async function dispatchPendingPublishOutbox(...)
export async function markPublishOutboxDispatched(...)
export async function reschedulePublishOutbox(...)
export async function markPublishOutboxDead(...)
```

Dispatch must:

```text
1. atomically claim due PENDING rows where nextAttemptAt <= now()
2. set status = DISPATCHING, lockedAt = now(), lockedBy = hostname:pid:workerInstanceUuid
3. enqueue with jobId = publish-${listingId}-${publishAttemptId}
4. mark DISPATCHED only after enqueue succeeds
```

Use one concrete atomic claim implementation. Preferred PostgreSQL form:

```sql
update publish_outbox
set status = 'DISPATCHING',
    locked_at = now(),
    locked_by = $1,
    attempts = attempts + 1
where id in (
  select id
  from publish_outbox
  where status = 'PENDING'
    and next_attempt_at <= now()
  order by next_attempt_at asc
  for update skip locked
  limit $2
)
returning *;
```

If using Prisma-only CAS per row, the dispatcher must use `updateMany(...)` with `where: { id, status: "PENDING" }` and continue only when `count === 1`. Do not implement `findMany(PENDING) -> loop update(DISPATCHING)` without a claim check; route-triggered dispatch and standalone watchdog can run concurrently.

If the dispatcher crashes after enqueue but before `DISPATCHED`, retrying the same outbox row must be safe because BullMQ receives the same idempotent job id for the same publish attempt.

- [ ] **Step 3: Use DB transaction in publish route**

Inside one Prisma transaction:

```text
create listing
create publish jobs with same publishAttemptId
create publish_outbox row
update wizard
```

Do not enqueue inside the transaction. After commit, call dispatcher for the created outbox IDs.

- [ ] **Step 4: Add compensation for enqueue failure**

If enqueue fails after transaction commit:

```text
publish_outbox.status = PENDING
publish_outbox.nextAttemptAt = now() + backoff(attempts)
publish_outbox.lastError = sanitized enqueue error
```

Do not increment `attempts` here; claim SQL already increments attempts when moving `PENDING -> DISPATCHING`. One failed enqueue must count as one attempt, not two.

Only when attempts exceed the configured max:

```text
publish_outbox.status = DEAD
run finalizeFailedPublishAttemptIdempotently({
  listingId,
  publishAttemptId,
  error: enqueueError,
  errorCode: "PUBLISH_ENQUEUE_FAILED",
})
```

The finalizer must be checkpoint-aware:

```text
PublishAttempt -> FAILED + completedAt
PublishJob rows for publishAttemptId -> FAILED where not already terminal
PublishOutbox -> DEAD
Listing.activePublishAttemptId -> null only if it still equals publishAttemptId

Listing status:
  if no external checkpoint exists -> FAILED
  if at least one platform product exists -> PARTIAL_FAILURE
  if PublishAttempt.baselineListingStatus = ACTIVE and no external stage started -> restore ACTIVE
  if PublishAttempt.baselineListingStatus = PARTIAL_FAILURE and no new external checkpoint succeeded -> preserve PARTIAL_FAILURE
```

The finalizer must not infer the pre-attempt visible status from product IDs alone. Use `PublishAttempt.baselineListingStatus`, captured before the retry attempt changed listing state, to decide whether an outbox enqueue failure or other pre-external-stage failure should restore `ACTIVE` or preserve `PARTIAL_FAILURE`.

UI must allow manual retry after `DEAD`.

- [ ] **Step 5: Add watchdog dispatch path**

Add a worker task that scans:

```text
status = PENDING and nextAttemptAt <= now()
status = DISPATCHING and lockedAt older than stale threshold
```

Stale `DISPATCHING` rows go back to `PENDING` with `nextAttemptAt = now()`. The watchdog must be idempotent by `listingId + publishAttemptId`.

- [ ] **Step 6: Add behavioral outbox tests**

Tests must prove:

```text
Redis enqueue failure returns the outbox row to PENDING with nextAttemptAt.
Max enqueue failures move the row to DEAD and use checkpoint-aware finalizer; baseline ACTIVE is restored when no external stage started, and baseline PARTIAL_FAILURE is preserved rather than downgraded to FAILED.
Crash after enqueue but before DISPATCHED does not create duplicate BullMQ jobs.
Stale DISPATCHING rows are rescued.
Manual retry creates a new publishAttemptId and new outbox row.
Outbox claim writes lockedBy as hostname:pid:workerInstanceUuid.
```

- [ ] **Step 7: Run tests**

Run:

```bash
npx prisma validate
./node_modules/.bin/tsx --test src/lib/publish/outbox.test.ts 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts' 'src/app/api/listings/[id]/retry-printify-route-source.test.ts'
```

Expected: PASS.

---

## Phase 5: Merchant Account Coordination And Rate Limit Handling

### Task 10: Add Merchant Account Lock With Atomic Release And Heartbeat

**Files:**
- Create: `src/lib/publish/merchant-account-lock.ts`
- Create: `src/lib/publish/merchant-account-lock.test.ts`
- Modify: `src/lib/jobs/workers/publish-worker.ts`

- [ ] **Step 1: Add lock tests**

Create `src/lib/publish/merchant-account-lock.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./merchant-account-lock.ts", import.meta.url), "utf8");

describe("merchant account lock", () => {
  it("uses Merchant account identity, not token string, when available", () => {
    assert.match(source, /merchantAccountId/);
    assert.doesNotMatch(source, /hashToken/);
  });

  it("releases atomically with Lua", () => {
    assert.match(source, /redis\.eval/);
    assert.match(source, /redis\.call\("GET"/);
    assert.match(source, /redis\.call\("DEL"/);
  });

  it("renews the lock while long publish work runs", () => {
    assert.match(source, /setInterval/);
    assert.match(source, /pexpire/i);
  });

  it("tracks lock loss and stops future Printify calls", () => {
    assert.match(source, /lockLost/);
    assert.match(source, /throwIfLockLost/);
  });
});
```

- [ ] **Step 2: Resolve Merchant account identity**

For v1, use the current persisted account row:

```text
merchantAccountId = PrintifyAccount.id
```

Known limitation: two `PrintifyAccount` rows backed by different PATs for the same real Printify Merchant account can still be treated as two buckets. Do not hash token to infer Merchant identity. If Printify exposes a stable Merchant identity later, add a migration that stores it and changes the lock/cooldown key source deliberately.

- [ ] **Step 3: Implement atomic lock**

Use `SET key value NX PX ttl` to acquire.

Release with Lua:

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
```

Renew with Lua or guarded `PEXPIRE` while token matches.

- [ ] **Step 4: Scope locks only to Printify work**

Do not hold the Merchant account lock for the whole publish job.

`EXISTING_SHOPIFY_DIRECT`:

```text
Shopify create/update/repair stage -> no Printify lock
runPrintifyStage upload/create/update -> acquire Printify lock
after Printify stage completes/fails -> release Printify lock
```

`PRINTIFY_SHOPIFY_CHANNEL`:

```text
Printify upload/create/publish -> acquire Printify lock
waiting for Shopify sync/repair/media/gallery -> release Printify lock
short GET Printify external/product poll -> acquire short Printify lock only around request/batch
```

Do not hold a Printify lock during long `sleep()` or Shopify-only polling.

- [ ] **Step 5: Stop work when heartbeat loses ownership**

The lock helper must expose:

```ts
type MerchantLockLease = {
  merchantAccountId: string;
  token: string;
  lockLost: boolean;
  throwIfLockLost(): void;
  release(): Promise<void>;
};
```

If renewal fails because the stored token no longer matches:

```text
set lockLost = true
stop issuing the next Printify request
do not release the newer worker's lock
delay or fail the attempt with a controlled lock-lost error
clear heartbeat timer in finally
```

- [ ] **Step 6: Avoid occupying worker slots while waiting**

Do not use long `while (true) sleep` inside an active processor. If lock is unavailable:

```ts
await job.updateData({
  ...job.data,
  lockWaitCount: (job.data.lockWaitCount ?? 0) + 1,
});
await job.moveToDelayed(Date.now() + delayMs, token);
throw new DelayedError();
```

Implementation requirements:

```text
processor must receive the BullMQ token
use moveToDelayed(..., token)
throw DelayedError immediately after moveToDelayed
DelayedError must not mark the job completed
DelayedError must not consume normal attemptsMade
lockWaitCount must be bounded; exceeding it marks the attempt failed with a clear lock-timeout error
worker must set maxStartedAttempts as a second guard
generic error handler must bypass DelayedError and rethrow it unchanged
```

The implementation must allow jobs for another Merchant account to use available worker slots. Do not return normally after moving a job to delayed state.

- [ ] **Step 7: Run lock tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/merchant-account-lock.test.ts src/lib/jobs/workers/publish-worker.test.ts
```

Expected: PASS.

---

### Task 11: Handle 429 With Retry-After, Jitter, And Endpoint Context

**Files:**
- Create: `src/lib/printify/request-gate.ts`
- Modify: `src/lib/publish/merchant-account-lock.ts`
- Modify: `src/lib/jobs/workers/publish-worker.ts`
- Modify: `src/lib/publish/errors.ts`
- Modify: `src/lib/printify/client.ts`
- Create: `src/lib/printify/request-gate.test.ts`
- Modify: tests from previous tasks

- [ ] **Step 1: Add tests for retry-after handling**

Tests must prove:

```text
429 with Retry-After uses that delay.
429 without Retry-After uses exponential backoff plus jitter.
Upload 429 is logged as upload endpoint rate limit, not product publishing quota.
Product publish 429 is logged as product publishing endpoint rate limit.
Every Printify 429 sets the affected account's general cooldown.
Catalog/product-publish 429 sets endpoint-specific cooldown in addition to general cooldown.
Another Merchant account can continue processing.
all Printify calls pass through PrintifyClient request hooks and the shared request gate.
```

- [ ] **Step 2: Use typed error metadata**

When catching `PrintifyRateLimitError`, read:

```ts
error.endpoint
error.method
error.retryAfterMs
error.status
```

- [ ] **Step 3: Add account cooldown buckets**

Add Redis cooldown keys:

```text
printify:cooldown:<merchantAccountId>:general
printify:cooldown:<merchantAccountId>:catalog
printify:cooldown:<merchantAccountId>:product-publish
```

Bucket selection:

```text
/any Printify 429 -> general
/uploads/images.json -> endpointCategory = upload for logs only; no upload cooldown bucket
/catalog/... -> catalog
/shops/:shopId/products/:productId/publish.json -> product-publish
everything else -> general
```

Endpoint category describes which request was blocked; it does not prove a separate upload quota exists. Because Printify has a global account limit, every 429 must set `general`. Set endpoint-specific cooldown only when the endpoint has a known additional quota, such as catalog or product publish. Upload 429 sets `general` only.

Before each Printify API call in either strategy's Printify stage, check:

```text
general cooldown
endpoint-specific cooldown for the request
```

If either is active, delay the current job with `moveToDelayed(..., token)` and throw `DelayedError`.

`EXISTING_SHOPIFY_DIRECT` must skip cooldown checks during Shopify create/repair, but it must check cooldown when it enters `runPrintifyStage()`.

- [ ] **Step 3A: Centralize cooldown in a Printify client wrapper**

Do not manually sprinkle cooldown checks only in the worker. Printify calls live in multiple helpers:

```text
uploads
catalog
product create/update
product publish
product GET/external poll
```

Implement request hooks in the shared Printify client instead of a wrapper that pretends to subclass/intercept private methods:

```ts
const client = new PrintifyClient(apiKey, {
  beforeRequest: async ({ endpoint, method }) => {
    await gate.beforeRequest({ merchantAccountId, endpoint, method });
  },
  onRateLimit: async ({ endpoint, method, retryAfterMs }) => {
    await gate.afterRateLimit({ merchantAccountId, endpoint, method, retryAfterMs });
  },
});
```

The client/gate layer must not know about BullMQ `Job`, worker token, or `DelayedError`.

Gate behavior:

```text
cooldown active -> throw PrintifyCooldownActiveError({ retryAt, merchantAccountId, endpoint, method })
PrintifyRateLimitError -> set cooldown metadata, then rethrow typed PrintifyRateLimitError
```

If `onRateLimit` fails while writing Redis cooldown metadata, log the cooldown write failure but rethrow the original `PrintifyRateLimitError`. Do not mask the original 429 with a Redis/logging failure, because the worker still needs the original endpoint/status/retry-after metadata to schedule the attempt safely.

BullMQ processor behavior:

```text
catch PrintifyCooldownActiveError or PrintifyRateLimitError with retryAt/retryAfterMs
update DB status = RETRY_SCHEDULED, nextRetryAt, reasonCode
job.moveToDelayed(retryAt, token)
throw DelayedError
```

Direct and Channel must both use this hooked client for Printify work. Shopify-only calls must not go through it.

- [ ] **Step 4: Schedule retry without global queue pause**

Do not pause all accounts for an upload 429. Re-schedule only the affected publish attempt/account where possible.

On 429:

```text
delayMs = error.retryAfterMs ?? exponentialBackoffWithJitter(...)
set general cooldown key for merchantAccountId with PX delayMs
if endpoint has additional documented quota, set endpoint-specific cooldown with PX delayMs
increment bounded rateLimitDelayCount
move current job to delayed state
throw DelayedError
```

`DelayedError` must not consume normal BullMQ attempts. If `rateLimitDelayCount` exceeds the configured limit, mark the attempt final failed with `PRINTIFY_RATE_LIMITED` instead of delaying forever.

- [ ] **Step 5: Add endpoint metrics/log fields**

Log structured fields:

```text
listingId
publishAttemptId
merchantAccountId
endpoint
method
status
retryAfterMs
requestId
bucket
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/jobs/workers/publish-worker.test.ts src/lib/publish/errors.test.ts src/lib/printify/client.test.ts src/lib/printify/request-gate.test.ts
```

Expected: PASS.

---

## Phase 6: UI And Observability

### Task 12: Add Stable Error Codes And Vietnamese Messages

**Files:**
- Create: `src/lib/publish/errors.ts`
- Create: `src/lib/publish/errors.test.ts`
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`
- Modify: `src/app/(authed)/wizard/[draftId]/step-5-source.test.ts`

- [ ] **Step 1: Add error code tests**

Create `src/lib/publish/errors.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publishUserMessageForCode } from "./errors";

describe("publish user messages", () => {
  it("uses Vietnamese user-facing messages", () => {
    assert.equal(
      publishUserMessageForCode("PRINTIFY_RATE_LIMITED"),
      "Printify đang giới hạn tần suất yêu cầu. Hệ thống sẽ tự thử lại.",
    );
  });

  it("does not expose technical raw errors for unknown codes", () => {
    assert.equal(
      publishUserMessageForCode("UNKNOWN"),
      "Có lỗi xảy ra khi publish. Vui lòng thử lại hoặc liên hệ kỹ thuật.",
    );
  });

  it("uses manual-recovery messages for ambiguous external writes", () => {
    assert.equal(
      publishUserMessageForCode("PRINTIFY_AMBIGUOUS_WRITE"),
      "Chưa xác nhận được trạng thái cập nhật trên Printify. Vui lòng kiểm tra sản phẩm và thử lại thủ công.",
    );
    assert.equal(
      publishUserMessageForCode("SHOPIFY_AMBIGUOUS_WRITE"),
      "Chưa xác nhận được trạng thái cập nhật trên Shopify. Vui lòng kiểm tra sản phẩm và thử lại thủ công.",
    );
    assert.equal(
      publishUserMessageForCode("SHOPIFY_MEDIA_AMBIGUOUS_WRITE"),
      "Shopify có thể đã nhận hình ảnh nhưng hệ thống chưa xác nhận được kết quả. Vui lòng kiểm tra hình ảnh và thử lại thủ công.",
    );
  });
});
```

- [ ] **Step 2: Add stable codes**

Create:

```ts
export type PublishErrorCode =
  | "PRINTIFY_RATE_LIMITED"
  | "PRINTIFY_AMBIGUOUS_WRITE"
  | "PRINTIFY_AUTHENTICATION_FAILED"
  | "PRINTIFY_PERMISSION_DENIED"
  | "PRINTIFY_BILLING_REQUIRED"
  | "PRINTIFY_VALIDATION_FAILED"
  | "PRINTIFY_SERVER_ERROR"
  | "PUBLISH_ENQUEUE_FAILED"
  | "SHOPIFY_AMBIGUOUS_WRITE"
  | "SHOPIFY_MEDIA_AMBIGUOUS_WRITE"
  | "SHOPIFY_SYNC_TIMEOUT"
  | "SHOPIFY_PERMISSION_DENIED"
  | "UNKNOWN";
```

Add Vietnamese messages for ambiguous manual-recovery errors:

```ts
const PUBLISH_ERROR_MESSAGES: Record<PublishErrorCode, string> = {
  PRINTIFY_RATE_LIMITED:
    "Printify đang giới hạn tần suất yêu cầu. Hệ thống sẽ tự thử lại.",
  PRINTIFY_AMBIGUOUS_WRITE:
    "Chưa xác nhận được trạng thái cập nhật trên Printify. Vui lòng kiểm tra sản phẩm và thử lại thủ công.",
  PRINTIFY_AUTHENTICATION_FAILED:
    "Kết nối Printify không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại tài khoản Printify.",
  PRINTIFY_PERMISSION_DENIED:
    "Tài khoản Printify thiếu quyền cần thiết để publish sản phẩm.",
  PRINTIFY_BILLING_REQUIRED:
    "Tài khoản Printify cần được kiểm tra gói dịch vụ hoặc giới hạn sử dụng.",
  PRINTIFY_VALIDATION_FAILED:
    "Printify từ chối dữ liệu sản phẩm. Vui lòng kiểm tra lại cấu hình sản phẩm.",
  PRINTIFY_SERVER_ERROR:
    "Printify đang gặp lỗi tạm thời. Hệ thống sẽ tự thử lại nếu an toàn.",
  PUBLISH_ENQUEUE_FAILED:
    "Không thể đưa job publish vào hàng đợi. Vui lòng thử lại sau.",
  SHOPIFY_AMBIGUOUS_WRITE:
    "Chưa xác nhận được trạng thái cập nhật trên Shopify. Vui lòng kiểm tra sản phẩm và thử lại thủ công.",
  SHOPIFY_MEDIA_AMBIGUOUS_WRITE:
    "Shopify có thể đã nhận hình ảnh nhưng hệ thống chưa xác nhận được kết quả. Vui lòng kiểm tra hình ảnh và thử lại thủ công.",
  SHOPIFY_SYNC_TIMEOUT:
    "Shopify chưa đồng bộ sản phẩm trong thời gian cho phép. Hệ thống sẽ thử lại nếu an toàn.",
  SHOPIFY_PERMISSION_DENIED:
    "Tài khoản Shopify thiếu quyền cần thiết để publish sản phẩm.",
  UNKNOWN:
    "Có lỗi xảy ra khi publish. Vui lòng thử lại hoặc liên hệ kỹ thuật.",
};
```

- [ ] **Step 3: Store technical details separately**

Use:

```text
lastErrorCode
lastError: Vietnamese message
progressData.technicalError: {
  status
  endpoint
  method
  requestId
  retryAfterMs
  sanitizedMessage
}
nextRetryAt
reasonCode
```

If schema lacks `last_error_code`, add it to `publish_jobs`; otherwise store the code under `progressData.errorCode` until a migration is approved.

Do not store raw `stack`, raw response body, request headers, tokens, or full serialized exception objects in data returned to the client. Server logs may include raw details only after redaction and truncation.

- [ ] **Step 4: Add Step 5 cross-process polling**

Because `src/lib/sse/channel.ts` uses an in-memory `EventEmitter`, events emitted by the standalone PM2 worker cannot reach SSE clients connected to the Next.js process. Step 5 must poll persisted state while any listing/attempt is active:

```text
interval: 2-5 seconds
endpoint: existing draft API with expanded listing/publish job state, or a focused publish-status API
active states: PENDING, RUNNING, WAITING_EXTERNAL, RETRY_SCHEDULED
stop polling: all listings ACTIVE, FAILED, PARTIAL_FAILURE, or attempt terminal
```

SSE can remain as a fast-path optimization, but correctness must come from DB/API polling. This should mirror the Step 3 fallback polling pattern already used for cross-process mockup updates.

- [ ] **Step 5: Update Step 5 states**

Render clear Vietnamese phases:

```text
Đang chuẩn bị dữ liệu
Đang tải thiết kế lên Printify
Đang tạo sản phẩm Printify
Đang publish sang Shopify
Đang chờ Shopify đồng bộ
Đang sửa tùy chọn và hình ảnh
Đang xác minh sản phẩm
Đang thử lại
Hoàn tất
```

When `status = RETRY_SCHEDULED` and `nextRetryAt` exists, render a Vietnamese retry ETA, for example:

```text
Printify đang giới hạn yêu cầu. Hệ thống sẽ thử lại lúc 10:32.
```

Do not show final "Thất bại" while BullMQ has attempts remaining.

- [ ] **Step 6: Add UI/source tests**

Tests must prove:

```text
Step 5 starts periodic polling while publish is active.
Step 5 does not rely only on EventSource/SSE.
Step 5 renders RETRY_SCHEDULED as "Đang thử lại".
Step 5 renders nextRetryAt when available.
Step 5 does not render raw technicalError.stack or raw responseBody.
Step 5 maps stable error codes to Vietnamese messages.
```

- [ ] **Step 7: Run UI/source tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/errors.test.ts 'src/app/(authed)/wizard/[draftId]/step-5-source.test.ts'
```

Expected: PASS.

---

## Phase 7: Production Recovery

### Task 13: Recover Existing Stuck Listings Only After Deployment

**Files:**
- No repo file changes by default.
- This task is operational and must be explicitly approved before any production DB write.

- [ ] **Step 1: Confirm new queue contract is deployed**

Verify production logs show:

```text
Publish worker is ready and listening to queue.
```

Verify app build contains:

```text
User-Agent on Printify requests
no base64 fallback for 429
publish job final failure handling
```

- [ ] **Step 2: Read-only verification query**

On production:

```sql
select l.id, l.wizard_draft_id, l.status as listing_status,
       l.active_publish_attempt_id,
       pa.id as publish_attempt_id, pa.status as attempt_status, pa.completed_at as attempt_completed_at,
       po.id as outbox_id, po.status as outbox_status,
       pj.id as publish_job_id, pj.stage, pj.status as job_status, pj.last_error
from listings l
left join publish_attempts pa on pa.listing_id = l.id
left join publish_outbox po on po.publish_attempt_id = pa.id
left join publish_jobs pj on pj.publish_attempt_id = pa.id
where l.wizard_draft_id in ('cmrot82lu019oqgzspvfkffx0','cmrotrgp901bdqgzsh51a9l9y')
order by l.id, pa.created_at nulls last, pj.stage;
```

If checking legacy rows before backfill, use a separate query for `publish_jobs` that still lack `publish_attempt_id`. Do not join attempt rows to all jobs by `listing_id`, because multiple attempts would create a cross-product and misleading statuses.

- [ ] **Step 3: Ask for explicit approval before DB write**

Do not run any update until the user approves.

- [ ] **Step 4: If approved, mark stale running/pending jobs failed with Vietnamese message**

Use a reviewed SQL update that sets:

```text
publish_jobs.status = FAILED
publish_jobs.last_error_code or progressData.errorCode = PRINTIFY_RATE_LIMITED
publish_jobs.last_error = "Printify đang giới hạn tần suất yêu cầu. Vui lòng thử lại."
publish_jobs.progressData.technicalError = sanitized metadata only
publish_jobs.completed_at = now()

publish_attempts.status = FAILED
publish_attempts.completed_at = now()

listings.status = FAILED or PARTIAL_FAILURE based on strategy-aware persisted stage state
listings.active_publish_attempt_id = null only when it equals the recovered publishAttemptId

publish_outbox.status = DEAD for the recovered attempt if an outbox row exists and is not DISPATCHED
```

- [ ] **Step 5: Verify UI shows retry/error instead of endless publishing**

Open Step 5 and confirm the button/state is no longer stuck in `PUBLISHING`.

---

## Behavioral Acceptance Tests

These tests are required before implementation is considered done. Source-contract tests may stay as cheap guardrails, but they are not sufficient.

- [ ] BullMQ processor receives a 429/`PrintifyRateLimitError`, updates the DB to `RETRY_SCHEDULED`, and does not mark listing/job final `FAILED` on an intermediate attempt.
- [ ] BullMQ final attempt uses checkpoint-aware finalizer: Direct persisted `shopifyProductId` + Shopify stage failure in existing flow -> `PARTIAL_FAILURE`; Direct Shopify success + Printify failure -> `PARTIAL_FAILURE`; Channel Printify failure before Shopify sync -> `FAILED`; all required existing flow checks pass -> `ACTIVE`.
- [ ] BullMQ failed/stalled/maxStartedAttempts terminal paths run the same idempotent finalizer as the processor final-attempt path.
- [ ] Fatal validation error updates DB and then throws `UnrecoverableError`.
- [ ] `DelayedError` after `moveToDelayed(..., token)` does not mark the job completed and does not consume the normal retry attempt count.
- [ ] Outbox crash after enqueue but before `DISPATCHED` does not create a duplicate BullMQ job for the same `publishAttemptId`.
- [ ] Redis enqueue failure reschedules outbox with `PENDING + nextAttemptAt` without double-incrementing attempts; only max failures move to `DEAD` and close PublishAttempt/active pointer.
- [ ] Old `publishAttemptId` cannot update a listing/job after a newer active attempt exists.
- [ ] Double-click/manual retry returns the current active attempt instead of starting a second concurrent attempt.
- [ ] Two initial publish requests for the same draft running concurrently create only one set of listings, attempts, jobs, and outbox rows because the route guards by tenantId + wizardDraftId before listing creation.
- [ ] Manual retry creates a new attempt but carries forward only safe succeeded checkpoints: Direct previous SHOPIFY `SUCCEEDED` + `shopifyProductId` skips `publishToShopify`; Channel previous PRINTIFY `SUCCEEDED` + `printifyProductId` skips Printify create/update/publish.
- [ ] Manual retry does not carry forward FAILED/PENDING/RUNNING stages and does not treat a product ID alone as proof that a stage completed.
- [ ] Step 5 receives progress through DB/API polling even when the worker is a different process from the web process.
- [ ] Shopify Direct publish goes through queue/outbox/idempotency while preserving existing final checks; it does not acquire Printify lock/cooldown during Shopify stage, but does acquire Printify lock/cooldown during `runPrintifyStage()`.
- [ ] Shopify/Printify/media mutation timeout with ambiguous write status throws `AmbiguousExternalWriteError`, terminalizes the attempt for manual recovery, and receives no second BullMQ execution.
- [ ] `firstExternalWriteStartedAt` is persisted immediately before the first Printify/Shopify external write, remains null for cooldown/lock/outbox-only failures, and watchdog reconciliation after restart uses it to preserve baseline status correctly.
- [ ] Printify Shopify Channel publish acquires Merchant lock, respects cooldown, and does not block another Merchant account.
- [ ] Any Printify 429 sets general Merchant account cooldown; catalog/product-publish 429 also sets endpoint-specific cooldown.
- [ ] Lock heartbeat ownership loss stops the worker before the next Printify request and does not release another worker's lock.
- [ ] BullMQ implementation preserves existing Shopify media/WebP/post-sync flow boundaries: no `ListingMedia`, no `CanonicalVariantRow`, no `uploadMedia: false`, no Shopify mutation shape changes, no reorder of `publishToShopify -> repairAndVerifyShopifyPostSync -> publishShopifyChannelsStrict`.
- [ ] No-flow-change source tests extract the real Direct/Channel strategy blocks and verify the full current sequence, including category, collections, variant mapping, optional Printify unpublish, and finalization; they do not search the whole file with unscoped `source.indexOf(...)`.
- [ ] Placement payload fix keeps `PRINTIFY_SHOPIFY_CHANNEL` on `buildFullWidthPlacementData()` and asserts paired light/dark areas use the right image IDs, variant IDs, and `scale = 1`.
- [ ] Outbox `DEAD` and pre-external-stage failures use `PublishAttempt.baselineListingStatus`: baseline `ACTIVE` is restored and baseline `PARTIAL_FAILURE` is preserved instead of being downgraded to `FAILED`.
- [ ] URL upload error code `10300` falls back to base64 only when parsed from JSON and the file is within the size limit.
- [ ] 401, 402, 403, 422, 429, 5xx, and unknown network errors do not trigger base64 fallback.
- [ ] Retry after one light/dark image upload succeeds reuses the persisted image ID and uploads only the missing side.
- [ ] Retry after product creation reuses persisted Printify/Shopify IDs and does not create duplicate products.
- [ ] User-facing UI renders only Vietnamese stable messages; raw body, stack, token, headers, and serialized exceptions are absent from client data.

---

## Focused Verification Commands

Run after implementation:

```bash
./node_modules/.bin/tsx --test \
  src/lib/printify/client.test.ts \
  src/lib/printify/request-gate.test.ts \
  src/lib/printify/product.test.ts \
  src/lib/publish/errors.test.ts \
  src/lib/publish/shopify.test.ts \
  src/lib/publish/shopify-post-sync.test.ts \
  src/lib/publish/worker.test.ts \
  src/lib/publish/queue.test.ts \
  src/lib/publish/outbox.test.ts \
  src/lib/publish/merchant-account-lock.test.ts \
  src/lib/jobs/workers/publish-worker.test.ts \
  'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts' \
  'src/app/api/listings/[id]/retry-printify-route-source.test.ts' \
  'src/app/(authed)/wizard/[draftId]/step-5-source.test.ts'
```

Run build:

```bash
npm run build
```

If `next/font` fails in sandbox because it cannot fetch Google Fonts, record the exact environment failure and rely on the focused tests until a network-enabled build can run.

---

## Approval Checklist

- [ ] Approve Phase 1 Printify client hardening before queue work.
- [ ] Approve Phase 2 idempotency work before automatic retry.
- [ ] Approve `publishAttemptId` instead of fixed `publish-${listingId}`.
- [ ] Approve transactional outbox or explicitly choose the smaller compensation/watchdog fallback.
- [ ] Approve Merchant-account coordination model and define the current Merchant identity source.
- [ ] Approve Redis atomic release and heartbeat renewal requirement.
- [ ] Approve that worker must not wait on lock while holding an active slot indefinitely.
- [ ] Approve Vietnamese user-facing error codes/messages.
- [ ] Approve production recovery only after the new queue/failure contract is deployed.
