# Global Mockup Library Clean Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace store-scoped CUSTOM mockups with a global tenant-level mockup library, attach mockups to CUSTOM templates by color mapping, and remove the legacy `CustomMockupSource` runtime/model.

**Architecture:** Introduce `MockupLibraryItem` as the global asset/frame source of truth and `TemplateMockupItem` as the template attachment/color-mapping join. Wizard picks point to template attachments, not global assets, and render uses pick override -> library frame -> Smart Fit fallback. After runtime is rewired, remove `/stores/[id]/mockup-library`, `StoreMockupTemplate.defaultCompositeRegionPx`, and `CustomMockupSource`.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, local disk storage, Sharp, existing mockup composite helpers, Node test runner with `tsx --test`.

---

## File Structure

- Modify: `prisma/schema.prisma` - add `MockupLibraryItem`, `TemplateMockupItem`, `MockupLibraryRenderMode`, rewire `WizardDraftMockupLibraryPick`, remove `CustomMockupSource` and `StoreMockupTemplate.defaultCompositeRegionPx`.
- Create: `prisma/migrations/20260618000000_global_mockup_library_clean_break/migration.sql` - add new tables/FKs, rewire picks, drop old table/columns.
- Create: `src/lib/mockup/global-library.ts` - shared types, render mode validation, Smart Fit region builder, serialization helpers, applies-to-color validation helpers.
- Create: `src/lib/mockup/global-library.test.ts` - unit tests for render mode validation, Smart Fit, applies-to-color matching, and effective region priority.
- Create: `src/lib/mockup/global-library-schema-source.test.ts` - schema source guard for new models and legacy removals.
- Create: `src/lib/mockup/template-mockup-matching.ts` - exact-vs-generic color matching and idempotent pick rebuild planning.
- Create: `src/lib/mockup/template-mockup-matching.test.ts` - exact replaces generic, generic fallback, no match fails, preserve override on stable keys.
- Create: `src/lib/mockup/mockup-library-service.ts` - upload normalization/storage paths, create/update/delete helpers, storage cleanup, tenant validation.
- Create: `src/app/api/mockups/route.ts` - global mockup list/upload.
- Create: `src/app/api/mockups/[mockupId]/route.ts` - global mockup update/delete.
- Create: `src/app/api/mockups/mockups-route-source.test.ts` - source guard for permission, COMPOSITE validation, delete restrict/storage cleanup.
- Create: `src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts` - template attachment list/create.
- Create: `src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/[itemId]/route.ts` - template attachment update/delete.
- Create: `src/app/api/stores/template-mockups-route-source.test.ts` - source guard for CUSTOM-only attach, duplicate 409, color validation, primary uniqueness.
- Create: `src/app/(authed)/mockups/page.tsx` - global Mockups page.
- Modify: `src/app/(authed)/AuthedShell.tsx` - add Workspace `Mockups` sidebar item gated by `mockup_library`.
- Modify: `src/app/(authed)/admin/acl/AclClient.tsx` - keep `mockup_library` permission available.
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx` - CUSTOM Mockups tab selects/uploads global mockups and maps colors; no direct frame editing.
- Create: `src/components/mockup/GlobalMockupEditorModal.tsx` - upload/edit frame modal for `/mockups`.
- Create: `src/components/mockup/TemplateMockupPicker.tsx` - template attachment picker and color mapping controls.
- Modify: `src/components/mockup/WizardMockupSourcePanel.tsx` - use template mockup items/picks, remove old `/mockup-library` links.
- Modify: `src/components/mockup/ColorMockupCardGrid.tsx` - use template mockup item IDs for pick updates.
- Modify: `src/lib/mockup/custom-library.ts` - keep generic region helpers but remove `CustomMockupSource` serialization/scope concepts.
- Modify: `src/lib/mockup/generation.ts` - generate CUSTOM mockups from `TemplateMockupItem.mockup`.
- Modify: `src/lib/mockup/worker.ts` - render CUSTOM mockups from global library assets and new region priority.
- Modify: `src/lib/mockup/printify-poll-worker.ts` - remove legacy template default/source region reads.
- Modify: `src/app/api/wizard/drafts/[id]/mockup-library-picks/route.ts` - accept `templateMockupItemIds`, rebuild picks by `[draftId, templateMockupItemId, colorId]`.
- Modify: `src/app/api/wizard/drafts/[id]/mockup-sources/route.ts` - return eligible template mockup items instead of legacy sources during the UI rewire, then delete this route after `WizardMockupSourcePanel` reads draft/template mockup pick data directly.
- Delete: `src/app/api/wizard/drafts/[id]/mockup-sources/[sourceId]/route.ts`.
- Modify: `src/app/api/wizard/drafts/[id]/route.ts` and checklist module - CUSTOM readiness uses template mockup matching.
- Delete: `src/app/(authed)/stores/[id]/mockup-library/page.tsx`.
- Delete: `src/app/api/stores/[id]/mockup-library/route.ts`.
- Delete: `src/app/api/stores/[id]/mockup-library/[sourceId]/route.ts`.
- Delete: `src/app/api/stores/mockup-library-route-source.test.ts`.
- Modify: `src/components/mockup/custom-mockup-ui-contract.test.ts` - update old assertions to new `/mockups` and no direct template frame edit.
- Modify: `src/app/api/stores/mockup-templates-route-source.test.ts` - remove `defaultCompositeRegionPx` expectations.
- Modify: `src/lib/mockup/custom-library-region.test.ts` - remove template default priority tests and keep region helper tests.

---

### Task 1: Schema Source Guards For Clean Break

**Files:**
- Create: `src/lib/mockup/global-library-schema-source.test.ts`

- [ ] **Step 1: Write failing schema source guards**

Create `src/lib/mockup/global-library-schema-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

test("schema defines global mockup library models", () => {
  assert.match(schema, /model MockupLibraryItem \{/);
  assert.match(schema, /tenantId\s+String\s+@map\("tenant_id"\)/);
  assert.match(schema, /uploadedById\s+String\?\s+@map\("uploaded_by_id"\)/);
  assert.match(schema, /mimeType\s+String\s+@map\("mime_type"\)/);
  assert.match(schema, /fileSizeBytes\s+Int\s+@map\("file_size_bytes"\)/);
  assert.match(schema, /compositeRegionPx\s+Json\?\s+@map\("composite_region_px"\)/);
  assert.match(schema, /model TemplateMockupItem \{/);
  assert.match(schema, /appliesToColorIds\s+Json\s+@map\("applies_to_color_ids"\)/);
  assert.match(schema, /@@unique\(\[templateId, mockupId\]\)/);
});

test("schema rewires wizard picks to template mockup items", () => {
  assert.match(schema, /templateMockupItemId\s+String\s+@map\("template_mockup_item_id"\)/);
  assert.match(schema, /templateMockupItem\s+TemplateMockupItem\s+@relation\(fields: \[templateMockupItemId\], references: \[id\], onDelete: Restrict\)/);
  assert.match(schema, /@@unique\(\[draftId, templateMockupItemId, colorId\]\)/);
  assert.doesNotMatch(schema, /sourceId\s+String\s+@map\("source_id"\)/);
});

test("schema removes legacy custom mockup source model and template default frame", () => {
  assert.doesNotMatch(schema, /model CustomMockupSource \{/);
  assert.doesNotMatch(schema, /customMockupSources/);
  assert.doesNotMatch(schema, /defaultCompositeRegionPx/);
  assert.doesNotMatch(schema, /enum CustomMockupScope/);
});
```

- [ ] **Step 2: Run schema source guard and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/global-library-schema-source.test.ts
```

Expected: FAIL because `MockupLibraryItem` and `TemplateMockupItem` do not exist yet and legacy schema still exists.

- [ ] **Step 3: Commit failing schema guard**

```bash
git add src/lib/mockup/global-library-schema-source.test.ts
git commit -m "test: guard global mockup schema clean break"
```

---

### Task 2: Prisma Schema And Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260618000000_global_mockup_library_clean_break/migration.sql`

- [ ] **Step 1: Add enum and models to Prisma schema**

In `prisma/schema.prisma`, replace legacy `CustomMockupScope`, `CustomMockupView`, `CustomMockupScene`, and `CustomRenderMode` usage with these new enums/models near the template models:

```prisma
enum MockupLibraryRenderMode {
  COMPOSITE
}

enum MockupLibraryView {
  front
  back
  sleeve_left
  sleeve_right
  detail
  lifestyle
}

enum MockupLibraryScene {
  flat_lay
  hanging
  lifestyle
  model
  detail
}

model MockupLibraryItem {
  id                String                  @id @default(cuid())
  tenantId          String                  @map("tenant_id")
  name              String
  storagePath       String                  @map("storage_path")
  previewPath       String?                 @map("preview_path")
  width             Int
  height            Int
  view              MockupLibraryView
  sceneType         MockupLibraryScene      @map("scene_type")
  renderMode        MockupLibraryRenderMode @default(COMPOSITE) @map("render_mode")
  compositeRegionPx Json?                   @map("composite_region_px")
  uploadedById      String?                 @map("uploaded_by_id")
  mimeType          String                  @map("mime_type")
  fileSizeBytes     Int                     @map("file_size_bytes")
  isActive          Boolean                 @default(true) @map("is_active")
  deletedAt         DateTime?               @map("deleted_at")
  createdAt         DateTime                @default(now()) @map("created_at")
  updatedAt         DateTime                @updatedAt @map("updated_at")

  tenant        Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  uploadedBy    User?                @relation("MockupLibraryUploadedBy", fields: [uploadedById], references: [id], onDelete: SetNull)
  templateItems TemplateMockupItem[]

  @@index([tenantId, isActive, deletedAt])
  @@index([tenantId, name])
  @@map("mockup_library_items")
}

model TemplateMockupItem {
  id                String   @id @default(cuid())
  templateId        String   @map("template_id")
  mockupId          String   @map("mockup_id")
  appliesToColorIds Json     @map("applies_to_color_ids")
  sortOrder         Int      @default(0) @map("sort_order")
  isPrimary         Boolean  @default(false) @map("is_primary")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  template StoreMockupTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  mockup   MockupLibraryItem   @relation(fields: [mockupId], references: [id], onDelete: Restrict)
  picks    WizardDraftMockupLibraryPick[]

  @@unique([templateId, mockupId])
  @@index([templateId, isPrimary, sortOrder])
  @@index([mockupId])
  @@map("template_mockup_items")
}
```

- [ ] **Step 2: Rewire existing relations in Prisma schema**

Update these models:

```prisma
model Tenant {
  // keep existing fields
  mockupLibraryItems MockupLibraryItem[]
}

model User {
  // keep existing fields
  uploadedMockupLibraryItems MockupLibraryItem[] @relation("MockupLibraryUploadedBy")
}

model Store {
  // remove: customMockupSources CustomMockupSource[]
}

model StoreColor {
  // remove: customMockupSources CustomMockupSource[]
  libraryPicks WizardDraftMockupLibraryPick[]
}

model StoreMockupTemplate {
  // remove: defaultCompositeRegionPx Json? @map("default_composite_region_px")
  // remove: customMockupSources CustomMockupSource[]
  mockupItems TemplateMockupItem[]
}

model WizardDraft {
  // remove: customMockupSources CustomMockupSource[]
}
```

Replace `WizardDraftMockupLibraryPick` with:

```prisma
model WizardDraftMockupLibraryPick {
  id                   String   @id @default(cuid())
  draftId              String   @map("wizard_draft_id")
  templateMockupItemId String   @map("template_mockup_item_id")
  colorId              String   @map("color_id")
  isPrimary            Boolean  @default(false) @map("is_primary")
  sortOrder            Int      @default(0) @map("sort_order")
  compositeRegionPx    Json?    @map("composite_region_px")
  createdAt            DateTime @default(now()) @map("created_at")

  draft              WizardDraft        @relation(fields: [draftId], references: [id], onDelete: Cascade)
  templateMockupItem TemplateMockupItem  @relation(fields: [templateMockupItemId], references: [id], onDelete: Restrict)
  color              StoreColor          @relation(fields: [colorId], references: [id], onDelete: Cascade)

  @@unique([draftId, templateMockupItemId, colorId])
  @@index([draftId, colorId])
  @@index([templateMockupItemId])
  @@map("wizard_draft_mockup_library_picks")
}
```

- [ ] **Step 3: Add clean-break migration SQL**

Create `prisma/migrations/20260618000000_global_mockup_library_clean_break/migration.sql`:

```sql
CREATE TYPE "MockupLibraryRenderMode" AS ENUM ('COMPOSITE');
CREATE TYPE "MockupLibraryView" AS ENUM ('front', 'back', 'sleeve_left', 'sleeve_right', 'detail', 'lifestyle');
CREATE TYPE "MockupLibraryScene" AS ENUM ('flat_lay', 'hanging', 'lifestyle', 'model', 'detail');

CREATE TABLE "mockup_library_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "preview_path" TEXT,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "view" "MockupLibraryView" NOT NULL,
  "scene_type" "MockupLibraryScene" NOT NULL,
  "render_mode" "MockupLibraryRenderMode" NOT NULL DEFAULT 'COMPOSITE',
  "composite_region_px" JSONB,
  "uploaded_by_id" TEXT,
  "mime_type" TEXT NOT NULL,
  "file_size_bytes" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mockup_library_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "template_mockup_items" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "mockup_id" TEXT NOT NULL,
  "applies_to_color_ids" JSONB NOT NULL DEFAULT '[]',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "template_mockup_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mockup_library_items"
  ADD CONSTRAINT "mockup_library_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mockup_library_items"
  ADD CONSTRAINT "mockup_library_items_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "template_mockup_items"
  ADD CONSTRAINT "template_mockup_items_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "store_mockup_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "template_mockup_items"
  ADD CONSTRAINT "template_mockup_items_mockup_id_fkey"
  FOREIGN KEY ("mockup_id") REFERENCES "mockup_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "template_mockup_items_template_id_mockup_id_key" ON "template_mockup_items"("template_id", "mockup_id");
CREATE INDEX "mockup_library_items_tenant_id_is_active_deleted_at_idx" ON "mockup_library_items"("tenant_id", "is_active", "deleted_at");
CREATE INDEX "mockup_library_items_tenant_id_name_idx" ON "mockup_library_items"("tenant_id", "name");
CREATE INDEX "template_mockup_items_template_id_is_primary_sort_order_idx" ON "template_mockup_items"("template_id", "is_primary", "sort_order");
CREATE INDEX "template_mockup_items_mockup_id_idx" ON "template_mockup_items"("mockup_id");

TRUNCATE TABLE "wizard_draft_mockup_library_picks";

ALTER TABLE "wizard_draft_mockup_library_picks" DROP CONSTRAINT IF EXISTS "wizard_draft_mockup_library_picks_source_id_fkey";
DROP INDEX IF EXISTS "wizard_draft_mockup_library_picks_draft_id_source_id_key";
ALTER TABLE "wizard_draft_mockup_library_picks" DROP COLUMN IF EXISTS "source_id";
ALTER TABLE "wizard_draft_mockup_library_picks" ADD COLUMN "template_mockup_item_id" TEXT NOT NULL;
ALTER TABLE "wizard_draft_mockup_library_picks"
  ADD CONSTRAINT "wizard_draft_mockup_library_picks_template_mockup_item_id_fkey"
  FOREIGN KEY ("template_mockup_item_id") REFERENCES "template_mockup_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "wizard_draft_mockup_library_picks_draft_id_template_mockup_item_id_color_id_key"
  ON "wizard_draft_mockup_library_picks"("wizard_draft_id", "template_mockup_item_id", "color_id");
CREATE INDEX "wizard_draft_mockup_library_picks_template_mockup_item_id_idx"
  ON "wizard_draft_mockup_library_picks"("template_mockup_item_id");

ALTER TABLE "store_mockup_templates" DROP COLUMN IF EXISTS "default_composite_region_px";
DROP TABLE IF EXISTS "custom_mockup_sources";
DROP TYPE IF EXISTS "CustomMockupScope";
DROP TYPE IF EXISTS "CustomMockupView";
DROP TYPE IF EXISTS "CustomMockupScene";
DROP TYPE IF EXISTS "CustomRenderMode";
```

- [ ] **Step 4: Run Prisma validation and schema guard**

Run:

```bash
npx prisma validate
./node_modules/.bin/tsx --test src/lib/mockup/global-library-schema-source.test.ts
```

Expected: both pass.

- [ ] **Step 5: Commit schema and migration**

```bash
git add prisma/schema.prisma prisma/migrations/20260618000000_global_mockup_library_clean_break/migration.sql src/lib/mockup/global-library-schema-source.test.ts
git commit -m "feat: add global mockup library schema"
```

---

### Task 3: Shared Global Mockup Library Helpers

**Files:**
- Create: `src/lib/mockup/global-library.ts`
- Create: `src/lib/mockup/global-library.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/lib/mockup/global-library.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSmartFitCompositeRegion,
  chooseTemplateMockupsForColor,
  normalizeAppliesToColorIds,
  normalizeCompositeRenderMode,
  resolveLibraryCompositeRegion,
} from "./global-library";

test("normalizeCompositeRenderMode accepts only COMPOSITE", () => {
  assert.equal(normalizeCompositeRenderMode("COMPOSITE"), "COMPOSITE");
  assert.equal(normalizeCompositeRenderMode(null), "COMPOSITE");
  assert.equal(normalizeCompositeRenderMode("FINAL"), null);
  assert.equal(normalizeCompositeRenderMode("anything"), null);
});

test("buildSmartFitCompositeRegion returns a valid centered region", () => {
  assert.deepEqual(buildSmartFitCompositeRegion(1000, 800), {
    x: 250,
    y: 150,
    width: 500,
    height: 500,
    rotationDeg: 0,
    imageWidth: 1000,
    imageHeight: 800,
  });
});

test("normalizeAppliesToColorIds validates against store colors", () => {
  assert.deepEqual(normalizeAppliesToColorIds([], new Set(["white", "black"])), []);
  assert.deepEqual(normalizeAppliesToColorIds(["black", "white", "black"], new Set(["white", "black"])), ["black", "white"]);
  assert.equal(normalizeAppliesToColorIds(["missing"], new Set(["white", "black"])), null);
});

test("chooseTemplateMockupsForColor uses exact matches before generic fallback", () => {
  const items = [
    { id: "generic", appliesToColorIds: [], isPrimary: false, sortOrder: 0, createdAt: new Date("2026-01-01") },
    { id: "exact", appliesToColorIds: ["white"], isPrimary: true, sortOrder: 5, createdAt: new Date("2026-01-02") },
  ];
  assert.deepEqual(chooseTemplateMockupsForColor(items, "white").map((item) => item.id), ["exact"]);
  assert.deepEqual(chooseTemplateMockupsForColor(items, "black").map((item) => item.id), ["generic"]);
});

test("resolveLibraryCompositeRegion uses draft override before library frame before smart fit", () => {
  const library = { x: 10, y: 20, width: 300, height: 300, rotationDeg: 0, imageWidth: 1000, imageHeight: 800 };
  const override = { x: 40, y: 50, width: 200, height: 200, rotationDeg: 5, imageWidth: 1000, imageHeight: 800 };
  assert.deepEqual(resolveLibraryCompositeRegion({ draftOverride: override, libraryRegion: library, imageWidth: 1000, imageHeight: 800 }), override);
  assert.deepEqual(resolveLibraryCompositeRegion({ draftOverride: null, libraryRegion: library, imageWidth: 1000, imageHeight: 800 }), library);
  assert.deepEqual(resolveLibraryCompositeRegion({ draftOverride: null, libraryRegion: null, imageWidth: 1000, imageHeight: 800 }), buildSmartFitCompositeRegion(1000, 800));
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/global-library.test.ts
```

Expected: FAIL because `src/lib/mockup/global-library.ts` does not exist.

- [ ] **Step 3: Implement helper module**

Create `src/lib/mockup/global-library.ts`:

```ts
import { normalizeCompositeRegionPx, type CompositeRegionPx } from "@/lib/mockup/custom-library";

export type CompositeRenderMode = "COMPOSITE";

export type TemplateMockupMatchItem = {
  id: string;
  appliesToColorIds: unknown;
  isPrimary: boolean;
  sortOrder: number;
  createdAt: Date;
};

export function normalizeCompositeRenderMode(value: unknown): CompositeRenderMode | null {
  if (value == null || value === "") return "COMPOSITE";
  return value === "COMPOSITE" ? "COMPOSITE" : null;
}

export function buildSmartFitCompositeRegion(imageWidth: number, imageHeight: number): CompositeRegionPx {
  const side = Math.max(1, Math.round(Math.min(imageWidth, imageHeight) * 0.625));
  return {
    x: Math.max(0, Math.round((imageWidth - side) / 2)),
    y: Math.max(0, Math.round((imageHeight - side) / 2)),
    width: side,
    height: side,
    rotationDeg: 0,
    imageWidth,
    imageHeight,
  };
}

export function normalizeAppliesToColorIds(value: unknown, validColorIds: Set<string>): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || !validColorIds.has(raw)) return null;
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

export function readAppliesToColorIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function chooseTemplateMockupsForColor<T extends TemplateMockupMatchItem>(items: T[], colorId: string): T[] {
  const sorted = [...items].sort(compareTemplateMockupItems);
  const exact = sorted.filter((item) => readAppliesToColorIds(item.appliesToColorIds).includes(colorId));
  if (exact.length > 0) return exact;
  return sorted.filter((item) => readAppliesToColorIds(item.appliesToColorIds).length === 0);
}

export function compareTemplateMockupItems(a: TemplateMockupMatchItem, b: TemplateMockupMatchItem): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const created = a.createdAt.getTime() - b.createdAt.getTime();
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}

export function resolveLibraryCompositeRegion(params: {
  draftOverride: unknown;
  libraryRegion: unknown;
  imageWidth: number;
  imageHeight: number;
}): CompositeRegionPx {
  return (
    normalizeCompositeRegionPx(params.draftOverride) ??
    normalizeCompositeRegionPx(params.libraryRegion) ??
    buildSmartFitCompositeRegion(params.imageWidth, params.imageHeight)
  );
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/global-library.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper module**

```bash
git add src/lib/mockup/global-library.ts src/lib/mockup/global-library.test.ts
git commit -m "feat: add global mockup library helpers"
```

---

### Task 4: Global Mockup API And Service

**Files:**
- Create: `src/lib/mockup/mockup-library-service.ts`
- Create: `src/app/api/mockups/route.ts`
- Create: `src/app/api/mockups/[mockupId]/route.ts`
- Create: `src/app/api/mockups/mockups-route-source.test.ts`

- [ ] **Step 1: Write route source tests**

Create `src/app/api/mockups/mockups-route-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listRoute = readFileSync("src/app/api/mockups/route.ts", "utf8");
const itemRoute = readFileSync("src/app/api/mockups/[mockupId]/route.ts", "utf8");

test("global mockup routes require mockup_library permission", () => {
  assert.match(listRoute, /requireFeature\(["']mockup_library["']\)/);
  assert.match(itemRoute, /requireFeature\(["']mockup_library["']\)/);
});

test("global mockup upload is COMPOSITE-only and stores upload metadata", () => {
  assert.match(listRoute, /normalizeCompositeRenderMode/);
  assert.match(listRoute, /uploadedById:\s*session\.id/);
  assert.match(listRoute, /mimeType:\s*file\.type/);
  assert.match(listRoute, /fileSizeBytes:\s*file\.size/);
  assert.doesNotMatch(listRoute, /FINAL/);
});

test("global mockup delete restricts template attachments and removes storage", () => {
  assert.match(itemRoute, /templateMockupItem\.count/);
  assert.match(itemRoute, /status:\s*409/);
  assert.match(itemRoute, /deleteMockupStorageObjects/);
});
```

- [ ] **Step 2: Run route source tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/mockups/mockups-route-source.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Create mockup library service**

Create `src/lib/mockup/mockup-library-service.ts` with these exported functions:

```ts
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildSmartFitCompositeRegion, normalizeCompositeRenderMode } from "@/lib/mockup/global-library";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";
import { getStorage } from "@/lib/storage/local-disk";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export class MockupLibraryValidationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "MockupLibraryValidationError";
  }
}

export async function createMockupLibraryItemFromUpload(input: {
  tenantId: string;
  uploadedById: string;
  file: File;
  name: string;
  view: "front" | "back" | "sleeve_left" | "sleeve_right" | "detail" | "lifestyle";
  sceneType: "flat_lay" | "hanging" | "lifestyle" | "model" | "detail";
  renderMode: unknown;
  compositeRegionPx: unknown;
}) {
  const renderMode = normalizeCompositeRenderMode(input.renderMode);
  if (renderMode !== "COMPOSITE") throw new MockupLibraryValidationError("renderMode must be COMPOSITE");
  if (!ALLOWED_TYPES.has(input.file.type)) throw new MockupLibraryValidationError("Only JPEG, PNG, and WebP images are supported");
  if (input.file.size > MAX_UPLOAD_BYTES) throw new MockupLibraryValidationError("File must be 10MB or smaller");

  const rawBuffer = Buffer.from(await input.file.arrayBuffer());
  const normalized = await sharp(rawBuffer).rotate().jpeg({ quality: 90 }).toBuffer();
  const metadata = await sharp(normalized).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) throw new MockupLibraryValidationError("Could not read image dimensions");

  const id = randomUUID();
  const storagePath = `mockups/library/${input.tenantId}/${id}-source.jpg`;
  await getStorage().putBuffer(storagePath, normalized, "image/jpeg");

  const region =
    normalizeCompositeRegionPx(input.compositeRegionPx) ??
    buildSmartFitCompositeRegion(width, height);

  return prisma.mockupLibraryItem.create({
    data: {
      id,
      tenantId: input.tenantId,
      name: input.name.trim() || "Untitled mockup",
      storagePath,
      previewPath: null,
      width,
      height,
      view: input.view,
      sceneType: input.sceneType,
      renderMode,
      compositeRegionPx: region as unknown as Prisma.InputJsonValue,
      uploadedById: input.uploadedById,
      mimeType: input.file.type,
      fileSizeBytes: input.file.size,
    },
  });
}

export async function deleteMockupStorageObjects(item: { storagePath: string; previewPath: string | null }) {
  const storage = getStorage();
  await storage.delete(item.storagePath);
  if (item.previewPath) {
    await storage.delete(item.previewPath);
  }
}
```

- [ ] **Step 4: Create `GET/POST /api/mockups`**

Create `src/app/api/mockups/route.ts` using top-level static imports:

```ts
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { storageUrl } from "@/lib/mockup/custom-library";
import {
  createMockupLibraryItemFromUpload,
  MockupLibraryValidationError,
} from "@/lib/mockup/mockup-library-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const view = url.searchParams.get("view")?.trim();
  const sceneType = url.searchParams.get("sceneType")?.trim();

  const items = await prisma.mockupLibraryItem.findMany({
    where: {
      tenantId: session.tenantId,
      isActive: true,
      deletedAt: null,
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      ...(view ? { view: view as never } : {}),
      ...(sceneType ? { sceneType: sceneType as never } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: { _count: { select: { templateItems: true } } },
  });

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      imageUrl: storageUrl(item.storagePath),
      previewUrl: storageUrl(item.previewPath),
      templateAttachmentCount: item._count.templateItems,
    })),
  });
}

export async function POST(request: Request) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const form = await request.formData();
  const file = form.get("file");
  if (!isFileLike(file)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  try {
    const item = await createMockupLibraryItemFromUpload({
      tenantId: session.tenantId,
      uploadedById: session.id,
      file,
      name: String(form.get("name") ?? ""),
      view: String(form.get("view") ?? "front") as never,
      sceneType: String(form.get("sceneType") ?? "flat_lay") as never,
      renderMode: form.get("renderMode"),
      compositeRegionPx: form.get("compositeRegionPx"),
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof MockupLibraryValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  return (
    !!value &&
    typeof value !== "string" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.type === "string" &&
    typeof value.size === "number"
  );
}
```

- [ ] **Step 5: Create `PATCH/DELETE /api/mockups/[mockupId]`**

Create `src/app/api/mockups/[mockupId]/route.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { normalizeCompositeRenderMode } from "@/lib/mockup/global-library";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";
import { deleteMockupStorageObjects } from "@/lib/mockup/mockup-library-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ mockupId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { mockupId } = await params;
  const body = await request.json();
  const existing = await prisma.mockupLibraryItem.findFirst({
    where: { id: mockupId, tenantId: session.tenantId, isActive: true, deletedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "Mockup not found" }, { status: 404 });

  const renderMode = body.renderMode === undefined ? undefined : normalizeCompositeRenderMode(body.renderMode);
  if (body.renderMode !== undefined && renderMode !== "COMPOSITE") {
    return NextResponse.json({ error: "renderMode must be COMPOSITE" }, { status: 400 });
  }

  const compositeRegionPx =
    body.compositeRegionPx === undefined
      ? undefined
      : normalizeCompositeRegionPx(body.compositeRegionPx);
  if (body.compositeRegionPx !== undefined && !compositeRegionPx) {
    return NextResponse.json({ error: "compositeRegionPx is invalid" }, { status: 400 });
  }

  const item = await prisma.mockupLibraryItem.update({
    where: { id: mockupId },
    data: {
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      view: body.view ?? undefined,
      sceneType: body.sceneType ?? undefined,
      renderMode,
      compositeRegionPx: compositeRegionPx === undefined ? undefined : compositeRegionPx as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json(item);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ mockupId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const { mockupId } = await params;
  const item = await prisma.mockupLibraryItem.findFirst({
    where: { id: mockupId, tenantId: session.tenantId, isActive: true, deletedAt: null },
  });
  if (!item) return NextResponse.json({ error: "Mockup not found" }, { status: 404 });

  const references = await prisma.templateMockupItem.count({ where: { mockupId } });
  if (references > 0) {
    return NextResponse.json({ error: "Mockup is attached to templates", references }, { status: 409 });
  }

  await deleteMockupStorageObjects(item);
  await prisma.mockupLibraryItem.delete({ where: { id: mockupId } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Run route tests and build typecheck**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/mockups/mockups-route-source.test.ts
npm run build
```

Expected: tests pass and build succeeds.

- [ ] **Step 7: Commit global mockup API**

```bash
git add src/lib/mockup/mockup-library-service.ts src/app/api/mockups/route.ts 'src/app/api/mockups/[mockupId]/route.ts' src/app/api/mockups/mockups-route-source.test.ts
git commit -m "feat: add global mockup library api"
```

---

### Task 5: Template Mockup Attachment APIs

**Files:**
- Create: `src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts`
- Create: `src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/[itemId]/route.ts`
- Create: `src/app/api/stores/template-mockups-route-source.test.ts`

- [ ] **Step 1: Write source guards for attachment API**

Create `src/app/api/stores/template-mockups-route-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listRoute = readFileSync("src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts", "utf8");
const itemRoute = readFileSync("src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/[itemId]/route.ts", "utf8");

test("template mockup attach routes are CUSTOM-only and tenant scoped", () => {
  assert.match(listRoute, /defaultMockupSource:\s*"CUSTOM"/);
  assert.match(listRoute, /tenantId:\s*session\.tenantId/);
  assert.match(listRoute, /normalizeAppliesToColorIds/);
});

test("template mockup attach creates duplicate conflict and single primary", () => {
  assert.match(listRoute, /templateMockupItem\.findUnique/);
  assert.match(listRoute, /status:\s*409/);
  assert.match(listRoute, /isPrimary/);
  assert.match(listRoute, /updateMany/);
});

test("template mockup update never edits composite region", () => {
  assert.match(itemRoute, /normalizeAppliesToColorIds/);
  assert.match(itemRoute, /templateMockupItem\.update/);
  assert.doesNotMatch(itemRoute, /compositeRegionPx/);
});
```

- [ ] **Step 2: Run source guards and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/template-mockups-route-source.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Create list/attach route**

Create `src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { normalizeAppliesToColorIds } from "@/lib/mockup/global-library";
import { storageUrl } from "@/lib/mockup/custom-library";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;
  const { id: storeId, templateId } = await params;
  const template = await loadCustomTemplate(session.tenantId, storeId, templateId);
  if (!template) return NextResponse.json({ error: "CUSTOM template not found" }, { status: 404 });

  const items = await prisma.templateMockupItem.findMany({
    where: { templateId },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: { mockup: true },
  });

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      mockup: {
        ...item.mockup,
        imageUrl: storageUrl(item.mockup.storagePath),
        previewUrl: storageUrl(item.mockup.previewPath),
      },
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;
  const { id: storeId, templateId } = await params;
  const template = await loadCustomTemplate(session.tenantId, storeId, templateId);
  if (!template) return NextResponse.json({ error: "CUSTOM template not found" }, { status: 404 });

  const body = await request.json();
  const mockupId = String(body.mockupId ?? "");
  const mockup = await prisma.mockupLibraryItem.findFirst({
    where: { id: mockupId, tenantId: session.tenantId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!mockup) return NextResponse.json({ error: "Mockup not found" }, { status: 404 });

  const validColorIds = new Set(template.store.colors.map((color) => color.id));
  const appliesToColorIds = normalizeAppliesToColorIds(body.appliesToColorIds ?? [], validColorIds);
  if (!appliesToColorIds) {
    return NextResponse.json({ error: "appliesToColorIds contains colors outside this store" }, { status: 400 });
  }

  const duplicate = await prisma.templateMockupItem.findUnique({
    where: { templateId_mockupId: { templateId, mockupId } },
    select: { id: true },
  });
  if (duplicate) {
    return NextResponse.json({ error: "Mockup is already attached to this template" }, { status: 409 });
  }

  const isPrimary = Boolean(body.isPrimary);
  const item = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.templateMockupItem.updateMany({ where: { templateId }, data: { isPrimary: false } });
    }
    return tx.templateMockupItem.create({
      data: {
        templateId,
        mockupId,
        appliesToColorIds,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        isPrimary,
      },
    });
  });

  return NextResponse.json(item, { status: 201 });
}

async function loadCustomTemplate(tenantId: string, storeId: string, templateId: string) {
  return prisma.storeMockupTemplate.findFirst({
    where: {
      id: templateId,
      storeId,
      defaultMockupSource: "CUSTOM",
      store: { tenantId, deletedAt: null },
    },
    include: {
      store: {
        select: { colors: { select: { id: true } } },
      },
    },
  });
}
```

- [ ] **Step 4: Create update/delete route**

Create `src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/[itemId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { normalizeAppliesToColorIds } from "@/lib/mockup/global-library";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string; itemId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;
  const { id: storeId, templateId, itemId } = await params;
  const context = await loadContext(session.tenantId, storeId, templateId, itemId);
  if (!context) return NextResponse.json({ error: "Template mockup item not found" }, { status: 404 });

  const body = await request.json();
  const validColorIds = new Set(context.template.store.colors.map((color) => color.id));
  const appliesToColorIds =
    body.appliesToColorIds === undefined
      ? undefined
      : normalizeAppliesToColorIds(body.appliesToColorIds, validColorIds);
  if (body.appliesToColorIds !== undefined && !appliesToColorIds) {
    return NextResponse.json({ error: "appliesToColorIds contains colors outside this store" }, { status: 400 });
  }

  const isPrimary = body.isPrimary === undefined ? undefined : Boolean(body.isPrimary);
  const item = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.templateMockupItem.updateMany({ where: { templateId, id: { not: itemId } }, data: { isPrimary: false } });
    }
    return tx.templateMockupItem.update({
      where: { id: itemId },
      data: {
        appliesToColorIds,
        sortOrder: body.sortOrder === undefined ? undefined : Number(body.sortOrder),
        isPrimary,
      },
    });
  });

  return NextResponse.json(item);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; templateId: string; itemId: string }> },
) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;
  const { id: storeId, templateId, itemId } = await params;
  const context = await loadContext(session.tenantId, storeId, templateId, itemId);
  if (!context) return NextResponse.json({ error: "Template mockup item not found" }, { status: 404 });

  const references = await prisma.wizardDraftMockupLibraryPick.count({ where: { templateMockupItemId: itemId } });
  if (references > 0) {
    return NextResponse.json({ error: "Mockup attachment is used by drafts", references }, { status: 409 });
  }
  await prisma.templateMockupItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}

async function loadContext(tenantId: string, storeId: string, templateId: string, itemId: string) {
  const item = await prisma.templateMockupItem.findFirst({
    where: {
      id: itemId,
      templateId,
      template: { id: templateId, storeId, defaultMockupSource: "CUSTOM", store: { tenantId, deletedAt: null } },
    },
    include: {
      template: {
        include: {
          store: { select: { colors: { select: { id: true } } } },
        },
      },
    },
  });
  return item ? { item, template: item.template } : null;
}
```

- [ ] **Step 5: Run attachment route source tests**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/template-mockups-route-source.test.ts
npm run build
```

Expected: tests pass and build succeeds.

- [ ] **Step 6: Commit template attachment API**

```bash
git add 'src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts' 'src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/[itemId]/route.ts' src/app/api/stores/template-mockups-route-source.test.ts
git commit -m "feat: add template mockup attachment api"
```

---

### Task 6: Global Mockups Page And Sidebar

**Files:**
- Create: `src/app/(authed)/mockups/page.tsx`
- Create: `src/components/mockup/GlobalMockupEditorModal.tsx`
- Modify: `src/app/(authed)/AuthedShell.tsx`
- Modify: `src/components/mockup/custom-mockup-ui-contract.test.ts`

- [ ] **Step 1: Update UI contract source tests**

In `src/components/mockup/custom-mockup-ui-contract.test.ts`, replace old store mockup library assertions with:

```ts
test("global mockups page owns composite frame editing", () => {
  const pageSource = read("src/app/(authed)/mockups/page.tsx");
  const modalSource = read("src/components/mockup/GlobalMockupEditorModal.tsx");

  assert.match(pageSource, /\/api\/mockups/);
  assert.match(pageSource, /edit=/);
  assert.match(modalSource, /CompositeRegionEditor/);
  assert.match(modalSource, /compositeRegionPx/);
});

test("store template editor does not edit mockup composite regions directly", () => {
  const configSource = read("src/app/(authed)/stores/[id]/config/page.tsx");

  assert.doesNotMatch(configSource, /CompositeRegionEditor/);
  assert.doesNotMatch(configSource, /defaultCompositeRegionPx/);
  assert.doesNotMatch(configSource, /onChangeCompositeRegion/);
  assert.match(configSource, /\/mockups\?edit=/);
});
```

- [ ] **Step 2: Run UI contract tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/components/mockup/custom-mockup-ui-contract.test.ts
```

Expected: FAIL because `/mockups` page/modal do not exist and config still imports `CompositeRegionEditor`.

- [ ] **Step 3: Add sidebar item**

In `src/app/(authed)/AuthedShell.tsx`, import `Image` from `lucide-react` if not already present and add:

```tsx
{ label: "Mockups", href: "/mockups", icon: <Image size={18} />, feature: "mockup_library" },
```

Place it under Workspace after `Designs`.

- [ ] **Step 4: Create global editor modal**

Create `src/components/mockup/GlobalMockupEditorModal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { CompositeRegionEditor, type CompositeRegion } from "@/components/mockup/CompositeRegionEditor";

export interface GlobalMockupEditorValue {
  id?: string;
  name: string;
  imageUrl: string | null;
  width: number;
  height: number;
  view: string;
  sceneType: string;
  compositeRegionPx: (CompositeRegion & { imageWidth: number; imageHeight: number }) | null;
}

export function GlobalMockupEditorModal({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  value: GlobalMockupEditorValue | null;
  onClose: () => void;
  onSave: (value: GlobalMockupEditorValue) => Promise<void>;
}) {
  const [draft, setDraft] = useState<GlobalMockupEditorValue | null>(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  if (!open || !draft) return null;

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="card" style={{ padding: 18, width: "min(960px, 96vw)", maxHeight: "90vh", overflow: "auto" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800 }}>Mockup frame</h2>
          <button className="btn btn-ghost" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <label style={{ display: "grid", gap: 6, marginBottom: 12, fontSize: "0.8rem", fontWeight: 700 }}>
          Name
          <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        {draft.imageUrl && draft.width > 0 && draft.height > 0 && (
          <CompositeRegionEditor
            imageUrl={draft.imageUrl}
            imageWidth={draft.width}
            imageHeight={draft.height}
            value={draft.compositeRegionPx}
            onChange={(region) => setDraft({
              ...draft,
              compositeRegionPx: { ...region, imageWidth: draft.width, imageHeight: draft.height },
            })}
            context="library"
            scope="TEMPLATE"
          />
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" size={14} /> : null} Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `/mockups` page**

Create `src/app/(authed)/mockups/page.tsx` with:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GlobalMockupEditorModal, type GlobalMockupEditorValue } from "@/components/mockup/GlobalMockupEditorModal";

interface MockupItem extends GlobalMockupEditorValue {
  templateAttachmentCount: number;
}

export default function MockupsPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<MockupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MockupItem | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/mockups");
      const data = await res.json();
      setItems((data.items ?? []).map((item: any) => ({
        id: item.id,
        name: item.name,
        imageUrl: item.imageUrl,
        width: item.width,
        height: item.height,
        view: item.view,
        sceneType: item.sceneType,
        compositeRegionPx: item.compositeRegionPx,
        templateAttachmentCount: item.templateAttachmentCount ?? 0,
      })));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (editId && items.length > 0) {
      setEditing(items.find((item) => item.id === editId) ?? null);
    }
  }, [items]);

  async function upload(file: File) {
    const form = new FormData();
    form.set("file", file);
    form.set("name", file.name.replace(/\.[^.]+$/, ""));
    form.set("view", "front");
    form.set("sceneType", "flat_lay");
    form.set("renderMode", "COMPOSITE");
    const res = await fetch("/api/mockups", { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Upload failed");
      return;
    }
    await load();
  }

  async function save(value: GlobalMockupEditorValue) {
    if (!value.id) return;
    const res = await fetch(`/api/mockups/${value.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: value.name,
        view: value.view,
        sceneType: value.sceneType,
        renderMode: "COMPOSITE",
        compositeRegionPx: value.compositeRegionPx,
      }),
    });
    if (!res.ok) throw new Error("Save failed");
    await load();
  }

  async function remove(item: MockupItem) {
    const res = await fetch(`/api/mockups/${item.id}`, { method: "DELETE" });
    if (res.status === 409) {
      toast.error("Mockup is attached to templates");
      return;
    }
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    await load();
  }

  const sortedItems = useMemo(() => [...items], [items]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Mockups</h1>
          <p className="page-subtitle">Global mockup library for this workspace.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => inputRef.current?.click()}>
          <ImagePlus size={16} /> Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {loading ? (
        <div className="flex justify-center" style={{ padding: 48 }}><Loader2 className="animate-spin" /></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {sortedItems.map((item) => (
            <article key={item.id} className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
              {item.imageUrl ? <img src={item.imageUrl} alt="" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "contain" }} /> : null}
              <strong>{item.name}</strong>
              <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>{item.width} x {item.height} · {item.view}</span>
              <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>{item.templateAttachmentCount} template attachments</span>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditing(item)}>Edit frame</button>
                <button className="btn btn-secondary btn-sm" type="button" disabled={item.templateAttachmentCount > 0} onClick={() => remove(item)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <GlobalMockupEditorModal open={Boolean(editing)} value={editing} onClose={() => setEditing(null)} onSave={save} />
    </div>
  );
}
```

- [ ] **Step 6: Run UI tests and build**

Run:

```bash
./node_modules/.bin/tsx --test src/components/mockup/custom-mockup-ui-contract.test.ts
npm run build
```

Expected: UI source tests pass and build includes `/mockups`.

- [ ] **Step 7: Commit global mockups UI**

```bash
git add 'src/app/(authed)/mockups/page.tsx' src/components/mockup/GlobalMockupEditorModal.tsx 'src/app/(authed)/AuthedShell.tsx' src/components/mockup/custom-mockup-ui-contract.test.ts
git commit -m "feat: add global mockups page"
```

---

### Task 7: Store Template Editor Rewire

**Files:**
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx`
- Create: `src/components/mockup/TemplateMockupPicker.tsx`
- Modify: `src/app/api/stores/mockup-templates-route-source.test.ts`
- Modify: `src/components/mockup/custom-mockup-ui-contract.test.ts`

- [ ] **Step 1: Update source guards for no direct frame editing**

Append to `src/components/mockup/custom-mockup-ui-contract.test.ts`:

```ts
test("template editor uses template mockup attachments and links global frame editor", () => {
  const configSource = read("src/app/(authed)/stores/[id]/config/page.tsx");
  const pickerSource = read("src/components/mockup/TemplateMockupPicker.tsx");

  assert.match(configSource, /TemplateMockupPicker/);
  assert.match(pickerSource, /mockup-templates\/\$\{templateId\}\/mockups/);
  assert.match(pickerSource, /\/mockups\?edit=\$\{item\.mockup\.id\}/);
  assert.doesNotMatch(configSource, /defaultCompositeRegionPx/);
  assert.doesNotMatch(configSource, /CompositeRegionEditor/);
});
```

Update `src/app/api/stores/mockup-templates-route-source.test.ts` to remove `defaultCompositeRegionPx` expectation and assert `mockupItems` is included in template detail responses:

```ts
test("mockup templates route no longer exposes template default composite region", () => {
  const source = readFileSync(join(process.cwd(), routePath), "utf8");
  assert.doesNotMatch(source, /defaultCompositeRegionPx/);
  assert.match(source, /mockupItems/);
});
```

- [ ] **Step 2: Run source guards and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/components/mockup/custom-mockup-ui-contract.test.ts src/app/api/stores/mockup-templates-route-source.test.ts
```

Expected: FAIL because config still imports `CompositeRegionEditor` and route still references `defaultCompositeRegionPx`.

- [ ] **Step 3: Create template mockup picker**

Create `src/components/mockup/TemplateMockupPicker.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface StoreColor {
  id: string;
  name: string;
  hex: string;
}

interface LibraryMockup {
  id: string;
  name: string;
  imageUrl: string | null;
  width: number;
  height: number;
}

interface TemplateMockupItem {
  id: string;
  appliesToColorIds: string[];
  isPrimary: boolean;
  sortOrder: number;
  mockup: LibraryMockup;
}

export function TemplateMockupPicker({
  storeId,
  templateId,
  colors,
}: {
  storeId: string;
  templateId: string;
  colors: StoreColor[];
}) {
  const [library, setLibrary] = useState<LibraryMockup[]>([]);
  const [items, setItems] = useState<TemplateMockupItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [libraryRes, itemsRes] = await Promise.all([
        fetch("/api/mockups"),
        fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups`),
      ]);
      const libraryData = await libraryRes.json();
      const itemsData = await itemsRes.json();
      setLibrary(libraryData.items ?? []);
      setItems(itemsData.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [storeId, templateId]);

  async function attach(mockupId: string) {
    const res = await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mockupId, appliesToColorIds: [], isPrimary: items.length === 0, sortOrder: items.length }),
    });
    if (res.status === 409) {
      toast.error("Mockup already attached");
      return;
    }
    if (!res.ok) {
      toast.error("Could not attach mockup");
      return;
    }
    await load();
  }

  async function update(item: TemplateMockupItem, patch: Partial<TemplateMockupItem>) {
    const res = await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) toast.error("Could not update mockup mapping");
    await load();
  }

  async function detach(item: TemplateMockupItem) {
    const res = await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups/${item.id}`, { method: "DELETE" });
    if (res.status === 409) {
      toast.error("Mockup is used by drafts");
      return;
    }
    if (!res.ok) toast.error("Could not detach mockup");
    await load();
  }

  if (loading) return <div style={{ padding: 24 }}><Loader2 className="animate-spin" /></div>;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Attached mockups</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <article key={item.id} style={{ display: "grid", gridTemplateColumns: "96px 1fr auto", gap: 12, alignItems: "center" }}>
              {item.mockup.imageUrl ? <img src={item.mockup.imageUrl} alt="" style={{ width: 96, height: 72, objectFit: "contain" }} /> : <div />}
              <div style={{ display: "grid", gap: 8 }}>
                <strong>{item.mockup.name}</strong>
                <select
                  value={item.appliesToColorIds.length === 0 ? "__all" : "__specific"}
                  onChange={(event) => update(item, { appliesToColorIds: event.target.value === "__all" ? [] : colors.map((color) => color.id) })}
                >
                  <option value="__all">All colors</option>
                  <option value="__specific">Specific colors</option>
                </select>
                {item.appliesToColorIds.length > 0 && (
                  <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                    {colors.map((color) => (
                      <label key={color.id} style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: "0.78rem" }}>
                        <input
                          type="checkbox"
                          checked={item.appliesToColorIds.includes(color.id)}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...item.appliesToColorIds, color.id]
                              : item.appliesToColorIds.filter((id) => id !== color.id);
                            update(item, { appliesToColorIds: next });
                          }}
                        />
                        {color.name}
                      </label>
                    ))}
                  </div>
                )}
                <a className="btn btn-secondary btn-sm" href={`/mockups?edit=${item.mockup.id}`}>Edit global frame</a>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={() => update(item, { isPrimary: true })}>Primary</button>
                <button className="btn btn-secondary btn-sm" onClick={() => detach(item)}><Trash2 size={13} /></button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Library</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {library.map((mockup) => (
            <button key={mockup.id} className="card" type="button" onClick={() => attach(mockup.id)} style={{ padding: 10, textAlign: "left" }}>
              {mockup.imageUrl ? <img src={mockup.imageUrl} alt="" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "contain" }} /> : null}
              <strong>{mockup.name}</strong>
              <span style={{ display: "block", fontSize: "0.74rem", color: "var(--text-muted)" }}>{mockup.width} x {mockup.height}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Rewire `config/page.tsx` CUSTOM Mockups tab**

In `src/app/(authed)/stores/[id]/config/page.tsx`:

- Remove imports of `CompositeRegionEditor` and `CompositeRegion`.
- Remove `TemplateCompositeRegion` type.
- Remove `defaultCompositeRegionPx` from `TemplateDetail`, `createEmptyTemplate()`, save payload, and `EditorMockupsStep` props.
- Replace `EditorMockupsStep` implementation with a wrapper around `TemplateMockupPicker`.

Use:

```tsx
import { TemplateMockupPicker } from "@/components/mockup/TemplateMockupPicker";
```

Render:

```tsx
{editorStep === "mockups" && showMockupStep && (
  <TemplateMockupPicker
    storeId={store.id}
    templateId={tempTemplateData.id}
    colors={tempTemplateData.colors.map((entry) => ({
      id: entry.color.id,
      name: entry.color.name,
      hex: entry.color.hex,
    }))}
  />
)}
```

For `tempTemplateData.id === "new"`, show a message and force save first:

```tsx
{tempTemplateData.id === "new" ? (
  <div className="card" style={{ padding: 18 }}>Save the template before attaching mockups.</div>
) : (
  <TemplateMockupPicker ... />
)}
```

- [ ] **Step 5: Update template routes to include attachments and remove default frame**

In `src/app/api/stores/[id]/mockup-templates/route.ts`, `src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts`, and `src/app/api/stores/[id]/wizard-config/route.ts`:

- Remove validation and payload handling for `defaultCompositeRegionPx`.
- Include `mockupItems` with `mockup` in GET responses where template detail is returned.
- Serialize mockup URL with `storageUrl`.

Use response shape:

```ts
mockupItems: template.mockupItems?.map((item) => ({
  id: item.id,
  appliesToColorIds: item.appliesToColorIds,
  sortOrder: item.sortOrder,
  isPrimary: item.isPrimary,
  mockup: {
    id: item.mockup.id,
    name: item.mockup.name,
    imageUrl: storageUrl(item.mockup.storagePath),
    width: item.mockup.width,
    height: item.mockup.height,
    view: item.mockup.view,
    sceneType: item.mockup.sceneType,
    renderMode: item.mockup.renderMode,
    compositeRegionPx: item.mockup.compositeRegionPx,
  },
}))
```

- [ ] **Step 6: Run UI and route source tests**

Run:

```bash
./node_modules/.bin/tsx --test src/components/mockup/custom-mockup-ui-contract.test.ts src/app/api/stores/mockup-templates-route-source.test.ts
npm run build
```

Expected: tests pass and build succeeds.

- [ ] **Step 7: Commit template editor rewire**

```bash
git add 'src/app/(authed)/stores/[id]/config/page.tsx' src/components/mockup/TemplateMockupPicker.tsx src/app/api/stores/mockup-templates-route-source.test.ts src/components/mockup/custom-mockup-ui-contract.test.ts 'src/app/api/stores/[id]/mockup-templates/route.ts' 'src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts' 'src/app/api/stores/[id]/wizard-config/route.ts'
git commit -m "feat: attach global mockups to custom templates"
```

---

### Task 8: Wizard Matching And Pick Rebuild

**Files:**
- Create: `src/lib/mockup/template-mockup-matching.ts`
- Create: `src/lib/mockup/template-mockup-matching.test.ts`
- Modify: `src/app/api/wizard/drafts/[id]/mockup-library-picks/route.ts`
- Modify: `src/app/api/wizard/drafts/[id]/route.ts` checklist builder module

- [ ] **Step 1: Write matching and rebuild tests**

Create `src/lib/mockup/template-mockup-matching.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTemplateMockupPickPlan,
  findMissingMockupColorIds,
} from "./template-mockup-matching";

const item = (id: string, appliesToColorIds: string[], sortOrder = 0, isPrimary = false) => ({
  id,
  appliesToColorIds,
  sortOrder,
  isPrimary,
  createdAt: new Date("2026-01-01"),
});

test("buildTemplateMockupPickPlan uses exact match instead of generic", () => {
  const plan = buildTemplateMockupPickPlan({
    selectedColorIds: ["white"],
    templateMockupItems: [item("generic", []), item("exact", ["white"], 2, true)],
    existingPicks: [],
  });
  assert.deepEqual(plan.create.map((entry) => [entry.templateMockupItemId, entry.colorId]), [["exact", "white"]]);
});

test("buildTemplateMockupPickPlan uses generic fallback when no exact match exists", () => {
  const plan = buildTemplateMockupPickPlan({
    selectedColorIds: ["black"],
    templateMockupItems: [item("generic", [])],
    existingPicks: [],
  });
  assert.deepEqual(plan.create.map((entry) => [entry.templateMockupItemId, entry.colorId]), [["generic", "black"]]);
});

test("findMissingMockupColorIds reports colors with no exact or generic mockup", () => {
  assert.deepEqual(findMissingMockupColorIds(["white"], [item("black-only", ["black"])]), ["white"]);
});

test("buildTemplateMockupPickPlan preserves overrides for unchanged keys and deletes stale picks", () => {
  const override = { x: 1, y: 2, width: 3, height: 4, rotationDeg: 0, imageWidth: 100, imageHeight: 100 };
  const plan = buildTemplateMockupPickPlan({
    selectedColorIds: ["white"],
    templateMockupItems: [item("exact", ["white"], 7, true)],
    existingPicks: [
      { id: "keep", templateMockupItemId: "exact", colorId: "white", compositeRegionPx: override },
      { id: "delete", templateMockupItemId: "old", colorId: "white", compositeRegionPx: null },
    ],
  });
  assert.deepEqual(plan.update, [{ id: "keep", sortOrder: 7, isPrimary: true, compositeRegionPx: override }]);
  assert.deepEqual(plan.deleteIds, ["delete"]);
});
```

- [ ] **Step 2: Run matching tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/template-mockup-matching.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement matching module**

Create `src/lib/mockup/template-mockup-matching.ts`:

```ts
import { chooseTemplateMockupsForColor, readAppliesToColorIds } from "@/lib/mockup/global-library";

export interface TemplateMockupForMatching {
  id: string;
  appliesToColorIds: unknown;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: Date;
}

export interface ExistingPickForMatching {
  id: string;
  templateMockupItemId: string;
  colorId: string;
  compositeRegionPx: unknown;
}

export function findMissingMockupColorIds(
  selectedColorIds: string[],
  templateMockupItems: TemplateMockupForMatching[],
): string[] {
  return selectedColorIds.filter((colorId) => chooseTemplateMockupsForColor(templateMockupItems, colorId).length === 0);
}

export function buildTemplateMockupPickPlan(params: {
  selectedColorIds: string[];
  templateMockupItems: TemplateMockupForMatching[];
  existingPicks: ExistingPickForMatching[];
}) {
  const existingByKey = new Map(params.existingPicks.map((pick) => [pickKey(pick.templateMockupItemId, pick.colorId), pick]));
  const desiredKeys = new Set<string>();
  const create: Array<{ templateMockupItemId: string; colorId: string; sortOrder: number; isPrimary: boolean }> = [];
  const update: Array<{ id: string; sortOrder: number; isPrimary: boolean; compositeRegionPx: unknown }> = [];

  for (const colorId of params.selectedColorIds) {
    const matches = chooseTemplateMockupsForColor(params.templateMockupItems, colorId);
    for (const match of matches) {
      const key = pickKey(match.id, colorId);
      desiredKeys.add(key);
      const existing = existingByKey.get(key);
      if (existing) {
        update.push({ id: existing.id, sortOrder: match.sortOrder, isPrimary: match.isPrimary, compositeRegionPx: existing.compositeRegionPx });
      } else {
        create.push({ templateMockupItemId: match.id, colorId, sortOrder: match.sortOrder, isPrimary: match.isPrimary });
      }
    }
  }

  const deleteIds = params.existingPicks
    .filter((pick) => !desiredKeys.has(pickKey(pick.templateMockupItemId, pick.colorId)))
    .map((pick) => pick.id);

  return { create, update, deleteIds };
}

function pickKey(templateMockupItemId: string, colorId: string): string {
  return `${templateMockupItemId}:${colorId}`;
}
```

- [ ] **Step 4: Rewire pick route**

In `src/app/api/wizard/drafts/[id]/mockup-library-picks/route.ts`:

- Request body accepts `templateMockupItemIds?: string[]`.
- Fetch draft with `templateId`, `enabledColorIds`, tenant.
- Fetch eligible `TemplateMockupItem` rows for draft template with joined mockup.
- Use `buildTemplateMockupPickPlan()`.
- Preserve existing `compositeRegionPx` for unchanged keys.
- Delete stale picks.
- Create missing picks.

Replace source validation with:

```ts
const templateMockupItems = await prisma.templateMockupItem.findMany({
  where: {
    id: { in: uniqueTemplateMockupItemIds },
    templateId: draft.templateId ?? "",
    template: { store: { tenantId: session.tenantId } },
    mockup: { renderMode: "COMPOSITE", isActive: true, deletedAt: null },
  },
  include: { mockup: true },
});
```

Transaction shape:

```ts
await tx.wizardDraftMockupLibraryPick.deleteMany({ where: { id: { in: plan.deleteIds } } });
for (const entry of plan.update) {
  await tx.wizardDraftMockupLibraryPick.update({
    where: { id: entry.id },
    data: { sortOrder: entry.sortOrder, isPrimary: entry.isPrimary },
  });
}
await tx.wizardDraftMockupLibraryPick.createMany({
  data: plan.create.map((entry) => ({
    draftId,
    templateMockupItemId: entry.templateMockupItemId,
    colorId: entry.colorId,
    sortOrder: entry.sortOrder,
    isPrimary: entry.isPrimary,
  })),
});
```

- [ ] **Step 5: Update checklist readiness**

In `src/app/api/wizard/drafts/[id]/checklist.ts` or the local checklist builder module:

- Fetch `template.mockupItems` with `mockup`.
- For CUSTOM template, call `findMissingMockupColorIds`.
- Checklist fails if any selected color lacks exact/generic valid COMPOSITE mockup.
- Valid means `mockup.renderMode === "COMPOSITE"` and `normalizeCompositeRegionPx(mockup.compositeRegionPx)` returns non-null.

Use error basis:

```ts
const validTemplateMockupItems = template.mockupItems.filter((item) =>
  item.mockup.renderMode === "COMPOSITE" &&
  normalizeCompositeRegionPx(item.mockup.compositeRegionPx)
);
const missingColorIds = findMissingMockupColorIds(draft.enabledColorIds ?? [], validTemplateMockupItems);
const mockupsMatchColors = missingColorIds.length === 0;
```

- [ ] **Step 6: Run matching tests and build**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/template-mockup-matching.test.ts
npm run build
```

Expected: tests pass and build succeeds.

- [ ] **Step 7: Commit wizard matching**

```bash
git add src/lib/mockup/template-mockup-matching.ts src/lib/mockup/template-mockup-matching.test.ts 'src/app/api/wizard/drafts/[id]/mockup-library-picks/route.ts' 'src/app/api/wizard/drafts/[id]/checklist.ts'
git commit -m "feat: match template mockups for wizard picks"
```

---

### Task 9: Generation And Worker Rewire

**Files:**
- Modify: `src/lib/mockup/generation.ts`
- Modify: `src/lib/mockup/worker.ts`
- Modify: `src/lib/mockup/printify-poll-worker.ts`
- Modify: `src/lib/mockup/custom-library.ts`
- Modify: `src/lib/mockup/custom-library-region.test.ts`

- [ ] **Step 1: Update effective region tests**

In `src/lib/mockup/custom-library-region.test.ts`, remove assertions for `templateDefaultRegion` and add source guards:

```ts
test("generation and worker use template mockup items instead of legacy custom sources", () => {
  const generation = readFileSync("src/lib/mockup/generation.ts", "utf8");
  const worker = readFileSync("src/lib/mockup/worker.ts", "utf8");

  assert.match(generation, /templateMockupItem/);
  assert.match(worker, /templateMockupItem/);
  assert.match(worker, /resolveLibraryCompositeRegion/);
  assert.doesNotMatch(generation, /customMockupSource/);
  assert.doesNotMatch(worker, /customMockupSource/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/custom-library-region.test.ts
```

Expected: FAIL because generation/worker still reference legacy sources.

- [ ] **Step 3: Rewire generation**

In `src/lib/mockup/generation.ts`:

- Replace `customMockupSource` queries with `templateMockupItem` queries.
- Include `mockup` and `picks`.
- Build mockup image rows from selected `WizardDraftMockupLibraryPick` rows.
- `sourceUrl` should encode a new URL format such as `mockup://library/${templateMockupItemId}/${colorId}`.
- `compositeUrl` stays job output URL.

Use query shape:

```ts
const picks = await prisma.wizardDraftMockupLibraryPick.findMany({
  where: { draftId },
  orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  include: {
    color: true,
    templateMockupItem: {
      include: { mockup: true },
    },
  },
});
```

- [ ] **Step 4: Rewire worker rendering**

In `src/lib/mockup/worker.ts`:

- Replace `CustomMockupSource` includes with `WizardDraftMockupLibraryPick -> TemplateMockupItem -> MockupLibraryItem`.
- Resolve source image from `pick.templateMockupItem.mockup.storagePath`.
- Resolve region with:

```ts
const effectiveRegion = resolveLibraryCompositeRegion({
  draftOverride: pick.compositeRegionPx,
  libraryRegion: pick.templateMockupItem.mockup.compositeRegionPx,
  imageWidth: pick.templateMockupItem.mockup.width,
  imageHeight: pick.templateMockupItem.mockup.height,
});
```

- Keep Smart Fit fallback only for render safety.
- Preserve `isBadCompositeRegion` guard only if it still makes sense with global mockup dimensions; otherwise move guard to readiness/checklist.

- [ ] **Step 5: Rewire poll worker and URL parsing**

In `src/lib/mockup/printify-poll-worker.ts` and `src/lib/mockup/source-url.ts`:

- Add parser support for `mockup://library/<templateMockupItemId>/<colorId>`.
- Remove legacy source/default region fallback reads.

Expected parser output:

```ts
{ kind: "library", templateMockupItemId, colorId }
```

- [ ] **Step 6: Run worker/generation tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/custom-library-region.test.ts src/lib/mockup/custom-library.test.ts src/lib/mockup/printify-poll-worker.test.ts src/lib/mockup/printify-poll-worker-custom.test.ts
npm run build
```

Expected: tests pass and build succeeds.

- [ ] **Step 7: Commit generation/worker rewire**

```bash
git add src/lib/mockup/generation.ts src/lib/mockup/worker.ts src/lib/mockup/printify-poll-worker.ts src/lib/mockup/source-url.ts src/lib/mockup/custom-library.ts src/lib/mockup/custom-library-region.test.ts
git commit -m "feat: render custom mockups from global library"
```

---

### Task 10: Remove Legacy Store Mockup Library Runtime

**Files:**
- Delete: `src/app/(authed)/stores/[id]/mockup-library/page.tsx`
- Delete: `src/app/api/stores/[id]/mockup-library/route.ts`
- Delete: `src/app/api/stores/[id]/mockup-library/[sourceId]/route.ts`
- Delete: `src/app/api/stores/mockup-library-route-source.test.ts`
- Modify: `src/components/mockup/WizardMockupSourcePanel.tsx`
- Modify: `src/components/mockup/ColorMockupCardGrid.tsx`
- Modify: `src/components/mockup/UploadMockupModal.tsx`
- Modify: `src/lib/mockup/custom-source-service.ts`

- [ ] **Step 1: Remove legacy route/page files**

Delete:

```bash
src/app/(authed)/stores/[id]/mockup-library/page.tsx
src/app/api/stores/[id]/mockup-library/route.ts
src/app/api/stores/[id]/mockup-library/[sourceId]/route.ts
src/app/api/stores/mockup-library-route-source.test.ts
```

- [ ] **Step 2: Replace legacy UI callers**

Run:

```bash
rg -n "/mockup-library|customMockupSource|CustomMockupSource|customMockupSources" src/components src/app src/lib
```

Apply these replacements:

- In `src/components/mockup/WizardMockupSourcePanel.tsx`, replace old source IDs with `templateMockupItemId` pick IDs and remove links to `/stores/${storeId}/mockup-library`.
- In `src/components/mockup/ColorMockupCardGrid.tsx`, use `WizardDraftMockupLibraryPick.templateMockupItemId` for selection/update payloads.
- In `src/components/mockup/UploadMockupModal.tsx`, remove legacy store-scoped upload code; global upload now lives in `/mockups` and `TemplateMockupPicker`.
- Delete `src/lib/mockup/custom-source-service.ts`; upload normalization and storage paths live in `src/lib/mockup/mockup-library-service.ts`.

- [ ] **Step 3: Add no-match source guard**

Create `src/lib/mockup/global-library-clean-break-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("runtime has no legacy custom mockup source or store mockup library paths", () => {
  let output = "";
  try {
    output = execFileSync("rg", [
      "-n",
      "CustomMockupSource|customMockupSource|customMockupSources|/mockup-library|defaultCompositeRegionPx",
      "src",
      "prisma/schema.prisma",
    ], { encoding: "utf8" });
  } catch (error: any) {
    if (error.status === 1) return;
    throw error;
  }
  assert.equal(output, "");
});
```

- [ ] **Step 4: Run no-match guard**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/global-library-clean-break-source.test.ts
```

Expected: PASS only after runtime and schema are clean.

- [ ] **Step 5: Commit legacy runtime removal**

```bash
git add -A src
git commit -m "feat: remove legacy store mockup library runtime"
```

---

### Task 11: Final Schema Drop Verification

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/migrations/20260618000000_global_mockup_library_clean_break/migration.sql`
- Modify: generated Prisma client if checked in by project tooling

- [ ] **Step 1: Run hard no-match gate over schema and runtime**

Run:

```bash
! rg -n "CustomMockupSource|customMockupSource|customMockupSources|/mockup-library|defaultCompositeRegionPx" src prisma/schema.prisma
```

Expected: no output, exit status `0`.

- [ ] **Step 2: Validate and generate Prisma**

Run:

```bash
npx prisma validate
npx prisma generate
```

Expected: schema valid and Prisma client generated successfully.

- [ ] **Step 3: Run schema/source tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/global-library-schema-source.test.ts src/lib/mockup/global-library-clean-break-source.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit schema cleanup if changed**

If Task 10 or Prisma generate changed files, commit them:

```bash
git add prisma/schema.prisma prisma/migrations/20260618000000_global_mockup_library_clean_break/migration.sql src/lib/mockup/global-library-clean-break-source.test.ts
git commit -m "feat: drop legacy custom mockup schema"
```

If there are no changes, do not create an empty commit.

---

### Task 12: Final Verification

**Files:**
- Verify all edited files.

- [ ] **Step 1: Run Prisma checks**

```bash
npx prisma validate
npx prisma generate
```

Expected: both pass.

- [ ] **Step 2: Run focused tests**

```bash
./node_modules/.bin/tsx --test src/lib/mockup/global-library.test.ts
./node_modules/.bin/tsx --test src/lib/mockup/template-mockup-matching.test.ts
./node_modules/.bin/tsx --test src/lib/mockup/global-library-schema-source.test.ts
./node_modules/.bin/tsx --test src/lib/mockup/global-library-clean-break-source.test.ts
./node_modules/.bin/tsx --test src/app/api/mockups/mockups-route-source.test.ts
./node_modules/.bin/tsx --test src/app/api/stores/template-mockups-route-source.test.ts
./node_modules/.bin/tsx --test src/components/mockup/custom-mockup-ui-contract.test.ts
./node_modules/.bin/tsx --test src/lib/mockup/custom-library-region.test.ts
./node_modules/.bin/tsx --test src/lib/placement/views.test.ts
./node_modules/.bin/tsx --test src/lib/placement/resolver.test.ts
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run legacy no-match gate**

```bash
! rg -n "CustomMockupSource|customMockupSource|customMockupSources|/mockup-library|defaultCompositeRegionPx" src prisma/schema.prisma
```

Expected: no output, exit status `0`.

- [ ] **Step 4: Run build and route checks**

```bash
npm run build
```

Expected:

- build passes
- route list includes `/mockups`
- route list includes `/api/mockups`
- route list does not include `/stores/[id]/mockup-library`
- route list does not include `/api/stores/[id]/mockup-library`

- [ ] **Step 5: Check diff hygiene**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Status is clean if all task commits were made.

- [ ] **Step 6: Manual browser checks**

Start dev server:

```bash
npm run dev
```

Manual flows:

- Sidebar shows `Mockups` under Workspace for a user with `mockup_library`.
- `/mockups` uploads a mockup and auto-generates Smart Fit frame.
- `/mockups?edit=<mockupId>` opens the frame editor.
- Editing a global frame updates future non-overridden renders.
- Delete is disabled or returns `409` when attached.
- CUSTOM template selects existing library mockups.
- CUSTOM template upload creates library item first, then attaches it.
- CUSTOM template maps mockups to all colors or specific colors.
- CUSTOM template does not expose frame editing directly.
- PRINTIFY template still shows Placement and no Mockups tab.
- Wizard CUSTOM draft inherits matching template mockups by exact color first, generic fallback second.
- Checklist fails when a selected color has no exact or generic valid COMPOSITE mockup.
- Publish/render uses library frame unless draft override exists.

- [ ] **Step 7: Confirm no uncommitted verification changes**

```bash
git status --short
```

Expected: no output because each task committed its own changes. If output appears, inspect those files before deciding whether they belong to the current implementation.
