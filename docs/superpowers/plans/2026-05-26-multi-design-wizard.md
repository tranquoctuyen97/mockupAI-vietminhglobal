# Multi-Design Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a wizard flow that selects 1-5 designs, renders real Printify mockups for every selected design, and publishes one listing per design.

**Architecture:** Keep `WizardDraft` as the shared run container and add `WizardDraftDesign` as the per-design child record. All per-design Printify image/product IDs, mockup jobs, and listings hang from the child row. Existing single-design fields remain as compatibility fallbacks.

**Tech Stack:** Next.js App Router, React 19, Zustand, Prisma 7, PostgreSQL, BullMQ, node:test with `tsx --test`, TypeScript.

---

## Source Spec

Implement the approved design in `docs/superpowers/specs/2026-05-26-multi-design-wizard-design.md`.

## File Structure

Create or modify these files:

- `prisma/schema.prisma`: add `WizardDraftDesign`, per-design relations, and remove the single-listing uniqueness constraint.
- `prisma/migrations/0031_add_multi_design_wizard/migration.sql`: create/backfill child design rows and add new indexes/foreign keys.
- `src/lib/wizard/design-selection.ts`: pure helpers for normalizing and comparing selected design IDs.
- `src/lib/wizard/design-selection.test.ts`: tests for selection normalization and compatibility fallback behavior.
- `src/lib/wizard/state.ts`: accept `designIds`, include child rows in draft reads, and sync child rows transactionally.
- `src/lib/wizard/state.test.ts`: source and helper tests for draft selection persistence.
- `src/lib/wizard/use-wizard-store.ts`: add client draft child-design types and helper fields.
- `src/lib/mockup/generation.ts`: extracted service used by single and batch mockup job endpoints.
- `src/lib/mockup/multi-design.ts`: pure helpers for latest per-design job grouping and coverage checks.
- `src/lib/mockup/multi-design.test.ts`: tests for per-design job grouping.
- `src/app/api/mockup-jobs/route.ts`: compatibility wrapper around the generation service.
- `src/app/api/mockup-jobs/batch/route.ts`: new batch endpoint.
- `src/app/api/mockup-jobs/[id]/route.ts`: include per-design identifiers in job responses.
- `src/lib/mockup/queue.ts`: add optional per-design payload fields.
- `src/lib/mockup/printify-poll-worker.ts`: poll and composite using the job-specific design.
- `src/app/api/wizard/drafts/[id]/mockup-images/route.ts`: retry composite using the job-specific design.
- `src/app/api/wizard/drafts/[id]/checklist.ts`: require mockup coverage for every selected design.
- `src/app/api/wizard/drafts/[id]/publish/route.ts`: create or return one listing per selected design.
- `src/lib/publish/worker.ts`: publish listing-specific design, mockup images, and Printify draft product state.
- `src/app/api/listings/[id]/retry-printify/route.ts`: retry a specific listing with its child design state.
- `src/app/api/listings/[id]/force-republish/route.ts`: delete a specific listing and reset the parent draft.
- `src/lib/analytics/queries.ts`: prefer `Listing.designId` when available.
- `src/app/(authed)/wizard/[draftId]/layout.tsx`: update step gates for multi-design.
- `src/app/(authed)/wizard/[draftId]/step-2/page.tsx`: multi-select design picker.
- `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`: batch auto-generation, per-design progress, grouped results.
- `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`: use primary child design as AI input.
- `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`: grouped review and per-listing publish progress.

Do not edit or revert unrelated dirty files. At plan creation time, `src/app/(authed)/stores/[id]/config/page.tsx` is already modified by someone else and must be left alone unless the implementation task explicitly requires it.

---

### Task 1: Schema And Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0031_add_multi_design_wizard/migration.sql`
- Modify: `src/lib/wizard/state.test.ts`

- [ ] **Step 1: Add migration coverage test before changing schema**

Append this test to `src/lib/wizard/state.test.ts`:

```ts
test("multi-design wizard migration backfills child design rows and removes single-listing uniqueness", () => {
  const migrations = readdirSync(join(process.cwd(), "prisma/migrations"))
    .filter((name) => name.includes("multi_design_wizard") || name.includes("add_multi_design_wizard"))
    .sort();

  assert.ok(migrations.length > 0, "expected add_multi_design_wizard migration");

  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations", migrations[migrations.length - 1], "migration.sql"),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE\s+"wizard_draft_designs"/);
  assert.match(migration, /INSERT INTO\s+"wizard_draft_designs"/);
  assert.match(migration, /FROM\s+"wizard_drafts"/);
  assert.match(migration, /ALTER TABLE\s+"mockup_jobs"\s+ADD COLUMN\s+"wizard_draft_design_id"/);
  assert.match(migration, /ALTER TABLE\s+"listings"\s+ADD COLUMN\s+"wizard_draft_design_id"/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS\s+"listings_wizard_draft_id_key"/);
});
```

Also update the import at the top:

```ts
import { readFileSync, readdirSync } from "node:fs";
```

- [ ] **Step 2: Run the new migration test and verify it fails**

Run:

```bash
npx tsx --test src/lib/wizard/state.test.ts
```

Expected: FAIL with `expected add_multi_design_wizard migration`.

- [ ] **Step 3: Modify Prisma schema**

In `prisma/schema.prisma`, update `Design`, `WizardDraft`, `MockupJob`, and `Listing`.

Add to `Design`:

```prisma
  draftDesigns WizardDraftDesign[]
  mockupJobs    MockupJob[]
```

Add to `WizardDraft`:

```prisma
  draftDesigns WizardDraftDesign[]
  listings     Listing[]
```

Insert after `WizardDraft`:

```prisma
model WizardDraftDesign {
  id                     String   @id @default(cuid())
  draftId                String   @map("wizard_draft_id")
  designId               String   @map("design_id")
  sortOrder              Int      @default(0) @map("sort_order")
  printifyImageId        String?  @map("printify_image_id")
  printifyDraftProductId String?  @map("printify_draft_product_id")
  lastError              String?  @map("last_error")
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")

  draft    WizardDraft @relation(fields: [draftId], references: [id], onDelete: Cascade)
  design   Design      @relation(fields: [designId], references: [id], onDelete: Cascade)
  jobs     MockupJob[]
  listings Listing[]

  @@unique([draftId, designId])
  @@index([draftId, sortOrder])
  @@index([designId])
  @@map("wizard_draft_designs")
}
```

Update `MockupJob` fields and relations:

```prisma
  draftDesignId String? @map("wizard_draft_design_id")
  designId      String? @map("design_id")

  draft       WizardDraft        @relation(fields: [draftId], references: [id], onDelete: Cascade)
  draftDesign WizardDraftDesign? @relation(fields: [draftDesignId], references: [id], onDelete: Cascade)
  design      Design?            @relation(fields: [designId], references: [id], onDelete: SetNull)
  images      MockupImage[]

  @@index([draftId, status])
  @@index([draftId, draftDesignId, status])
  @@index([draftDesignId])
  @@index([designId])
```

Update `Listing`:

```prisma
  wizardDraftId       String? @map("wizard_draft_id")
  wizardDraftDesignId String? @unique @map("wizard_draft_design_id")
```

Add listing relations:

```prisma
  wizardDraft       WizardDraft?       @relation(fields: [wizardDraftId], references: [id], onDelete: SetNull)
  wizardDraftDesign WizardDraftDesign? @relation(fields: [wizardDraftDesignId], references: [id], onDelete: SetNull)
```

Replace the existing `wizardDraftId @unique` behavior with indexes:

```prisma
  @@index([tenantId, status])
  @@index([storeId])
  @@index([wizardDraftId])
  @@index([designId])
```

- [ ] **Step 4: Generate the Prisma migration**

Run:

```bash
npx prisma migrate dev --create-only --name add_multi_design_wizard
```

Expected: Prisma creates a migration directory. Rename the generated directory to `prisma/migrations/0031_add_multi_design_wizard` before editing it so the repository keeps the existing numbered migration convention.

- [ ] **Step 5: Edit the migration for backfill and constraint safety**

Open the generated migration and ensure it contains this shape. Constraint names may differ if Prisma generated different names; keep the operations equivalent.

```sql
CREATE TABLE "wizard_draft_designs" (
    "id" TEXT NOT NULL,
    "wizard_draft_id" TEXT NOT NULL,
    "design_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "printify_image_id" TEXT,
    "printify_draft_product_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wizard_draft_designs_pkey" PRIMARY KEY ("id")
);

INSERT INTO "wizard_draft_designs" (
    "id",
    "wizard_draft_id",
    "design_id",
    "sort_order",
    "printify_image_id",
    "printify_draft_product_id",
    "created_at",
    "updated_at"
)
SELECT
    concat('wdd_', replace(gen_random_uuid()::text, '-', '')),
    "id",
    "design_id",
    0,
    "printify_image_id",
    "printify_draft_product_id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "wizard_drafts"
WHERE "design_id" IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "mockup_jobs" ADD COLUMN "wizard_draft_design_id" TEXT;
ALTER TABLE "mockup_jobs" ADD COLUMN "design_id" TEXT;

UPDATE "mockup_jobs" mj
SET
  "wizard_draft_design_id" = wdd."id",
  "design_id" = wdd."design_id"
FROM "wizard_draft_designs" wdd
WHERE mj."wizard_draft_id" = wdd."wizard_draft_id"
  AND wdd."sort_order" = 0
  AND mj."wizard_draft_design_id" IS NULL;

ALTER TABLE "listings" ADD COLUMN "wizard_draft_design_id" TEXT;

UPDATE "listings" l
SET
  "wizard_draft_design_id" = wdd."id",
  "design_id" = COALESCE(l."design_id", wdd."design_id")
FROM "wizard_draft_designs" wdd
WHERE l."wizard_draft_id" = wdd."wizard_draft_id"
  AND wdd."sort_order" = 0
  AND l."wizard_draft_design_id" IS NULL;

ALTER TABLE "listings" DROP CONSTRAINT IF EXISTS "listings_wizard_draft_id_key";
CREATE UNIQUE INDEX "wizard_draft_designs_wizard_draft_id_design_id_key" ON "wizard_draft_designs"("wizard_draft_id", "design_id");
CREATE UNIQUE INDEX "listings_wizard_draft_design_id_key" ON "listings"("wizard_draft_design_id");
CREATE INDEX "wizard_draft_designs_wizard_draft_id_sort_order_idx" ON "wizard_draft_designs"("wizard_draft_id", "sort_order");
CREATE INDEX "mockup_jobs_wizard_draft_id_wizard_draft_design_id_status_idx" ON "mockup_jobs"("wizard_draft_id", "wizard_draft_design_id", "status");
CREATE INDEX "listings_wizard_draft_id_idx" ON "listings"("wizard_draft_id");
```

- [ ] **Step 6: Run schema validation and migration test**

Run:

```bash
npx prisma validate
npx tsx --test src/lib/wizard/state.test.ts
```

Expected: both pass.

- [ ] **Step 7: Commit schema and migration**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/wizard/state.test.ts
git commit -m "feat: add multi-design wizard schema"
```

---

### Task 2: Draft Selection State

**Files:**
- Create: `src/lib/wizard/design-selection.ts`
- Create: `src/lib/wizard/design-selection.test.ts`
- Modify: `src/lib/wizard/state.ts`
- Modify: `src/lib/wizard/state.test.ts`
- Modify: `src/lib/wizard/use-wizard-store.ts`

- [ ] **Step 1: Write pure helper tests**

Create `src/lib/wizard/design-selection.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_WIZARD_DESIGNS,
  getDraftDesignIds,
  normalizeDesignIds,
  sameDesignSelection,
} from "./design-selection";

test("normalizeDesignIds keeps unique ids in order", () => {
  assert.deepEqual(normalizeDesignIds(["a", "b", "a", "", "c"]), ["a", "b", "c"]);
});

test("normalizeDesignIds rejects more than five designs", () => {
  assert.equal(MAX_WIZARD_DESIGNS, 5);
  assert.throws(
    () => normalizeDesignIds(["1", "2", "3", "4", "5", "6"]),
    /Select at most 5 designs/,
  );
});

test("getDraftDesignIds prefers child rows and falls back to legacy designId", () => {
  assert.deepEqual(
    getDraftDesignIds({
      designId: "legacy",
      draftDesigns: [
        { designId: "b", sortOrder: 1 },
        { designId: "a", sortOrder: 0 },
      ],
    }),
    ["a", "b"],
  );

  assert.deepEqual(getDraftDesignIds({ designId: "legacy", draftDesigns: [] }), ["legacy"]);
});

test("sameDesignSelection compares ordered design ids", () => {
  assert.equal(sameDesignSelection(["a", "b"], ["a", "b"]), true);
  assert.equal(sameDesignSelection(["a", "b"], ["b", "a"]), false);
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
npx tsx --test src/lib/wizard/design-selection.test.ts
```

Expected: FAIL because `design-selection.ts` does not exist.

- [ ] **Step 3: Implement selection helpers**

Create `src/lib/wizard/design-selection.ts`:

```ts
export const MAX_WIZARD_DESIGNS = 5;

export type DraftDesignLike = {
  designId: string;
  sortOrder?: number | null;
};

export type DraftWithDesignSelection = {
  designId?: string | null;
  draftDesigns?: DraftDesignLike[] | null;
};

export function normalizeDesignIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("designIds must be an array");
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("designIds must contain only strings");
    }
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  if (normalized.length > MAX_WIZARD_DESIGNS) {
    throw new Error(`Select at most ${MAX_WIZARD_DESIGNS} designs`);
  }

  return normalized;
}

export function getDraftDesignIds(draft: DraftWithDesignSelection | null | undefined): string[] {
  if (!draft) return [];
  const childIds = [...(draft.draftDesigns ?? [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((entry) => entry.designId)
    .filter(Boolean);

  if (childIds.length > 0) return childIds;
  return draft.designId ? [draft.designId] : [];
}

export function sameDesignSelection(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npx tsx --test src/lib/wizard/design-selection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update server draft patch types and includes**

In `src/lib/wizard/state.ts`, add `designIds` and child rows:

```ts
import {
  getDraftDesignIds,
  normalizeDesignIds,
  sameDesignSelection,
} from "./design-selection";

export interface DraftPatch {
  designId?: string | null;
  designIds?: string[];
  storeId?: string | null;
  templateId?: string | null;
  enabledColorIds?: string[];
  enabledSizes?: string[];
  enabledVariantIdsOverride?: number[];
  placementOverride?: unknown | null;
  aiContent?: unknown | null;
  currentStep?: number;
  status?: DraftStatus;
}
```

Add `"designIds"` to `draftPatchKeys`.

In `getDraft`, include:

```ts
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        include: {
          design: true,
          jobs: {
            orderBy: { createdAt: "asc" },
            include: {
              images: {
                orderBy: { sortOrder: "asc" },
              },
            },
          },
        },
      },
```

- [ ] **Step 6: Update updateDraft transaction**

In `updateDraft`, load child rows during ownership check:

```ts
  const draft = await prisma.wizardDraft.findFirst({
    where: { id, tenantId },
    include: {
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        select: { designId: true, sortOrder: true },
      },
    },
  });
```

Before template validation, compute design selection state:

```ts
  const nextDesignIds =
    sanitized.designIds !== undefined
      ? normalizeDesignIds(sanitized.designIds)
      : sanitized.designId !== undefined
        ? normalizeDesignIds(sanitized.designId ? [sanitized.designId] : [])
        : null;
  const currentDesignIds = getDraftDesignIds(draft);
  const designsChanged =
    nextDesignIds !== null && !sameDesignSelection(currentDesignIds, nextDesignIds);
```

Verify tenant ownership when `nextDesignIds` is not null:

```ts
  if (nextDesignIds && nextDesignIds.length > 0) {
    const count = await prisma.design.count({
      where: {
        id: { in: nextDesignIds },
        tenantId,
        status: "ACTIVE",
        deletedAt: null,
      },
    });
    if (count !== nextDesignIds.length) {
      throw new Error("One or more designs were not found");
    }
  }
```

Replace the final update with a transaction:

```ts
  const { designIds: _designIds, ...draftData } = sanitized;
  const data: Prisma.WizardDraftUncheckedUpdateInput = {
    ...draftData,
    ...(nextDesignIds !== null ? { designId: nextDesignIds[0] ?? null } : {}),
    ...staleDraftPatch,
    ...(designsChanged
      ? {
          mockupsStale: true,
          mockupsStaleReason: "design_changed",
        }
      : {}),
    placementOverride: sanitized.placementOverride !== undefined
      ? sanitized.placementOverride === null
        ? Prisma.JsonNull
        : (sanitized.placementOverride as Prisma.InputJsonValue)
      : undefined,
    aiContent: sanitized.aiContent !== undefined
      ? sanitized.aiContent === null
        ? Prisma.JsonNull
        : (sanitized.aiContent as Prisma.InputJsonValue)
      : undefined,
  };

  return prisma.$transaction(async (tx) => {
    if (nextDesignIds !== null) {
      await tx.wizardDraftDesign.deleteMany({
        where: {
          draftId: id,
          designId: { notIn: nextDesignIds },
        },
      });

      for (const [sortOrder, designId] of nextDesignIds.entries()) {
        await tx.wizardDraftDesign.upsert({
          where: {
            draftId_designId: {
              draftId: id,
              designId,
            },
          },
          update: { sortOrder },
          create: {
            draftId: id,
            designId,
            sortOrder,
          },
        });
      }
    }

    return tx.wizardDraft.update({
      where: { id },
      data,
      include: {
        draftDesigns: {
          orderBy: { sortOrder: "asc" },
          include: { design: true },
        },
      },
    });
  });
```

- [ ] **Step 7: Add state source tests**

Append to `src/lib/wizard/state.test.ts`:

```ts
test("wizard draft state accepts designIds patches", () => {
  const sanitized = sanitizeDraftPatch({
    designIds: ["design_1", "design_2"],
    designId: "design_1",
    ignored: true,
  });

  assert.deepEqual(sanitized, {
    designIds: ["design_1", "design_2"],
    designId: "design_1",
  });
});

test("getDraft includes ordered draftDesigns with design and job images", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/wizard/state.ts"), "utf8");

  assert.match(source, /draftDesigns:\s*{/);
  assert.match(source, /orderBy:\s*{\s*sortOrder:\s*"asc"/);
  assert.match(source, /jobs:\s*{/);
  assert.match(source, /images:\s*{/);
});
```

- [ ] **Step 8: Update Zustand draft types**

In `src/lib/wizard/use-wizard-store.ts`, add:

```ts
interface DraftDesign {
  id: string;
  designId: string;
  sortOrder: number;
  design: {
    id: string;
    name: string;
    previewUrl?: string | null;
    previewPath?: string | null;
    storagePath: string;
    width: number;
    height: number;
  };
  jobs?: MockupJob[];
}
```

Add to `MockupJob`:

```ts
  draftDesignId?: string | null;
  designId?: string | null;
```

Add to `DraftData`:

```ts
  draftDesigns?: DraftDesign[];
```

Add a selector helper near `areDraftValuesEqual`:

```ts
export function getDraftDesignIdsFromDraft(draft: Pick<DraftData, "designId" | "draftDesigns"> | null): string[] {
  if (!draft) return [];
  const childIds = [...(draft.draftDesigns ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((entry) => entry.designId);
  return childIds.length > 0 ? childIds : draft.designId ? [draft.designId] : [];
}
```

- [ ] **Step 9: Run task tests and TypeScript build**

Run:

```bash
npx tsx --test src/lib/wizard/design-selection.test.ts src/lib/wizard/state.test.ts
npm run build
```

Expected: tests pass and build succeeds.

- [ ] **Step 10: Commit draft state**

```bash
git add src/lib/wizard/design-selection.ts src/lib/wizard/design-selection.test.ts src/lib/wizard/state.ts src/lib/wizard/state.test.ts src/lib/wizard/use-wizard-store.ts
git commit -m "feat: support multi-design draft state"
```

---

### Task 3: Step 2 Multi-Select And Layout Gate

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-2/page.tsx`
- Modify: `src/app/(authed)/wizard/[draftId]/layout.tsx`
- Modify: `src/lib/wizard/use-wizard-store.test.ts`

- [ ] **Step 1: Add store helper test**

Append to `src/lib/wizard/use-wizard-store.test.ts`:

```ts
import { getDraftDesignIdsFromDraft } from "./use-wizard-store";

test("getDraftDesignIdsFromDraft prefers ordered child rows", () => {
  assert.deepEqual(
    getDraftDesignIdsFromDraft({
      designId: "legacy",
      draftDesigns: [
        {
          id: "wdd_2",
          designId: "design_2",
          sortOrder: 1,
          design: {
            id: "design_2",
            name: "Two",
            storagePath: "two.png",
            width: 100,
            height: 100,
          },
        },
        {
          id: "wdd_1",
          designId: "design_1",
          sortOrder: 0,
          design: {
            id: "design_1",
            name: "One",
            storagePath: "one.png",
            width: 100,
            height: 100,
          },
        },
      ],
    }),
    ["design_1", "design_2"],
  );
});
```

- [ ] **Step 2: Run helper test**

Run:

```bash
npx tsx --test src/lib/wizard/use-wizard-store.test.ts
```

Expected: PASS after Task 2. Keep imports merged with the existing top-level imports.

- [ ] **Step 3: Replace Step 2 single selection state**

In `src/app/(authed)/wizard/[draftId]/step-2/page.tsx`, import `X` and the helper:

```ts
import { Image as ImageIcon, Check, Loader2, Search, X } from "lucide-react";
import { getDraftDesignIdsFromDraft } from "@/lib/wizard/use-wizard-store";
```

Add derived state inside the component:

```ts
  const selectedDesignIds = getDraftDesignIdsFromDraft(draft);
  const selectedDesignIdSet = new Set(selectedDesignIds);
  const selectedDesigns = selectedDesignIds
    .map((id) => designs.find((design) => design.id === id))
    .filter((design): design is Design => Boolean(design));
```

Replace `handleSelect` with:

```ts
  function handleToggleDesign(designId: string) {
    const selected = getDraftDesignIdsFromDraft(useWizardStore.getState().draft);
    const isSelected = selected.includes(designId);
    const next = isSelected
      ? selected.filter((id) => id !== designId)
      : selected.length >= 5
        ? selected
        : [...selected, designId];

    updateDraft({
      designId: next[0] ?? null,
      designIds: next,
    });
  }

  function handleRemoveDesign(designId: string) {
    const next = getDraftDesignIdsFromDraft(useWizardStore.getState().draft).filter(
      (id) => id !== designId,
    );
    updateDraft({
      designId: next[0] ?? null,
      designIds: next,
    });
  }
```

- [ ] **Step 4: Update Step 2 header and selected strip**

Replace the header block with:

```tsx
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Chọn Design ({selectedDesignIds.length}/5 đã chọn)
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Chọn 1-5 designs để tạo listing
      </p>
```

Insert this strip before the search input:

```tsx
      {selectedDesigns.length > 0 && (
        <div
          className="card"
          style={{
            padding: 10,
            marginBottom: 16,
            display: "flex",
            gap: 8,
            overflowX: "auto",
            alignItems: "center",
          }}
        >
          {selectedDesigns.map((design) => (
            <div
              key={design.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-sm)",
                padding: "6px 8px",
                flexShrink: 0,
                maxWidth: 220,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-tertiary)",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {design.previewUrl ? (
                  <img src={design.previewUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <ImageIcon size={16} style={{ opacity: 0.35 }} />
                )}
              </div>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {design.name}
              </span>
              <button
                type="button"
                aria-label={`Remove ${design.name}`}
                onClick={() => handleRemoveDesign(design.id)}
                style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 5: Update design cards**

Inside the grid map:

```tsx
            const isSelected = selectedDesignIdSet.has(d.id);
            const isDisabled = !isSelected && selectedDesignIds.length >= 5;
```

Use:

```tsx
                onClick={() => {
                  if (!isDisabled) handleToggleDesign(d.id);
                }}
```

Set disabled style:

```tsx
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  opacity: isDisabled ? 0.45 : 1,
```

Keep the existing check badge, now based on `isSelected`.

- [ ] **Step 6: Update layout gate**

In `src/app/(authed)/wizard/[draftId]/layout.tsx`, import the helper:

```ts
import { getDraftDesignIdsFromDraft } from "@/lib/wizard/use-wizard-store";
```

Before rendering steps, add:

```ts
  const selectedDesignCount = getDraftDesignIdsFromDraft(draft).length;
```

When computing `isAccessible`, gate Step 3+:

```ts
          const hasDesignSelection = selectedDesignCount > 0;
          const isAccessible = draft
            ? step.num <= draft.currentStep + 1 && (step.num <= 2 || hasDesignSelection)
            : step.num === 1;
```

Before navigating next, block Step 2 with no design:

```ts
              if (currentStep === 2 && getDraftDesignIdsFromDraft(useWizardStore.getState().draft).length === 0) {
                return;
              }
```

- [ ] **Step 7: Run tests and build**

Run:

```bash
npx tsx --test src/lib/wizard/use-wizard-store.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 8: Commit Step 2 UI**

```bash
git add 'src/app/(authed)/wizard/[draftId]/step-2/page.tsx' 'src/app/(authed)/wizard/[draftId]/layout.tsx' src/lib/wizard/use-wizard-store.test.ts
git commit -m "feat: add multi-design picker"
```

---

### Task 4: Mockup Generation Service And Batch Endpoint

**Files:**
- Create: `src/lib/mockup/generation.ts`
- Create: `src/lib/mockup/multi-design.ts`
- Create: `src/lib/mockup/multi-design.test.ts`
- Modify: `src/app/api/mockup-jobs/route.ts`
- Create: `src/app/api/mockup-jobs/batch/route.ts`
- Modify: `src/app/api/mockup-jobs/[id]/route.ts`

- [ ] **Step 1: Write pure multi-design mockup helper tests**

Create `src/lib/mockup/multi-design.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  getLatestJobByDraftDesignId,
  hasActiveOrCompletedJobsForAllDesigns,
} from "./multi-design";

test("getLatestJobByDraftDesignId groups latest job per child design", () => {
  const jobs = [
    { id: "old-a", draftDesignId: "a", createdAt: "2026-05-24T10:00:00.000Z", status: "completed" },
    { id: "new-a", draftDesignId: "a", createdAt: "2026-05-25T10:00:00.000Z", status: "running" },
    { id: "only-b", draftDesignId: "b", createdAt: "2026-05-24T11:00:00.000Z", status: "completed" },
  ];

  const grouped = getLatestJobByDraftDesignId(jobs);
  assert.equal(grouped.get("a")?.id, "new-a");
  assert.equal(grouped.get("b")?.id, "only-b");
});

test("hasActiveOrCompletedJobsForAllDesigns requires a usable job for each selected design", () => {
  assert.equal(
    hasActiveOrCompletedJobsForAllDesigns(
      ["a", "b"],
      [
        { id: "a-job", draftDesignId: "a", status: "running" },
        { id: "b-job", draftDesignId: "b", status: "completed" },
      ],
    ),
    true,
  );

  assert.equal(
    hasActiveOrCompletedJobsForAllDesigns(
      ["a", "b"],
      [
        { id: "a-job", draftDesignId: "a", status: "failed" },
        { id: "b-job", draftDesignId: "b", status: "completed" },
      ],
    ),
    false,
  );
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
npx tsx --test src/lib/mockup/multi-design.test.ts
```

Expected: FAIL because `multi-design.ts` does not exist.

- [ ] **Step 3: Implement multi-design mockup helpers**

Create `src/lib/mockup/multi-design.ts`:

```ts
export type MockupJobLike = {
  id: string;
  draftDesignId?: string | null;
  createdAt?: string | Date | null;
  status?: string | null;
};

const USABLE_JOB_STATUSES = new Set(["pending", "running", "completed"]);

export function getLatestJobByDraftDesignId<T extends MockupJobLike>(jobs: T[]): Map<string, T> {
  const grouped = new Map<string, T>();

  for (const job of jobs) {
    if (!job.draftDesignId) continue;
    const current = grouped.get(job.draftDesignId);
    if (!current || getTime(job.createdAt) > getTime(current.createdAt)) {
      grouped.set(job.draftDesignId, job);
    }
  }

  return grouped;
}

export function hasActiveOrCompletedJobsForAllDesigns(
  draftDesignIds: string[],
  jobs: MockupJobLike[],
): boolean {
  const latestByDesign = getLatestJobByDraftDesignId(jobs);
  return draftDesignIds.every((draftDesignId) => {
    const job = latestByDesign.get(draftDesignId);
    return Boolean(job?.status && USABLE_JOB_STATUSES.has(job.status.toLowerCase()));
  });
}

function getTime(value: string | Date | null | undefined): number {
  return value ? new Date(value).getTime() : 0;
}
```

- [ ] **Step 4: Extract mockup generation service**

Create `src/lib/mockup/generation.ts` by moving the current logic from `src/app/api/mockup-jobs/route.ts` into reusable functions.

Use these exported types and functions:

```ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isMockupFallbackForcedForDev } from "@/lib/config/runtime-controls";
import { resolveEffectivePlacementData } from "@/lib/mockup/plan";
import { resolveCustomMockupSourceSelection } from "@/lib/mockup/custom-source-selection";
import { buildVariantColorLookup } from "@/lib/mockup/printify-poll-worker";
import { getPrintifyMockupQueue } from "@/lib/mockup/queue";
import { DEFAULT_PLACEMENT } from "@/lib/placement/types";
import { createOrUpdatePrintifyProduct, ensurePrintifyImage } from "@/lib/printify/product";
import { formatTemplateMissing, getTemplateReadiness } from "@/lib/stores/template-readiness";

export type MockupGenerationContext = Awaited<ReturnType<typeof loadMockupGenerationContext>>;

export type BatchMockupJobResult = {
  jobId: string;
  draftDesignId: string | null;
  designId: string;
  designName: string;
  status: string;
};

export type BatchMockupJobFailure = {
  draftDesignId: string | null;
  designId: string;
  designName: string;
  error: string;
};
```

Implement `loadMockupGenerationContext(draftId, tenantId)` with the same include graph as the existing route plus `draftDesigns`:

```ts
export async function loadMockupGenerationContext(draftId: string, tenantId: string) {
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId },
    include: {
      design: true,
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        include: { design: true },
      },
      template: {
        include: {
          colors: {
            include: { color: true },
          },
        },
      },
      store: {
        include: {
          colors: true,
        },
      },
      mockupLibraryPicks: {
        select: { sourceId: true, isPrimary: true, sortOrder: true },
      },
    },
  });

  if (!draft) throw new MockupGenerationError("Draft not found", 404);
  return { draft, tenantId };
}
```

Add a typed error class:

```ts
export class MockupGenerationError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code?: string,
  ) {
    super(message);
  }
}
```

Implement `resolvePrimaryDraftDesign(context)`:

```ts
export function resolvePrimaryDraftDesign(context: MockupGenerationContext) {
  const child = context.draft.draftDesigns[0];
  if (child) return child;
  if (!context.draft.design) {
    throw new MockupGenerationError("No design attached to draft", 400);
  }
  return {
    id: null,
    designId: context.draft.design.id,
    design: context.draft.design,
    printifyImageId: context.draft.printifyImageId,
    printifyDraftProductId: context.draft.printifyDraftProductId,
  };
}
```

Create `prepareMockupGeneration(context)` in the same file. It must contain the validation checkpoints already present in the current `POST /api/mockup-jobs` route: resolve default template, template readiness, enabled variants, selected colors, selected colors belonging to the template, custom-source coverage, custom composite region coverage, placement snapshot creation, `MOCKUP_FALLBACK_FORCE` guard, Printify client lookup, variant color lookup, and selected color availability in the Printify catalog. Preserve the current user-facing error messages and codes. The function returns:

```ts
export type PreparedMockupGeneration = {
  template: NonNullable<MockupGenerationContext["draft"]["template"]>;
  enabledVariantIds: number[];
  placementSnapshot: Prisma.InputJsonValue;
  effectivePlacementData: ReturnType<typeof resolveEffectivePlacementData>;
};
```

Implement `createMockupJobForDraftDesign(context, prepared, draftDesign)`:

```ts
export async function createMockupJobForDraftDesign(
  context: MockupGenerationContext,
  prepared: PreparedMockupGeneration,
  draftDesign: ReturnType<typeof resolvePrimaryDraftDesign>,
): Promise<BatchMockupJobResult> {
  const { getClientForStore } = await import("@/lib/printify/account");
  const { client, externalShopId } = await getClientForStore(context.draft.storeId!);

  const imageId = await ensurePrintifyImage({
    client,
    designStoragePath: draftDesign.design.storagePath,
    cachedImageId: draftDesign.printifyImageId,
  });

  const product = await createOrUpdatePrintifyProduct({
    client,
    shopId: externalShopId,
    productId: draftDesign.printifyDraftProductId,
    blueprintId: prepared.template.printifyBlueprintId,
    printProviderId: prepared.template.printifyPrintProviderId,
    variantIds: prepared.enabledVariantIds,
    imageId,
    placementData: prepared.effectivePlacementData,
    title: `[DRAFT] ${draftDesign.design.originalFilename ?? draftDesign.design.id}`,
    description: "MockupAI draft product for preview generation",
    tags: ["mockupai", "draft-preview"],
  });

  if (draftDesign.id) {
    await prisma.wizardDraftDesign.update({
      where: { id: draftDesign.id },
      data: {
        printifyImageId: imageId,
        printifyDraftProductId: product.productId,
        lastError: null,
      },
    });
  } else {
    await prisma.wizardDraft.update({
      where: { id: context.draft.id },
      data: {
        printifyImageId: imageId,
        printifyDraftProductId: product.productId,
      },
    });
  }

  const mockupJob = await prisma.mockupJob.create({
    data: {
      draftId: context.draft.id,
      draftDesignId: draftDesign.id,
      designId: draftDesign.designId,
      status: "running",
      totalImages: 0,
      placementSnapshot: prepared.placementSnapshot,
    },
  });

  await getPrintifyMockupQueue().add("poll-printify-mockups", {
    mockupJobId: mockupJob.id,
    draftId: context.draft.id,
    draftDesignId: draftDesign.id,
    designId: draftDesign.designId,
    storeId: context.draft.storeId!,
    productId: product.productId,
  });

  return {
    jobId: mockupJob.id,
    draftDesignId: draftDesign.id,
    designId: draftDesign.designId,
    designName: draftDesign.design.name,
    status: "running",
  };
}
```

- [ ] **Step 5: Rewrite single mockup route as service wrapper**

Replace `src/app/api/mockup-jobs/route.ts` with a thin wrapper:

```ts
import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import {
  MockupGenerationError,
  createMockupJobForDraftDesign,
  loadMockupGenerationContext,
  prepareMockupGeneration,
  resolvePrimaryDraftDesign,
} from "@/lib/mockup/generation";

export async function POST(request: Request) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { draftId } = body;
  if (!draftId) return NextResponse.json({ error: "Missing draftId" }, { status: 400 });

  try {
    const context = await loadMockupGenerationContext(draftId, session.tenantId);
    const prepared = await prepareMockupGeneration(context);
    const result = await createMockupJobForDraftDesign(
      context,
      prepared,
      resolvePrimaryDraftDesign(context),
    );

    return NextResponse.json({
      jobId: result.jobId,
      totalImages: 0,
      status: result.status,
      provider: "printify",
      draftDesignId: result.draftDesignId,
      designId: result.designId,
    });
  } catch (error) {
    if (error instanceof MockupGenerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown Printify error";
    console.error("Printify real mockup generation failed:", error);
    return NextResponse.json(
      {
        error: `Printify không tạo được mockup thật: ${message}`,
        code: "PRINTIFY_REAL_MOCKUP_FAILED",
      },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 6: Add batch endpoint**

Create `src/app/api/mockup-jobs/batch/route.ts`:

```ts
import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import {
  type BatchMockupJobFailure,
  MockupGenerationError,
  createMockupJobForDraftDesign,
  loadMockupGenerationContext,
  prepareMockupGeneration,
} from "@/lib/mockup/generation";

export async function POST(request: Request) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { draftId } = body;
  if (!draftId) return NextResponse.json({ error: "Missing draftId" }, { status: 400 });

  try {
    const context = await loadMockupGenerationContext(draftId, session.tenantId);
    const prepared = await prepareMockupGeneration(context);
    const draftDesigns = context.draft.draftDesigns;

    if (draftDesigns.length === 0) {
      throw new MockupGenerationError("No designs attached to draft", 400);
    }

    const jobs = [];
    const failures: BatchMockupJobFailure[] = [];

    for (const draftDesign of draftDesigns) {
      try {
        jobs.push(await createMockupJobForDraftDesign(context, prepared, draftDesign));
      } catch (error) {
        failures.push({
          draftDesignId: draftDesign.id,
          designId: draftDesign.designId,
          designName: draftDesign.design.name,
          error: error instanceof Error ? error.message : "Unknown Printify error",
        });
      }
    }

    return NextResponse.json({ jobs, failures });
  } catch (error) {
    if (error instanceof MockupGenerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown Printify error";
    console.error("Printify batch mockup generation failed:", error);
    return NextResponse.json(
      {
        error: `Printify không tạo được mockup thật: ${message}`,
        code: "PRINTIFY_REAL_MOCKUP_FAILED",
      },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 7: Include per-design fields in job GET**

In `src/app/api/mockup-jobs/[id]/route.ts`, include:

```ts
      draftDesign: {
        include: {
          design: true,
        },
      },
      design: true,
```

Return the job as JSON with these relations intact.

- [ ] **Step 8: Run tests and build**

Run:

```bash
npx tsx --test src/lib/mockup/multi-design.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 9: Commit mockup generation API**

```bash
git add src/lib/mockup/generation.ts src/lib/mockup/multi-design.ts src/lib/mockup/multi-design.test.ts src/app/api/mockup-jobs/route.ts src/app/api/mockup-jobs/batch/route.ts 'src/app/api/mockup-jobs/[id]/route.ts'
git commit -m "feat: add batch mockup generation"
```

---

### Task 5: Mockup Workers Use Job-Specific Design

**Files:**
- Modify: `src/lib/mockup/queue.ts`
- Modify: `src/lib/mockup/printify-poll-worker.ts`
- Modify: `src/app/api/wizard/drafts/[id]/mockup-images/route.ts`
- Modify: `src/lib/mockup/printify-poll-worker.test.ts`

- [ ] **Step 1: Extend queue payload**

In `src/lib/mockup/queue.ts`, update:

```ts
export interface PrintifyMockupPollPayload {
  mockupJobId: string;
  draftId: string;
  draftDesignId?: string | null;
  designId?: string | null;
  storeId: string;
  productId: string;
}
```

- [ ] **Step 2: Add worker source test**

Append to `src/lib/mockup/printify-poll-worker.test.ts`:

```ts
test("printify poll worker resolves design from mockup job draftDesign first", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/mockup/printify-poll-worker.ts"),
    "utf8",
  );

  assert.match(source, /draftDesign:\s*{\s*include:\s*{\s*design:/);
  assert.match(source, /jobRecord\.draftDesign\?\.design\?\.storagePath/);
  assert.match(source, /jobRecord\.design\?\.storagePath/);
  assert.match(source, /jobRecord\.draft\.design\?\.storagePath/);
});
```

Add these imports to the test file and merge them with existing imports:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

- [ ] **Step 3: Run worker test and verify failure**

Run:

```bash
npx tsx --test src/lib/mockup/printify-poll-worker.test.ts
```

Expected: FAIL until the worker loads `draftDesign.design`.

- [ ] **Step 4: Update poll worker design resolution**

In `processPrintifyMockupPollJob`, after polling and before queuing composite jobs, load the job record:

```ts
    const jobRecord = await prisma.mockupJob.findUnique({
      where: { id: mockupJobId },
      include: {
        design: { select: { storagePath: true } },
        draftDesign: {
          include: {
            design: { select: { storagePath: true } },
          },
        },
        draft: {
          include: {
            design: { select: { storagePath: true } },
          },
        },
      },
    });
```

Replace the old `prisma.design.findFirst({ wizardDrafts: ... })` block with:

```ts
    const designStoragePath =
      jobRecord?.draftDesign?.design?.storagePath ??
      jobRecord?.design?.storagePath ??
      jobRecord?.draft?.design?.storagePath ??
      null;

    if (designStoragePath && pendingCustomImages.length > 0) {
      const queue = getMockupCompositeQueue();
      for (const image of pendingCustomImages) {
        await queue.add("composite-custom-mockup", {
          mockupImageId: image.id,
          sourceUrl: image.sourceUrl,
          designStoragePath,
          placementData: {},
        });
      }
    }
```

- [ ] **Step 5: Update mockup image retry route**

In `src/app/api/wizard/drafts/[id]/mockup-images/route.ts`, change the retry include to:

```ts
        mockupJob: {
          include: {
            design: { select: { storagePath: true } },
            draftDesign: {
              include: {
                design: { select: { storagePath: true } },
              },
            },
            draft: {
              include: {
                design: { select: { storagePath: true } },
              },
            },
          },
        },
```

Then replace direct `image.mockupJob.draft.design.storagePath` usage with:

```ts
    const designStoragePath =
      image.mockupJob.draftDesign?.design?.storagePath ??
      image.mockupJob.design?.storagePath ??
      image.mockupJob.draft.design?.storagePath ??
      null;

    if (!designStoragePath) {
      return NextResponse.json({ error: "Draft design not found" }, { status: 400 });
    }
```

Queue retry with:

```ts
      designStoragePath,
```

- [ ] **Step 6: Run worker tests and build**

Run:

```bash
npx tsx --test src/lib/mockup/printify-poll-worker.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 7: Commit worker design resolution**

```bash
git add src/lib/mockup/queue.ts src/lib/mockup/printify-poll-worker.ts src/lib/mockup/printify-poll-worker.test.ts 'src/app/api/wizard/drafts/[id]/mockup-images/route.ts'
git commit -m "fix: resolve mockup design per job"
```

---

### Task 6: Step 3 Batch Progress And Grouped Results

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`
- Modify: `src/lib/mockup/multi-design.ts`
- Modify: `src/lib/mockup/multi-design.test.ts`

- [ ] **Step 1: Add helper test for active design IDs**

Append to `src/lib/mockup/multi-design.test.ts`:

```ts
import { getActiveDraftDesignId } from "./multi-design";

test("getActiveDraftDesignId keeps selected active tab when still available", () => {
  assert.equal(getActiveDraftDesignId(["a", "b"], "b"), "b");
  assert.equal(getActiveDraftDesignId(["a", "b"], "missing"), "a");
  assert.equal(getActiveDraftDesignId([], "missing"), null);
});
```

- [ ] **Step 2: Implement active tab helper**

Add to `src/lib/mockup/multi-design.ts`:

```ts
export function getActiveDraftDesignId(
  draftDesignIds: string[],
  current: string | null | undefined,
): string | null {
  if (current && draftDesignIds.includes(current)) return current;
  return draftDesignIds[0] ?? null;
}
```

- [ ] **Step 3: Run helper tests**

Run:

```bash
npx tsx --test src/lib/mockup/multi-design.test.ts
```

Expected: PASS.

- [ ] **Step 4: Add Step 3 batch state**

In `step-3/page.tsx`, import helpers:

```ts
import {
  getActiveDraftDesignId,
  getLatestJobByDraftDesignId,
  hasActiveOrCompletedJobsForAllDesigns,
} from "@/lib/mockup/multi-design";
import { getDraftDesignIdsFromDraft } from "@/lib/wizard/use-wizard-store";
```

Add local types near existing types:

```ts
type DesignJobState = {
  jobId: string;
  draftDesignId: string;
  designId: string;
  designName: string;
  status: string;
  completed: number;
  total: number;
  failed: number;
  images: any[];
  errorMessage?: string | null;
};
```

Replace single-job state with:

```ts
  const [activeDraftDesignId, setActiveDraftDesignId] = useState<string | null>(null);
  const [mockupJobsByDesign, setMockupJobsByDesign] = useState<Map<string, DesignJobState>>(new Map());
  const [hasTriggeredBatchRender, setHasTriggeredBatchRender] = useState(false);
```

Remove the legacy `mockupJobId`, `mockupImages`, `jobProgress`, and `jobStatus` state after the grouped state compiles.

- [ ] **Step 5: Derive selected draft designs**

Add these derivations:

```ts
  const selectedDraftDesigns = useMemo(() => {
    const childRows = draft?.draftDesigns ?? [];
    if (childRows.length > 0) return childRows;
    return draft?.designId
      ? [{
          id: "legacy",
          designId: draft.designId,
          sortOrder: 0,
          design: {
            id: draft.designId,
            name: "Design",
            previewUrl: designPreviewUrl,
            storagePath: "",
            width: 0,
            height: 0,
          },
          jobs: draft.mockupJobs ?? [],
        }]
      : [];
  }, [draft?.draftDesigns, draft?.designId, draft?.mockupJobs, designPreviewUrl]);

  const selectedDraftDesignIds = selectedDraftDesigns.map((entry) => entry.id);
```

Synchronize active tab:

```ts
  useEffect(() => {
    setActiveDraftDesignId((current) => getActiveDraftDesignId(selectedDraftDesignIds, current));
  }, [selectedDraftDesignIds.join("|")]);
```

- [ ] **Step 6: Load existing per-design jobs**

Replace the old latest-job effect with:

```ts
  useEffect(() => {
    const allJobs = selectedDraftDesigns.flatMap((entry) =>
      (entry.jobs ?? []).map((job: any) => ({
        ...job,
        draftDesignId: job.draftDesignId ?? entry.id,
        designId: job.designId ?? entry.designId,
        designName: entry.design.name,
      })),
    );
    const latest = getLatestJobByDraftDesignId(allJobs);
    const next = new Map<string, DesignJobState>();

    for (const entry of selectedDraftDesigns) {
      const job = latest.get(entry.id);
      if (!job) continue;
      next.set(entry.id, {
        jobId: job.id,
        draftDesignId: entry.id,
        designId: entry.designId,
        designName: entry.design.name,
        status: job.status,
        completed: job.completedImages ?? 0,
        total: job.totalImages ?? job.images?.length ?? 0,
        failed: job.failedImages ?? 0,
        images: job.images ?? [],
        errorMessage: job.errorMessage ?? null,
      });
    }

    setMockupJobsByDesign(next);
  }, [selectedDraftDesigns]);
```

- [ ] **Step 7: Add batch generate handler**

Replace `handleGenerate` body with a batch call:

```ts
    setGenerating(true);
    setGenerationStartedAt(Date.now());
    setShowSlowMockupWarning(false);
    setHasTriggeredBatchRender(true);
    setError("");

    const enabledColorIds = Array.from(selectedColorIds);
    await updateDraft({
      templateId: selectedTemplate.id,
      enabledColorIds,
      enabledSizes: Array.from(selectedSizes),
      placementOverride: placementOverride || undefined,
    });
    await saveDraftImmediately();

    try {
      const res = await fetch(`/api/mockup-jobs/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Không thể tạo mockup");
        setGenerating(false);
        return;
      }

      const next = new Map<string, DesignJobState>();
      for (const job of data.jobs ?? []) {
        next.set(job.draftDesignId, {
          jobId: job.jobId,
          draftDesignId: job.draftDesignId,
          designId: job.designId,
          designName: job.designName,
          status: job.status ?? "running",
          completed: 0,
          total: 0,
          failed: 0,
          images: [],
        });
      }
      for (const failure of data.failures ?? []) {
        next.set(failure.draftDesignId, {
          jobId: "",
          draftDesignId: failure.draftDesignId,
          designId: failure.designId,
          designName: failure.designName,
          status: "failed",
          completed: 0,
          total: 0,
          failed: 1,
          images: [],
          errorMessage: failure.error,
        });
      }
      setMockupJobsByDesign(next);
    } catch {
      setError("Lỗi kết nối");
      setGenerating(false);
    }
```

- [ ] **Step 8: Auto-trigger batch generation once**

Add effect after template load:

```ts
  useEffect(() => {
    if (!draft || loading || hasTriggeredBatchRender) return;
    if (selectedDraftDesigns.length === 0) return;
    if (selectedColorIds.size === 0 || !selectedTemplateReady || hasSelectedMissingCustomColors) return;

    const selectedIds = selectedDraftDesigns.map((entry) => entry.id);
    const jobs = Array.from(mockupJobsByDesign.values()).map((job) => ({
      id: job.jobId,
      draftDesignId: job.draftDesignId,
      status: job.status,
    }));

    if (!draft.mockupsStale && hasActiveOrCompletedJobsForAllDesigns(selectedIds, jobs)) return;

    void handleGenerate();
  }, [
    draft?.id,
    draft?.mockupsStale,
    loading,
    hasTriggeredBatchRender,
    selectedDraftDesigns.length,
    selectedColorIds.size,
    selectedTemplateReady,
    hasSelectedMissingCustomColors,
  ]);
```

Wrap `handleGenerate` in `useCallback` with the dependencies referenced by the function before adding this effect.

- [ ] **Step 9: Poll all active jobs**

Replace single-job polling with:

```ts
  useEffect(() => {
    const activeJobs = Array.from(mockupJobsByDesign.values()).filter(
      (job) => job.jobId && !isTerminalMockupJobStatus(job.status),
    );
    if (activeJobs.length === 0) return;

    let cancelled = false;
    let timeoutId: NodeJS.Timeout;

    const poll = async () => {
      const updates = await Promise.all(
        activeJobs.map(async (state) => {
          const res = await fetch(`/api/mockup-jobs/${state.jobId}`);
          if (!res.ok) return state;
          const job = await res.json();
          return {
            ...state,
            status: job.status,
            completed: job.completedImages,
            total: job.totalImages,
            failed: job.failedImages,
            images: job.images ?? [],
            errorMessage: job.errorMessage ?? null,
          };
        }),
      );

      if (cancelled) return;
      setMockupJobsByDesign((current) => {
        const next = new Map(current);
        for (const update of updates) next.set(update.draftDesignId, update);
        return next;
      });

      const stillRunning = updates.some(
        (job) => !isTerminalMockupJobStatus(job.status) &&
          !(job.total > 0 && job.completed + job.failed >= job.total),
      );
      setGenerating(stillRunning);
      if (stillRunning) timeoutId = setTimeout(poll, 2000);
      else {
        setGenerationStartedAt(null);
        void loadDraft(draftId as string);
      }
    };

    timeoutId = setTimeout(poll, 500);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [mockupJobsByDesign, draftId, loadDraft]);
```

- [ ] **Step 10: Render progress panel and grouped tabs**

Before the existing results section, render:

```tsx
      {mockupJobsByDesign.size > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 12 }}>
            Đang tạo mockup cho {selectedDraftDesigns.length} designs
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {selectedDraftDesigns.map((entry) => {
              const state = mockupJobsByDesign.get(entry.id);
              const total = state?.total ?? 0;
              const completed = state?.completed ?? 0;
              const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
              return (
                <div key={entry.id}>
                  <div className="flex items-center justify-between" style={{ fontSize: "0.82rem", marginBottom: 4 }}>
                    <strong>{entry.design.name}</strong>
                    <span style={{ opacity: 0.6 }}>
                      {state?.status ?? "Đang chờ"} {total > 0 ? `(${completed}/${total})` : ""}
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, backgroundColor: "var(--bg-tertiary)", overflow: "hidden" }}>
                    <div style={{ width: `${percent}%`, height: "100%", backgroundColor: "var(--color-wise-green)" }} />
                  </div>
                  {state?.errorMessage && (
                    <div style={{ color: "var(--color-danger)", fontSize: "0.78rem", marginTop: 4 }}>
                      {state.errorMessage}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
```

For results, compute:

```ts
  const activeDesignJob = activeDraftDesignId ? mockupJobsByDesign.get(activeDraftDesignId) : null;
  const activeMockupImages = activeDesignJob?.images ?? [];
```

Replace result uses of `mockupImages` with `activeMockupImages`. Add tabs:

```tsx
      {selectedDraftDesigns.length > 1 && (
        <div className="flex gap-2" style={{ marginBottom: 12, overflowX: "auto" }}>
          {selectedDraftDesigns.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === activeDraftDesignId ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => setActiveDraftDesignId(entry.id)}
            >
              {entry.design.name}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 11: Run build**

Run:

```bash
npm run build
```

Expected: build passes.

- [ ] **Step 12: Commit Step 3**

```bash
git add 'src/app/(authed)/wizard/[draftId]/step-3/page.tsx' src/lib/mockup/multi-design.ts src/lib/mockup/multi-design.test.ts
git commit -m "feat: show batch mockup progress"
```

---

### Task 7: Checklist, Step 4 Primary Design, And Step 5 Review

**Files:**
- Modify: `src/app/api/wizard/drafts/[id]/checklist.ts`
- Modify: `src/app/api/wizard/drafts/[id]/generate-content/route.ts`
- Modify: `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`
- Modify: `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`
- Modify: `src/app/api/wizard/drafts/[id]/route.test.ts`

- [ ] **Step 1: Add checklist multi-design test**

Append to `src/app/api/wizard/drafts/[id]/route.test.ts`:

```ts
it("requires each selected design to have mockups for every selected color", async () => {
  const checklist = await buildChecklist({
    enabledColorIds: ["blue"],
    store: {
      colors: [{ id: "blue", name: "Royal Blue" }],
      template: { defaultPlacement: placement },
    },
    aiContent: { title: "Title", description: "Description", tags: ["tag"] },
    design: { width: 1000, height: 1000, dpi: 300 },
    draftDesigns: [
      {
        id: "wdd_1",
        designId: "design_1",
        sortOrder: 0,
        jobs: [
          {
            status: "completed",
            createdAt: "2026-05-24T10:00:00.000Z",
            images: [
              {
                colorName: "Royal Blue",
                included: true,
                compositeUrl: "https://images-api.printify.com/mockup/blue-a.png",
                sourceUrl: "https://images-api.printify.com/mockup/blue-a.png",
              },
            ],
          },
        ],
      },
      {
        id: "wdd_2",
        designId: "design_2",
        sortOrder: 1,
        jobs: [
          {
            status: "completed",
            createdAt: "2026-05-24T10:00:00.000Z",
            images: [],
          },
        ],
      },
    ],
    mockupJobs: [],
    mockupsStale: false,
  });

  assert.equal(checklist.mockupsMatchColors, false);
  assert.equal(checklist.readyToPublish, false);
});
```

- [ ] **Step 2: Run checklist test and verify failure**

Run:

```bash
npx tsx --test 'src/app/api/wizard/drafts/[id]/route.test.ts'
```

Expected: FAIL because `buildChecklist` still checks only draft-level jobs.

- [ ] **Step 3: Update checklist implementation**

In `checklist.ts`, replace the single latest-job logic with:

```ts
  const draftDesigns = ((draft.draftDesigns ?? []) as Array<{
    id: string;
    jobs?: Array<{
      id?: string;
      createdAt?: Date | string;
      status: string;
      images?: Array<{
        colorName: string;
        included: boolean;
        compositeUrl?: string | null;
        sourceUrl?: string | null;
      }>;
    }>;
  }>);

  const selectedDesignJobGroups =
    draftDesigns.length > 0
      ? draftDesigns.map((entry) => entry.jobs ?? [])
      : [(draft.mockupJobs ?? [])];

  const mockupsMatchColors =
    selectedColors.length > 0 &&
    selectedDesignJobGroups.length > 0 &&
    selectedDesignJobGroups.every((jobs) => {
      const completedJobsSorted = jobs
        .filter((job) => job.status === "completed")
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
      const latestJob = completedJobsSorted[0];
      const includedImages = latestJob
        ? (latestJob.images ?? [])
            .filter((image) => image.included)
            .filter((image) => !requireRealPrintifyMockups || isRealPrintifyMockup(image))
        : [];
      const colorsWithMockup = new Set(
        includedImages.map((image) => normalizeColorName(image.colorName)),
      );
      return selectedColors.every((color) => colorsWithMockup.has(normalizeColorName(color.name)));
    });
```

Keep `contentComplete`, `placementValid`, `mockupsNotStale`, and `readyToPublish` unchanged.

- [ ] **Step 4: Update generate-content route primary design**

In `generate-content/route.ts`, include `draftDesigns`:

```ts
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        include: { design: true },
      },
```

Use primary design:

```ts
  const primaryDesign = draft.draftDesigns[0]?.design ?? draft.design;
  if (!primaryDesign) {
    return NextResponse.json({ error: "Design not selected" }, { status: 400 });
  }
```

Change input:

```ts
    designName: primaryDesign.name,
```

- [ ] **Step 5: Update Step 4 display primary design references**

Search:

```bash
rg -n "designId|draftDesigns|design" 'src/app/(authed)/wizard/[draftId]/step-4/page.tsx'
```

Add this primary-design derivation near existing draft-derived values:

```ts
  const primaryDraftDesign = draft?.draftDesigns?.[0] ?? null;
  const primaryDesignId = primaryDraftDesign?.designId ?? draft?.designId ?? null;
```

Replace direct `draft.designId` fetch keys in Step 4 with `primaryDesignId`.

- [ ] **Step 6: Update Step 5 grouped mockup derivation**

In `step-5/page.tsx`, derive selected designs:

```ts
  const draftDesigns = draft?.draftDesigns ?? [];
  const selectedDesigns = draftDesigns.length > 0
    ? draftDesigns
    : draft?.designId
      ? [{ id: "legacy", designId: draft.designId, sortOrder: 0, design: { id: draft.designId, name: "Design" }, jobs: mockupJobs }]
      : [];
  const [activeDraftDesignId, setActiveDraftDesignId] = useState<string | null>(selectedDesigns[0]?.id ?? null);
```

Replace `latestCompletedJob` and `allMockups` with grouped data:

```ts
  const mockupsByDesign = useMemo(() => {
    return selectedDesigns.map((entry: any) => {
      const jobs = entry.jobs ?? [];
      const latestCompletedJob = [...jobs].reverse().find((job: MockupJob) => job.status === "completed") ?? null;
      const mockups = (latestCompletedJob?.images ?? []).filter((image: MockupImage) => {
        const isCustomSource = image.sourceUrl?.startsWith("mockup://custom/") || image.sourceUrl?.startsWith("mockup://custom-");
        const isPrintifySource = isRealPrintifyMockupMedia(image);
        return image.included &&
          (isCustomSource || isPrintifySource) &&
          colorHexLookup.has(normalizeColorName(image.colorName));
      });
      return { draftDesign: entry, mockups };
    });
  }, [selectedDesigns, colorHexLookup]);

  const activeMockupGroup =
    mockupsByDesign.find((group) => group.draftDesign.id === activeDraftDesignId) ??
    mockupsByDesign[0] ??
    null;
  const allMockups = activeMockupGroup?.mockups ?? [];
  const totalMockupCount = mockupsByDesign.reduce((sum, group) => sum + group.mockups.length, 0);
```

Add design tabs above the carousel:

```tsx
          {mockupsByDesign.length > 1 && (
            <div className="flex gap-2" style={{ marginBottom: 8, overflowX: "auto" }}>
              {mockupsByDesign.map((group) => (
                <button
                  key={group.draftDesign.id}
                  type="button"
                  className={group.draftDesign.id === activeMockupGroup?.draftDesign.id ? "btn btn-primary" : "btn btn-secondary"}
                  onClick={() => {
                    setActiveDraftDesignId(group.draftDesign.id);
                    setCarouselIdx(0);
                  }}
                >
                  {group.draftDesign.design.name} ({group.mockups.length})
                </button>
              ))}
            </div>
          )}
```

Update summary:

```tsx
              <br />• Designs: {selectedDesigns.length} designs
              <br />• Listings: {selectedDesigns.length} listings ({colors.length} màu mỗi listing)
              <br />• Mockups: {totalMockupCount} ảnh đã chọn
```

- [ ] **Step 7: Run route tests and build**

Run:

```bash
npx tsx --test 'src/app/api/wizard/drafts/[id]/route.test.ts'
npm run build
```

Expected: tests and build pass.

- [ ] **Step 8: Commit checklist and review UI**

```bash
git add 'src/app/api/wizard/drafts/[id]/checklist.ts' 'src/app/api/wizard/drafts/[id]/generate-content/route.ts' 'src/app/(authed)/wizard/[draftId]/step-4/page.tsx' 'src/app/(authed)/wizard/[draftId]/step-5/page.tsx' 'src/app/api/wizard/drafts/[id]/route.test.ts'
git commit -m "feat: review mockups per selected design"
```

---

### Task 8: Batch Publish And Listing-Specific Worker

**Files:**
- Modify: `src/app/api/wizard/drafts/[id]/publish/route.ts`
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/lib/publish/worker.test.ts`
- Modify: `src/app/api/listings/[id]/retry-printify/route.ts`
- Modify: `src/app/api/listings/[id]/force-republish/route.ts`
- Modify: `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`

- [ ] **Step 1: Add publish worker helper tests**

In `src/lib/publish/worker.test.ts`, add imports after existing import:

```ts
import {
  resolveListingDesign,
  resolveListingPrintifyDraftState,
} from "./worker";
```

Append tests:

```ts
describe("multi-design publish helpers", () => {
  it("resolves listing design from wizardDraftDesign before legacy draft design", () => {
    assert.deepEqual(
      resolveListingDesign({
        wizardDraftDesign: {
          design: { id: "design_child", storagePath: "child.png" },
        },
        design: { id: "design_listing", storagePath: "listing.png" },
      } as any, {
        design: { id: "design_legacy", storagePath: "legacy.png" },
      } as any),
      { id: "design_child", storagePath: "child.png" },
    );
  });

  it("resolves Printify draft product state from child row before legacy draft", () => {
    assert.deepEqual(
      resolveListingPrintifyDraftState({
        wizardDraftDesign: {
          id: "wdd_1",
          printifyImageId: "image_child",
          printifyDraftProductId: "product_child",
        },
      } as any, {
        printifyImageId: "image_legacy",
        printifyDraftProductId: "product_legacy",
      } as any),
      {
        owner: "draftDesign",
        draftDesignId: "wdd_1",
        printifyImageId: "image_child",
        printifyDraftProductId: "product_child",
      },
    );
  });
});
```

- [ ] **Step 2: Run worker tests and verify failure**

Run:

```bash
npx tsx --test src/lib/publish/worker.test.ts
```

Expected: FAIL because helper exports do not exist.

- [ ] **Step 3: Add publish helper exports**

In `src/lib/publish/worker.ts`, export:

```ts
export function resolveListingDesign(listing: any, draft: any) {
  return listing.wizardDraftDesign?.design ?? listing.design ?? draft.design ?? null;
}

export function resolveListingPrintifyDraftState(listing: any, draft: any): {
  owner: "draftDesign" | "draft";
  draftDesignId: string | null;
  printifyImageId: string | null;
  printifyDraftProductId: string | null;
} {
  if (listing.wizardDraftDesign) {
    return {
      owner: "draftDesign",
      draftDesignId: listing.wizardDraftDesign.id,
      printifyImageId: listing.wizardDraftDesign.printifyImageId ?? null,
      printifyDraftProductId: listing.wizardDraftDesign.printifyDraftProductId ?? null,
    };
  }

  return {
    owner: "draft",
    draftDesignId: null,
    printifyImageId: draft.printifyImageId ?? null,
    printifyDraftProductId: draft.printifyDraftProductId ?? null,
  };
}
```

- [ ] **Step 4: Update publish route to create N listings**

In `publish/route.ts`, load child rows:

```ts
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        include: { design: true },
      },
```

Replace single design validation:

```ts
  const selectedDraftDesigns = draft.draftDesigns.length > 0
    ? draft.draftDesigns
    : draft.design
      ? [{
          id: null,
          designId: draft.design.id,
          design: draft.design,
        }]
      : [];

  if (selectedDraftDesigns.length === 0) {
    return NextResponse.json({ error: "Design not selected" }, { status: 400 });
  }
```

Replace single existing listing lookup with:

```ts
  const existingListings = await prisma.listing.findMany({
    where: {
      tenantId: session.tenantId,
      wizardDraftId: draftId,
      OR: [
        { wizardDraftDesignId: { in: selectedDraftDesigns.map((entry) => entry.id).filter(Boolean) as string[] } },
        { wizardDraftDesignId: null, designId: { in: selectedDraftDesigns.map((entry) => entry.designId) } },
      ],
    },
  });
  const existingByDraftDesignId = new Map(existingListings.map((listing) => [listing.wizardDraftDesignId ?? listing.designId, listing]));
```

Create listings in a loop:

```ts
  const listingResults = [];

  for (const draftDesign of selectedDraftDesigns) {
    const existing = existingByDraftDesignId.get(draftDesign.id ?? draftDesign.designId);
    if (existing) {
      listingResults.push({
        listingId: existing.id,
        draftDesignId: draftDesign.id,
        designId: draftDesign.designId,
        status: existing.status,
        alreadyPublished: true,
      });
      continue;
    }

    const idempotencyKey = generateIdempotencyKey(
      `${draftId}:${draftDesign.id ?? draftDesign.designId}`,
      session.tenantId,
    );

    const listing = await prisma.listing.create({
      data: {
        tenantId: session.tenantId,
        storeId: draft.storeId,
        designId: draftDesign.designId,
        templateId: template?.id || null,
        wizardDraftId: draftId,
        wizardDraftDesignId: draftDesign.id,
        title: aiContent.title || "",
        descriptionHtml: aiContent.description || "",
        tags: aiContent.tags || [],
        priceUsd,
        createdBy: session.id,
        variants: {
          create: colors.map((c) => ({
            colorName: c.title,
            colorHex: c.hex,
          })),
        },
        publishJobs: {
          create: [
            { idempotencyKey: `${idempotencyKey}-shopify`, stage: "SHOPIFY" },
            { idempotencyKey: `${idempotencyKey}-printify`, stage: "PRINTIFY" },
          ],
        },
      },
    });

    listingResults.push({
      listingId: listing.id,
      draftDesignId: draftDesign.id,
      designId: draftDesign.designId,
      status: "PUBLISHING",
      alreadyPublished: false,
    });

    runPublishWorker({
      listingId: listing.id,
      draftId,
      tenantId: session.tenantId,
    }).catch((err) => {
      console.error("[Publish API] Worker error:", err);
    });
  }
```

Return:

```ts
  return NextResponse.json({ listings: listingResults });
```

- [ ] **Step 5: Update publish worker includes and design resolution**

In `runPublishWorker`, load listing:

```ts
      include: {
        variants: true,
        publishJobs: true,
        design: true,
        wizardDraftDesign: {
          include: {
            design: true,
          },
        },
      },
```

Load draft with:

```ts
        draftDesigns: {
          include: {
            design: true,
            jobs: true,
          },
        },
```

Use:

```ts
    const listingDesign = resolveListingDesign(listing, draft);
    if (!listingDesign?.storagePath) throw new Error("Design file not found");
```

Replace latest completed job query:

```ts
    const latestCompletedJob = await prisma.mockupJob.findFirst({
      where: listing.wizardDraftDesignId
        ? { draftDesignId: listing.wizardDraftDesignId, status: "completed" }
        : { draftId, status: "completed" },
      orderBy: { createdAt: "desc" },
    });
```

In `runPrintifyStage`, replace `draft.design` usage with:

```ts
    const listingDesign = resolveListingDesign(listing, draft);
    const designPath = listingDesign?.storagePath
      ? storage.resolvePath(listingDesign.storagePath)
      : null;
```

Resolve Printify state:

```ts
    const printifyDraftState = resolveListingPrintifyDraftState(listing, draft);
```

Use `printifyDraftState.printifyDraftProductId` in place of `draft.printifyDraftProductId`, and `listingDesign.storagePath` in place of `draft.design.storagePath`.

- [ ] **Step 6: Update stale Printify draft product clearing**

Change `publishExistingPrintifyDraftProduct` input:

```ts
  draftDesignId?: string | null;
  draftProductStateOwner: "draftDesign" | "draft";
```

When clearing stale product:

```ts
      if (input.draftProductStateOwner === "draftDesign" && input.draftDesignId) {
        await prisma.wizardDraftDesign.update({
          where: { id: input.draftDesignId },
          data: { printifyDraftProductId: null },
        });
      } else {
        await prisma.wizardDraft.update({
          where: { id: input.draftId },
          data: { printifyDraftProductId: null },
        });
      }
```

- [ ] **Step 7: Emit per-listing SSE metadata**

Update `emitEvent` calls in `runPublishWorker` and `runPrintifyStage` so data includes:

```ts
{
  listingId,
  draftDesignId: listing.wizardDraftDesignId,
  designId: listing.designId,
  ...
}
```

For example:

```ts
    emitEvent("publish.shopify.start", {
      stage: "SHOPIFY",
      listingId,
      draftDesignId: listing.wizardDraftDesignId,
      designId: listing.designId,
    });
```

- [ ] **Step 8: Update retry Printify route**

In `retry-printify/route.ts`, include listing child design:

```ts
    include: {
      variants: true,
      publishJobs: true,
      design: true,
      wizardDraftDesign: {
        include: { design: true },
      },
    },
```

Load draft with `draftDesigns`, then pass the enriched listing to `runPrintifyStage`.

- [ ] **Step 9: Update force republish route**

In `force-republish/route.ts`, select:

```ts
    select: { id: true, wizardDraftId: true, wizardDraftDesignId: true },
```

After deleting the listing, reset draft:

```ts
  await prisma.wizardDraft.update({
    where: { id: listing.wizardDraftId },
    data: { status: "READY" },
  });
```

Do not delete sibling listings.

- [ ] **Step 10: Update Step 5 publish client**

In `step-5/page.tsx`, replace single `successListingId`/`failedListingId` state with:

```ts
  const [publishListings, setPublishListings] = useState<Array<{
    listingId: string;
    draftDesignId: string | null;
    designId: string;
    status: string;
    alreadyPublished?: boolean;
  }>>([]);
```

On publish response:

```ts
      setPublishListings(data.listings ?? []);
```

In SSE handlers, update the matching row by `listingId`:

```ts
          if (data.data?.listingId) {
            setPublishListings((current) =>
              current.map((listing) =>
                listing.listingId === data.data.listingId
                  ? { ...listing, status: data.data.status ?? listing.status }
                  : listing,
              ),
            );
          }
```

Render per-listing progress rows:

```tsx
              {publishListings.map((listing) => (
                <div key={listing.listingId} className="flex items-center justify-between" style={{ fontSize: "0.84rem" }}>
                  <span>{listing.designId}</span>
                  <span>{listing.status}</span>
                </div>
              ))}
```

- [ ] **Step 11: Run publish tests and build**

Run:

```bash
npx tsx --test src/lib/publish/worker.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 12: Commit batch publish**

```bash
git add 'src/app/api/wizard/drafts/[id]/publish/route.ts' src/lib/publish/worker.ts src/lib/publish/worker.test.ts 'src/app/api/listings/[id]/retry-printify/route.ts' 'src/app/api/listings/[id]/force-republish/route.ts' 'src/app/(authed)/wizard/[draftId]/step-5/page.tsx'
git commit -m "feat: publish one listing per selected design"
```

---

### Task 9: Analytics And Compatibility Sweep

**Files:**
- Modify: `src/lib/analytics/queries.ts`
- Modify: `src/lib/wizard/cleanup.ts`
- Modify: `src/lib/wizard/cleanup-orphan-printify-products.ts`
- Modify: `src/lib/wizard/cleanup.test.ts`
- Modify: `src/lib/wizard/cleanup-orphan-printify-products.test.ts`

- [ ] **Step 1: Update analytics design lookup**

In `src/lib/analytics/queries.ts`, replace draft-only design mapping with listing-first mapping:

```ts
  const directDesignIds = listings.map((listing) => listing.designId).filter(Boolean) as string[];
  const draftIds = listings
    .filter((listing) => !listing.designId)
    .map((listing) => listing.wizardDraftId)
    .filter(Boolean) as string[];
```

When resolving each row:

```ts
    const designId = listing.designId ?? (listing.wizardDraftId ? draftDesignMap.get(listing.wizardDraftId) : null);
```

- [ ] **Step 2: Update cleanup to delete child Printify products**

In `src/lib/wizard/cleanup.ts`, include child rows:

```ts
    include: {
      draftDesigns: {
        select: { printifyDraftProductId: true },
      },
    },
```

Delete all distinct product IDs:

```ts
  const productIds = [
    draft.printifyDraftProductId,
    ...draft.draftDesigns.map((entry) => entry.printifyDraftProductId),
  ].filter((id): id is string => Boolean(id));

  for (const productId of new Set(productIds)) {
    await client.deleteProduct(externalShopId, productId);
  }
```

- [ ] **Step 3: Update orphan cleanup to scan child products**

In `cleanup-orphan-printify-products.ts`, find child rows with products and clear them after deletion:

```ts
  const draftDesigns = await prisma.wizardDraftDesign.findMany({
    where: {
      printifyDraftProductId: { not: null },
      draft: {
        updatedAt: { lt: cutoff },
        status: { in: ["ABANDONED", "DRAFT"] },
      },
    },
    include: {
      draft: { select: { storeId: true } },
    },
  });
```

For each deleted child product:

```ts
          await prisma.wizardDraftDesign.update({
            where: { id: draftDesign.id },
            data: {
              printifyDraftProductId: null,
              printifyImageId: null,
            },
          });
```

- [ ] **Step 4: Add cleanup source tests**

Add source tests to existing cleanup tests:

```ts
test("cleanup includes wizard draft design Printify products", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/wizard/cleanup.ts"), "utf8");
  assert.match(source, /draftDesigns/);
  assert.match(source, /printifyDraftProductId/);
  assert.match(source, /new Set\(productIds\)/);
});
```

And:

```ts
test("orphan cleanup clears wizard draft design Printify product ids", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/wizard/cleanup-orphan-printify-products.ts"),
    "utf8",
  );
  assert.match(source, /wizardDraftDesign\.findMany/);
  assert.match(source, /wizardDraftDesign\.update/);
});
```

- [ ] **Step 5: Run compatibility tests and build**

Run:

```bash
npx tsx --test src/lib/wizard/cleanup.test.ts src/lib/wizard/cleanup-orphan-printify-products.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit compatibility sweep**

```bash
git add src/lib/analytics/queries.ts src/lib/wizard/cleanup.ts src/lib/wizard/cleanup-orphan-printify-products.ts src/lib/wizard/cleanup.test.ts src/lib/wizard/cleanup-orphan-printify-products.test.ts
git commit -m "fix: preserve multi-design compatibility paths"
```

---

### Task 10: Final Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx tsx --test \
  src/lib/wizard/design-selection.test.ts \
  src/lib/wizard/state.test.ts \
  src/lib/wizard/use-wizard-store.test.ts \
  src/lib/mockup/multi-design.test.ts \
  src/lib/mockup/printify-poll-worker.test.ts \
  'src/app/api/wizard/drafts/[id]/route.test.ts' \
  src/lib/publish/worker.test.ts \
  src/lib/wizard/cleanup.test.ts \
  src/lib/wizard/cleanup-orphan-printify-products.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run Prisma checks**

Run:

```bash
npx prisma validate
npx prisma generate
```

Expected: both pass.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Run manual QA with dev server**

Start the app:

```bash
npm run dev
```

Manual checks:

1. Open `/wizard`.
2. Create or open a draft.
3. Step 2: select three designs and verify `3/5 đã chọn`.
4. Step 2: select five designs and verify unselected cards are disabled.
5. Remove one design and verify unselected cards are enabled again.
6. Step 3: verify batch mockup generation starts once.
7. Step 3: verify each selected design has its own progress row.
8. Step 3: verify results switch by design tab.
9. Step 4: generate AI content and verify it uses the primary selected design.
10. Step 5: verify summary shows the selected design count and listing count.
11. Publish and verify one listing row is created per selected design.
12. Open listing records and verify each has the expected `designId`.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional files are changed. Do not commit `.superpowers/` visual companion output.

- [ ] **Step 6: Commit verification fixes**

When verification finds a defect, fix it, run the relevant focused command again, then stage only the files changed by that fix:

```bash
git commit -m "fix: complete multi-design wizard verification"
```

When verification finds no defects, skip this step and do not create an empty commit.
