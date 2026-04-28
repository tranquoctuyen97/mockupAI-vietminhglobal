# Phase C Real Printify Mockups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace synthetic/local mockup previews with real Printify-rendered mockups in Wizard Step 3, while safely caching Printify draft product/image IDs for reuse during publish and cleanup.

**Architecture:** Add a Printify product service layer that can upload the design once, create/update a Printify product used as a draft preview source, poll product images, and persist those images into `MockupImage`. Step 3 stays behind feature flag `printify_real_mockups`; publish reuse of the draft product is implemented after the mockup flow is stable to avoid duplicate Shopify products.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, BullMQ/Redis, Printify REST API, React client components, Node test runner via `tsx --test`.

---

## Scope And Decisions

Phase C is split into four safe cuts:

1. **C.1 Backend foundation:** schema, Printify client/service, payload builders, polling worker, unit tests.
2. **C.2 Step 3 integration:** `/api/mockup-jobs` creates/updates Printify draft product and `MockupGallery` renders real Printify image URLs.
3. **C.3 Publish reuse:** publish worker can reuse `WizardDraft.printifyDraftProductId` behind a feature flag, with explicit behavior for Shopify ownership.
4. **C.4 Cleanup:** deleting a draft deletes the Printify draft product; cleanup command/worker handles abandoned drafts.

Important implementation decisions for this repo:

- `Store.printifyShopId` is an internal `PrintifyShop.id`; use `getClientForStore(store.id)` to get `externalShopId`.
- Do not put raw Printify API keys in BullMQ payloads. Queue payloads carry `storeId`, `draftId`, `productId`, and `mockupJobId`; workers call `getClientForStore(storeId)`.
- Keep existing synthetic mockup generation as fallback and as the default when `printify_real_mockups` is disabled.
- Initial real mockup flow uses `MockupJob.totalImages = 0` while Printify is rendering; the gallery shows an indeterminate “Printify đang render mockups...” state until images are persisted.
- Do not send `visible` or `is_locked` in create/update payloads for Step 3. Official Printify product examples show `images`, `visible`, and `is_locked` as product response properties; the product is not pushed to the sales channel until the publish endpoint is called.
- Publish reuse is gated separately with `printify_reuse_draft_product` because current publish worker creates Shopify product directly before Printify. Switching ownership to Printify publish can create duplicate Shopify products if done in the same cut.

Printify API references checked while writing this plan:

- Products support list/get/create/update/delete/publish endpoints under `/v1/shops/{shop_id}/products...`.
- Product image positioning uses normalized `x`, `y`, `scale`, and `angle` with `x=0.5`, `y=0.5` as the placeholder center.
- `visible` is documented as read-only product state, and publish uses `POST /v1/shops/{shop_id}/products/{product_id}/publish.json`.

## File Map

Create:

- `prisma/migrations/0019_phase_c_printify_mockups/migration.sql` — add cached Printify IDs and mockup image metadata.
- `src/lib/printify/product.ts` — high-level Printify product/image/mockup functions.
- `src/lib/printify/product.test.ts` — payload, polling, parse tests.
- `src/lib/mockup/printify-poll-worker.ts` — BullMQ worker that polls Printify and persists `MockupImage`.
- `src/lib/mockup/printify-poll-worker.test.ts` — persistence and failure tests for the poll worker helpers.
- `src/lib/wizard/cleanup.ts` — draft cleanup with Printify product deletion.
- `src/lib/wizard/cleanup.test.ts` — cleanup behavior tests.

Modify:

- `prisma/schema.prisma` — add `WizardDraft.printifyDraftProductId`, `WizardDraft.printifyImageId`, and metadata on `MockupImage`.
- `src/lib/printify/client.ts` — add upload/product/get/delete/publish methods, make API access typed.
- `src/lib/printify/account.ts` — keep `getClientForStore()` as the credential boundary; do not expose raw key.
- `src/lib/mockup/queue.ts` — add Printify poll queue or explicit poll payload type.
- `src/lib/queue/workers/mockup-worker.ts` — start both composite and Printify polling workers.
- `src/instrumentation.ts` — confirm the new worker starts in Node runtime.
- `src/app/api/mockup-jobs/route.ts` — feature-flagged real Printify flow with synthetic fallback.
- `src/app/api/mockup-jobs/[id]/route.ts` — support jobs that have no images yet while polling.
- `src/components/mockup/MockupGallery.tsx` — group real mockups by camera/angle and support indeterminate polling.
- `src/app/(authed)/wizard/[draftId]/step-3/page.tsx` — display real mockup polling state and stale regenerate behavior.
- `src/lib/wizard/state.ts` — route draft deletion through cleanup.
- `src/app/api/wizard/drafts/[id]/route.ts` — DELETE uses cleanup without blocking on Printify failure.
- `src/lib/publish/worker.ts` — C.3 publish reuse path behind `printify_reuse_draft_product`.
- `src/lib/publish/printify.ts` — either delegate to `src/lib/printify/product.ts` or shrink to publish-only compatibility wrapper.
- `src/app/api/listings/[id]/retry-printify/route.ts` — reuse the same Printify product service path.

## Task 1: Schema Migration And Prisma Types

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0019_phase_c_printify_mockups/migration.sql`
- Test: `src/lib/wizard/state.test.ts`

- [ ] **Step 1: Add Prisma fields**

Modify `model WizardDraft`:

```prisma
  printifyDraftProductId String?  @map("printify_draft_product_id")
  printifyImageId        String?  @map("printify_image_id")
```

Modify `model MockupImage`:

```prisma
  mockupType         String  @default("front") @map("mockup_type")
  isDefault          Boolean @default(false) @map("is_default")
  cameraLabel        String? @map("camera_label")
```

Add this index to `model MockupImage`:

```prisma
  @@index([mockupJobId, isDefault])
```

- [ ] **Step 2: Create SQL migration**

Create `prisma/migrations/0019_phase_c_printify_mockups/migration.sql`:

```sql
ALTER TABLE "wizard_drafts"
  ADD COLUMN "printify_draft_product_id" TEXT,
  ADD COLUMN "printify_image_id" TEXT;

ALTER TABLE "mockup_images"
  ADD COLUMN "mockup_type" TEXT NOT NULL DEFAULT 'front',
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "camera_label" TEXT;

CREATE INDEX "mockup_images_mockup_job_id_is_default_idx"
  ON "mockup_images"("mockup_job_id", "is_default");
```

- [ ] **Step 3: Generate Prisma client and verify migration shape**

Run:

```bash
npx prisma generate
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/phase-c-schema.sql
rg "printify_draft_product_id|mockup_type|is_default|camera_label" /tmp/phase-c-schema.sql
```

Expected: generated SQL contains all new columns and the new index.

- [ ] **Step 4: Run current tests**

Run:

```bash
npx tsx --test $(rg --files -g '*.test.ts' src)
```

Expected: all existing tests pass before behavior changes.

## Task 2: Printify Client Methods

**Files:**
- Modify: `src/lib/printify/client.ts`
- Test: `src/lib/printify/product.test.ts`

- [ ] **Step 1: Add public methods to `PrintifyClient`**

Add these interfaces and class methods in `src/lib/printify/client.ts`:

```ts
export interface PrintifyUploadImageResponse {
  id: string;
  file_name?: string;
  height?: number;
  width?: number;
  preview_url?: string;
}

export interface PrintifyProductImage {
  id?: string;
  src: string;
  variant_ids?: number[];
  position?: string;
  is_default?: boolean;
}

export interface PrintifyProductResponse {
  id: string;
  title: string;
  images?: PrintifyProductImage[];
  variants?: Array<{ id: number; is_enabled?: boolean }>;
}

async uploadImageBase64(input: {
  fileName: string;
  contentsBase64: string;
}): Promise<PrintifyUploadImageResponse>;

async createProduct(
  shopId: number,
  payload: unknown,
): Promise<PrintifyProductResponse>;

async updateProduct(
  shopId: number,
  productId: string,
  payload: unknown,
): Promise<PrintifyProductResponse>;

async getProduct(
  shopId: number,
  productId: string,
): Promise<PrintifyProductResponse>;

async deleteProduct(
  shopId: number,
  productId: string,
): Promise<void>;

async publishProduct(
  shopId: number,
  productId: string,
  payload: {
    title: boolean;
    description: boolean;
    images: boolean;
    variants: boolean;
    tags: boolean;
    keyFeatures?: boolean;
    shippingTemplate?: boolean;
  },
): Promise<unknown>;
```

Implementation detail: keep `request<T>()` private and call these endpoints:

```ts
POST /uploads/images.json
POST /shops/{shopId}/products.json
PUT /shops/{shopId}/products/{productId}.json
GET /shops/{shopId}/products/{productId}.json
DELETE /shops/{shopId}/products/{productId}.json
POST /shops/{shopId}/products/{productId}/publish.json
```

- [ ] **Step 2: Keep auth/rate-limit behavior unchanged**

Run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors and existing `PrintifyAuthError`, `PrintifyRateLimitError`, `PrintifyApiError` behavior remains intact.

## Task 3: Printify Product Service

**Files:**
- Create: `src/lib/printify/product.ts`
- Create: `src/lib/printify/product.test.ts`
- Modify: `src/lib/placement/printify-map.ts` only if coordinate mismatch is found in tests

- [ ] **Step 1: Write tests for parsing Printify images**

Create `src/lib/printify/product.test.ts` with tests for:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parsePrintifyMockupImages } from "./product";

test("parsePrintifyMockupImages keeps real image urls and camera metadata", () => {
  const images = parsePrintifyMockupImages("product-1", [
    {
      id: "img-front",
      src: "https://images.printify.com/front.png",
      variant_ids: [101, 102],
      position: "front",
      is_default: true,
    },
    {
      id: "img-person-1",
      src: "https://images.printify.com/person.png",
      variant_ids: [101],
      position: "front",
      is_default: false,
    },
  ]);

  assert.equal(images.length, 2);
  assert.equal(images[0].printifyMockupId, "img-front");
  assert.equal(images[0].mockupType, "front");
  assert.equal(images[0].cameraLabel, "Front");
  assert.equal(images[0].isDefault, true);
  assert.deepEqual(images[0].variantIds, [101, 102]);
});
```

- [ ] **Step 2: Write tests for product payload multi-view print areas**

Add a test that calls `buildPrintifyProductPayload()` with `_default.front` and `_default.back` placements and expects:

```ts
assert.deepEqual(
  payload.print_areas.map((area) => area.placeholders.map((p) => p.position)),
  [["front", "back"]],
);
assert.deepEqual(payload.variants.map((v) => v.id), [101, 102]);
assert.equal("visible" in payload, false);
assert.equal("is_locked" in payload, false);
```

- [ ] **Step 3: Implement `src/lib/printify/product.ts`**

Export these functions:

```ts
export interface EnsurePrintifyImageInput {
  client: PrintifyClient;
  designStoragePath: string;
  cachedImageId?: string | null;
  storage?: ReturnType<typeof getStorage>;
}

export async function ensurePrintifyImage(input: EnsurePrintifyImageInput): Promise<string>;

export function buildPrintifyProductPayload(input: {
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  variantIds: number[];
  imageId: string;
  placementData: PlacementData;
  tags?: string[];
}): Record<string, unknown>;

export async function createOrUpdatePrintifyProduct(input: {
  client: PrintifyClient;
  shopId: number;
  productId?: string | null;
  blueprintId: number;
  printProviderId: number;
  variantIds: number[];
  imageId: string;
  placementData: PlacementData;
  title: string;
  description: string;
  tags?: string[];
}): Promise<{ productId: string; images: ParsedPrintifyMockupImage[] }>;

export async function pollPrintifyMockups(input: {
  client: PrintifyClient;
  shopId: number;
  productId: string;
  maxWaitMs: number;
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ParsedPrintifyMockupImage[]>;
```

Payload rules:

- `print_areas[0].variant_ids` equals all enabled variant IDs.
- `print_areas[0].placeholders` contains one placeholder per enabled placement view.
- Use `resolvePlacementViews()` and `resolvePlacement()` from `src/lib/mockup/plan.ts` / `src/lib/placement/resolver.ts`.
- Do not include `visible` or `is_locked` in Step 3 payloads. These are response/publishing-state fields in the official examples, and sales-channel publishing is controlled through the publish endpoint.
- Convert our placement to Printify coordinates through a single function. Prefer `mmToPrintifyCoords` parity from `src/lib/publish/printify.ts` for MVP unless test evidence proves `src/lib/placement/printify-map.ts` is the correct Printify product payload format.

- [ ] **Step 4: Add polling timeout tests**

Add tests:

```ts
test("pollPrintifyMockups resolves when product images appear", async () => {
  let calls = 0;
  const client = {
    getProduct: async () => {
      calls += 1;
      return calls === 1
        ? { id: "p1", title: "Draft", images: [] }
        : { id: "p1", title: "Draft", images: [{ src: "https://img", position: "front" }] };
    },
  } as unknown as PrintifyClient;

  const images = await pollPrintifyMockups({
    client,
    shopId: 123,
    productId: "p1",
    maxWaitMs: 10_000,
    intervalMs: 1,
    sleep: async () => undefined,
  });

  assert.equal(images.length, 1);
});
```

Expected timeout test throws `PrintifyMockupTimeoutError`.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npx tsx --test src/lib/printify/product.test.ts
```

Expected: all product service tests pass.

## Task 4: Printify Poll Worker

**Files:**
- Modify: `src/lib/mockup/queue.ts`
- Create: `src/lib/mockup/printify-poll-worker.ts`
- Create: `src/lib/mockup/printify-poll-worker.test.ts`
- Modify: `src/lib/queue/workers/mockup-worker.ts`
- Modify: `src/instrumentation.ts`

- [ ] **Step 1: Add queue and payload**

In `src/lib/mockup/queue.ts`, add:

```ts
export const PRINTIFY_MOCKUP_QUEUE_NAME = "printify-mockup-poll-queue";

export const printifyMockupQueue =
  globalForQueue.printifyMockupQueue ||
  new Queue<PrintifyMockupPollPayload>(PRINTIFY_MOCKUP_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

export interface PrintifyMockupPollPayload {
  mockupJobId: string;
  draftId: string;
  storeId: string;
  productId: string;
}
```

Update the global type:

```ts
const globalForQueue = global as unknown as {
  mockupQueue: Queue;
  printifyMockupQueue: Queue<PrintifyMockupPollPayload>;
};
```

- [ ] **Step 2: Write persistence helper test**

Create a pure helper in `src/lib/mockup/printify-poll-worker.ts`:

```ts
export function buildMockupImageRows(input: {
  mockups: ParsedPrintifyMockupImage[];
  variantColorLookup: Map<number, { colorName: string }>;
}): Array<{
  printifyMockupId: string;
  variantId: number;
  colorName: string;
  viewPosition: string;
  sourceUrl: string;
  compositeUrl: string;
  compositeStatus: "completed";
  mockupType: string;
  isDefault: boolean;
  cameraLabel: string | null;
  included: boolean;
  sortOrder: number;
}>;
```

Test expectations:

- one row per `(mockup image, representative variant)` pair
- `compositeUrl` equals `sourceUrl`
- default images have `included: true`
- non-default images have `included: false`

- [ ] **Step 3: Implement worker**

The worker must:

1. Load `MockupJob` by `mockupJobId`, include `draft.store.colors`.
2. Call `getClientForStore(storeId)` and use `externalShopId`.
3. Call `pollPrintifyMockups({ client, shopId: externalShopId, productId })`.
4. Delete existing `mockupImage` rows for that job only after polling succeeds.
5. Create new `mockupImage` rows with `compositeStatus: "completed"`.
6. Update `mockupJob` to `completed`, `totalImages = createdRows.length`, `completedImages = createdRows.length`, `failedImages = 0`.
7. Update draft `mockupsStale = false`, `mockupsStaleReason = null`.
8. On final failure, update `mockupJob.status = "failed"` and `errorMessage`.

- [ ] **Step 4: Start worker**

Modify `src/lib/queue/workers/mockup-worker.ts`:

```ts
import { mockupWorker } from "@/lib/mockup/worker";
import { printifyMockupPollWorker } from "@/lib/mockup/printify-poll-worker";

export function startMockupWorker() {
  console.log("[MockupWorker] Ensuring workers are started via instrumentation.");
  return { mockupWorker, printifyMockupPollWorker };
}
```

Run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

## Task 5: Feature-Flagged `/api/mockup-jobs` Real Printify Flow

**Files:**
- Modify: `src/app/api/mockup-jobs/route.ts`
- Modify: `src/app/api/mockup-jobs/[id]/route.ts`
- Test: `src/lib/mockup/plan.test.ts`

- [ ] **Step 1: Preserve synthetic fallback**

Keep current `buildMockupImagePlan()` path in a helper function:

```ts
async function createSyntheticMockupJob(input: {
  draft: DraftWithStoreDesign;
  draftId: string;
}): Promise<NextResponse>;
```

The existing behavior remains active when:

- `printify_real_mockups` feature flag is disabled
- Printify account/shop is missing
- Printify product creation fails with a recoverable network error and the user has not explicitly enabled strict real mockups

- [ ] **Step 2: Add real Printify branch**

In `POST /api/mockup-jobs`:

1. Validate draft, design, store, template, selected colors, enabled variants as today.
2. Check `isEnabled("printify_real_mockups")`.
3. If disabled, call synthetic helper.
4. If enabled, call `getClientForStore(draft.storeId!)`.
5. Call `ensurePrintifyImage()` with `draft.design.storagePath` and `draft.printifyImageId`.
6. If a new image ID is returned, update `wizardDraft.printifyImageId`.
7. Resolve placement via `resolveEffectivePlacementData(draft.placementOverride, draft.store.template.defaultPlacement)`.
8. Call `createOrUpdatePrintifyProduct()` with:

```ts
{
  client,
  shopId: externalShopId,
  productId: draft.printifyDraftProductId,
  blueprintId: draft.store.template.printifyBlueprintId,
  printProviderId: draft.store.template.printifyPrintProviderId,
  variantIds: enabledVariantIds,
  imageId,
  placementData,
  title: `[DRAFT] ${draft.design.originalFilename ?? draft.design.name ?? draft.id}`,
  description: "MockupAI draft product for preview generation",
}
```

9. If product ID changed from null, update `wizardDraft.printifyDraftProductId`.
10. Create `MockupJob` with `status: "running"`, `totalImages: initialImages.length`, `completedImages: initialImages.length` if initial images exist, `placementSnapshot`.
11. If initial images exist, persist them immediately as completed rows and mark job completed.
12. If initial images are empty, enqueue `printifyMockupQueue.add("poll-printify-mockups", { mockupJobId, draftId, storeId, productId })`.

- [ ] **Step 3: Update job GET for indeterminate polling**

In `src/app/api/mockup-jobs/[id]/route.ts`, keep status computation but do not mark a `running` job with `totalImages = 0` as completed.

Rule:

```ts
const isFinished =
  job.totalImages > 0 &&
  job.completedImages + job.failedImages >= job.totalImages;
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx tsc --noEmit
npx tsx --test src/lib/mockup/plan.test.ts src/lib/printify/product.test.ts
```

Expected: all targeted tests pass.

## Task 6: Mockup Gallery UI For Real Printify Angles

**Files:**
- Modify: `src/components/mockup/MockupGallery.tsx`
- Modify: `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`

- [ ] **Step 1: Extend `MockupImage` UI type**

Add fields:

```ts
mockupType?: string | null;
isDefault?: boolean;
cameraLabel?: string | null;
```

- [ ] **Step 2: Add camera grouping**

Replace color-only grouping with two-level grouping:

- primary selected color
- camera/angle list for that color

Display rules:

- If `isPolling && progress.total === 0`, show `Printify đang render mockups...` with spinner.
- Hero image is the first included default image, else first completed image.
- Angle chips show `cameraLabel ?? mockupType ?? viewPosition`.
- Color sections remain available because seller still needs to choose which mockups are included.

- [ ] **Step 3: Keep source URL normalization**

Do not route `https://images.printify.com/...` through `/api/files`. Keep existing `normalizeImageUrl()` behavior for `http(s)`.

- [ ] **Step 4: Browser acceptance**

Run dev server:

```bash
npm run dev
```

In browser:

1. Open `/wizard/:draftId/step-3`.
2. Select two colors.
3. Click `Tạo Mockups`.
4. Confirm UI shows indeterminate Printify render state while `totalImages = 0`.
5. Confirm completed real image URLs render without `fetch failed` from `via.placeholder.com`.

## Task 7: Cleanup Draft Products

**Files:**
- Create: `src/lib/wizard/cleanup.ts`
- Create: `src/lib/wizard/cleanup.test.ts`
- Modify: `src/lib/wizard/state.ts`
- Modify: `src/app/api/wizard/drafts/[id]/route.ts`

- [ ] **Step 1: Add cleanup service**

Create:

```ts
export async function deleteDraftWithCleanup(input: {
  draftId: string;
  tenantId: string;
}): Promise<void>;
```

Behavior:

1. Load draft by `id + tenantId`, include `store`.
2. If missing, throw `Draft not found`.
3. If `printifyDraftProductId` and `storeId` exist, call `getClientForStore(storeId)` and `client.deleteProduct(externalShopId, printifyDraftProductId)`.
4. Catch Printify delete errors and log them; do not block local draft deletion.
5. Delete `wizardDraft`.

- [ ] **Step 2: Route state deletion through cleanup**

Modify `deleteDraft()` in `src/lib/wizard/state.ts` to call `deleteDraftWithCleanup({ draftId: id, tenantId })`.

- [ ] **Step 3: Tests**

Test:

- no Printify product: deletes draft
- Printify delete succeeds: deletes remote then local
- Printify delete fails: still deletes local draft and does not throw remote error

Run:

```bash
npx tsx --test src/lib/wizard/cleanup.test.ts src/lib/wizard/state.test.ts
```

Expected: cleanup tests pass.

## Task 8: Publish Reuse Behind Flag

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/lib/publish/printify.ts`
- Modify: `src/app/api/listings/[id]/retry-printify/route.ts`
- Test: create or extend `src/lib/publish/worker.test.ts`

- [ ] **Step 1: Add explicit publish strategy**

Use feature flag `printify_reuse_draft_product`.

Behavior when disabled:

- Existing publish pipeline remains unchanged.

Behavior when enabled and `draft.printifyDraftProductId` exists:

- Update existing Printify product with listing content.
- Publish that Printify product to Shopify through Printify.
- Store `listing.printifyProductId = draft.printifyDraftProductId`.
- Do not call `publishToPrintify()` create path.

- [ ] **Step 2: Fix current stale draft fields in Printify stage**

Current code uses fields that do not exist on `WizardDraft`:

- `draft.selectedColors`
- `draft.blueprintId`
- `draft.printProviderId`

Replace with:

```ts
const template = draft.store?.template;
const variantIds = draft.enabledVariantIdsOverride.length > 0
  ? draft.enabledVariantIdsOverride
  : template?.enabledVariantIds ?? [];
const blueprintId = template?.printifyBlueprintId;
const printProviderId = template?.printifyPrintProviderId;
```

If any required value is missing, mark Printify job failed with a concrete message:

```ts
"Printify template is not configured for this store"
```

- [ ] **Step 3: Decide Shopify ownership in code**

For this plan, keep existing Shopify direct publish as the default. The Printify reuse path only updates/publishes Printify when `printify_reuse_draft_product` is enabled.

Before enabling `printify_reuse_draft_product` in production, run a manual test on a disposable Shopify store to confirm whether Printify publish creates a duplicate Shopify product. If it does, keep the flag disabled and use Printify only for real mockups until the publish architecture is changed to Printify-first.

- [ ] **Step 4: Tests**

Add tests for a pure helper:

```ts
export function resolvePrintifyPublishInput(draft: DraftLike): {
  productId: string | null;
  blueprintId: number;
  printProviderId: number;
  variantIds: number[];
};
```

Test cases:

- override variants win over template variants
- template variants are used when override is empty
- missing template throws `"Printify template is not configured for this store"`
- existing `printifyDraftProductId` is returned for reuse path

Run:

```bash
npx tsx --test src/lib/publish/worker.test.ts
npx tsc --noEmit
```

## Task 9: Feature Flags And Rollout Guardrails

**Files:**
- Modify: `prisma/seed.ts`
- Create or modify: `prisma/migrations/0020_phase_c_feature_flags/migration.sql`

- [ ] **Step 1: Add flags disabled by default**

Create flags:

- `printify_real_mockups`: disabled
- `printify_reuse_draft_product`: disabled

Descriptions:

- `printify_real_mockups`: “Use Printify product images for Wizard Step 3 mockup generation.”
- `printify_reuse_draft_product`: “Reuse Step 3 Printify draft product during publish instead of creating a new Printify product.”

Add these objects to `DEFAULT_FLAGS` in `prisma/seed.ts`:

```ts
{
  key: "printify_real_mockups",
  enabled: false,
  description: "Use Printify product images for Wizard Step 3 mockup generation.",
},
{
  key: "printify_reuse_draft_product",
  enabled: false,
  description: "Reuse Step 3 Printify draft product during publish instead of creating a new Printify product.",
},
```

Create migration SQL:

```sql
INSERT INTO "feature_flags" ("key", "enabled", "rollout_percent", "description")
VALUES
  ('printify_real_mockups', false, 100, 'Use Printify product images for Wizard Step 3 mockup generation.'),
  ('printify_reuse_draft_product', false, 100, 'Reuse Step 3 Printify draft product during publish instead of creating a new Printify product.')
ON CONFLICT ("key") DO UPDATE
SET "description" = EXCLUDED."description";
```

- [ ] **Step 2: Manual rollout**

Rollout order:

1. Enable `printify_real_mockups` for local/dev only.
2. Test one store with Bella+Canvas 3001.
3. Test one product type with no back/sleeve support.
4. Enable for one internal tenant.
5. Keep `printify_reuse_draft_product` disabled until duplicate Shopify behavior is proven safe.

## Task 10: Abandoned Draft Cleanup Sweep

**Files:**
- Create: `src/lib/wizard/cleanup-orphan-printify-products.ts`
- Create: `src/lib/wizard/cleanup-orphan-printify-products.test.ts`
- Optional script entry: `scripts/cleanup-printify-draft-products.ts`

- [ ] **Step 1: Implement cleanup selector**

Create a pure selector helper:

```ts
export function buildAbandonedDraftCleanupWhere(now: Date) {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    printifyDraftProductId: { not: null },
    status: "ABANDONED" as const,
    updatedAt: { lt: cutoff },
  };
}
```

- [ ] **Step 2: Implement cleanup sweep**

Create:

```ts
export async function cleanupAbandonedPrintifyDraftProducts(input: {
  now?: Date;
  limit?: number;
}): Promise<{ scanned: number; deletedRemote: number; clearedLocal: number; errors: number }>;
```

Behavior:

1. Query abandoned drafts with `printifyDraftProductId != null`, older than 30 days, limited by `input.limit ?? 50`.
2. For each draft, call `getClientForStore(draft.storeId)` and `client.deleteProduct(externalShopId, draft.printifyDraftProductId)`.
3. If remote delete succeeds, update draft `printifyDraftProductId = null`.
4. If Printify returns not-found, update draft `printifyDraftProductId = null`.
5. If Printify returns auth/rate/network error, increment `errors` and leave local ID for the next run.

- [ ] **Step 3: Tests**

Test cases:

- selector uses a 30-day cutoff
- successful remote delete clears local product ID
- not-found clears local product ID
- rate-limit error does not clear local product ID

Run:

```bash
npx tsx --test src/lib/wizard/cleanup-orphan-printify-products.test.ts
```

Expected: cleanup sweep tests pass.

## Task 11: Full Verification

**Files:** all touched files.

- [ ] **Step 1: Static checks**

Run:

```bash
npx tsc --noEmit
npx tsx --test $(rg --files -g '*.test.ts' src)
git diff --check
```

Expected: typecheck passes, tests pass, no whitespace errors in touched files.

- [ ] **Step 2: Local browser QA**

Run:

```bash
npm run dev
```

Manual flow:

1. Login.
2. Open `/wizard/:draftId/step-3`.
3. Select Store + Design if draft is incomplete.
4. Select Royal Blue + Gold.
5. Open placement modal and ensure Front + Back are enabled.
6. Click `Tạo Mockups`.
7. Confirm network does not call `via.placeholder.com`.
8. Confirm `mockup_images.source_url` and `composite_url` are Printify `http(s)` URLs.
9. Confirm gallery shows Printify photo-realistic images.
10. Confirm selected included images persist after reload.

- [ ] **Step 3: Database verification**

Run a read-only SQL query after creating mockups:

```sql
SELECT
  wd.id,
  wd.printify_draft_product_id,
  wd.printify_image_id,
  mj.status,
  mj.total_images,
  mj.completed_images,
  mi.mockup_type,
  mi.camera_label,
  mi.source_url,
  mi.composite_status
FROM wizard_drafts wd
JOIN mockup_jobs mj ON mj.wizard_draft_id = wd.id
JOIN mockup_images mi ON mi.mockup_job_id = mj.id
WHERE wd.id = '<draft-id>'
ORDER BY mi.sort_order ASC;
```

Expected:

- `printify_draft_product_id` is not null.
- `printify_image_id` is not null.
- latest job is `completed`.
- image URLs are real Printify URLs.
- `mockup_type` and `camera_label` are populated for at least the default/front images.

## Risks To Watch During Implementation

- Printify product payload format may differ by blueprint. Keep payload builder isolated and covered by tests.
- `PrintifyClient` currently hides `apiKey`, but publish worker accesses it with `(result.client as any).apiKey`. Phase C should remove that pattern from new code.
- Current publish worker uses stale draft fields. Fixing that is required before safely testing Printify publish reuse.
- Polling can create slow API requests. The route must return quickly after enqueueing the poll worker.
- Real Printify `images[]` may not contain every selected color/view combination. The UI should display what Printify returns and show a clear warning if required views are missing.

## Alignment Questions Before Enabling Production Flags

1. Should Step 5 be **Shopify-first** as today, or **Printify-first** once draft product reuse is enabled?
2. Should the gallery auto-include only Printify defaults, or defaults plus Front/Back for every selected color?
3. Should draft Printify products be deleted immediately on local draft deletion, or kept for 30 days for recovery?
4. Is there a disposable Printify + Shopify test store available for validating `publish.json` behavior?
