# Template Pricing and Composite Region Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move retail pricing and CUSTOM mockup default composite regions into `StoreMockupTemplate`, while preserving draft overrides and PRINTIFY placement.

**Architecture:** Add nullable template fields in Prisma, centralize pricing resolution in `src/lib/pricing/template-pricing.ts`, and extend the existing composite region helper so API, worker, and UI paths share one precedence contract. Template editor writes template defaults; wizard and publish paths read those defaults and only snapshot where the draft selection requires stable behavior.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, Node test runner with `tsx --test`, existing mockup and placement helpers.

---

## File Structure

- Create: `src/lib/pricing/template-pricing.ts` - normalize money, normalize template per-size defaults, resolve base/per-size prices for UI and publish.
- Create: `src/lib/pricing/template-pricing.test.ts` - unit tests for positive finite rounding and pricing priority.
- Modify: `prisma/schema.prisma` - add three nullable `StoreMockupTemplate` fields with `Decimal` for base price.
- Create: `prisma/migrations/20260617000000_template_pricing_composite_region/migration.sql` - add nullable columns.
- Modify: `src/lib/stores/store-service.ts` - create, update, duplicate, and serialize template fields.
- Modify: `src/app/api/stores/[id]/mockup-templates/route.ts` - GET/POST support for new fields.
- Modify: `src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts` - PATCH support for new fields.
- Modify: `src/app/api/stores/[id]/wizard-config/route.ts` - return new fields for wizard consumers.
- Modify: `src/app/api/stores/mockup-templates-route-source.test.ts` - source-level guard for route response fields.
- Modify: `src/lib/mockup/custom-library.ts` - add runtime scaling helper and extend effective region resolver.
- Modify: `src/lib/mockup/custom-library-region.test.ts` - unit tests for region priority and scaling.
- Modify: `src/lib/mockup/generation.ts` - include template default region in readiness checks.
- Modify: `src/lib/mockup/worker.ts` - include template default region in render-time resolution.
- Modify: `src/lib/mockup/printify-poll-worker.ts` - include template default region where custom composite sources are resolved.
- Modify: `src/app/api/wizard/drafts/[id]/mockup-sources/route.ts` - return effective template default region.
- Modify: `src/app/api/wizard/drafts/[id]/mockup-library-picks/route.ts` - snapshot template default into new picks only when pick/source have no region.
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx` - editor tab order, pricing tab, save payload, mockup region editor.
- Modify: `src/app/(authed)/wizard/[draftId]/layout.tsx` - load Step 5 with `expand=sizes` only.
- Modify: `src/app/(authed)/wizard/[draftId]/step-5/page.tsx` - use template pricing defaults and remove admin pricing fetch.
- Modify: `src/lib/wizard/use-wizard-store.ts` - remove expanded pricing state and add template pricing fields to `DraftData.template`.
- Modify: `src/app/api/wizard/drafts/[id]/route.ts` - remove `expand=pricing` branch, keep `expand=sizes`.
- Modify: `src/app/api/wizard/drafts/[id]/publish/route.ts` - resolve price from template/store fallback.
- Modify: `src/lib/publish/worker.ts` - use shared pricing resolver for Printify and Shopify variant payloads.
- Delete: `src/app/(authed)/admin/pricing/page.tsx`.
- Delete: `src/app/api/admin/pricing-templates/route.ts`.
- Modify: `src/app/(authed)/AuthedShell.tsx` - remove Pricing sidebar item.
- Modify: `src/app/(authed)/admin/acl/AclClient.tsx` - remove `pricing` feature key.

---

### Task 1: Schema And Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260617000000_template_pricing_composite_region/migration.sql`

- [ ] **Step 1: Add nullable fields to `StoreMockupTemplate`**

Insert these fields after `defaultMockupSource`:

```prisma
  basePriceUsd             Decimal? @map("base_price_usd") @db.Decimal(10, 2)
  priceBySizeDefault       Json?    @map("price_by_size_default")
  defaultCompositeRegionPx Json?    @map("default_composite_region_px")
```

- [ ] **Step 2: Add migration SQL**

Create `prisma/migrations/20260617000000_template_pricing_composite_region/migration.sql`:

```sql
ALTER TABLE "store_mockup_templates"
  ADD COLUMN "base_price_usd" DECIMAL(10, 2),
  ADD COLUMN "price_by_size_default" JSONB,
  ADD COLUMN "default_composite_region_px" JSONB;
```

- [ ] **Step 3: Validate Prisma schema**

Run:

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 4: Commit schema change**

```bash
git add prisma/schema.prisma prisma/migrations/20260617000000_template_pricing_composite_region/migration.sql
git commit -m "feat: add template pricing and composite defaults schema"
```

---

### Task 2: Shared Pricing Resolver

**Files:**
- Create: `src/lib/pricing/template-pricing.ts`
- Create: `src/lib/pricing/template-pricing.test.ts`

- [ ] **Step 1: Write failing pricing resolver tests**

Create `src/lib/pricing/template-pricing.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMoneyValue,
  normalizePriceBySizeDefault,
  resolveBaseTemplatePrice,
  resolvePriceForSize,
} from "./template-pricing";

test("normalizeMoneyValue accepts positive finite values rounded to two decimals", () => {
  assert.equal(normalizeMoneyValue(24.999), 25);
  assert.equal(normalizeMoneyValue("27.994"), 27.99);
  assert.equal(normalizeMoneyValue("27.995"), 28);
});

test("normalizeMoneyValue rejects empty, zero, negative, and non-finite values", () => {
  assert.equal(normalizeMoneyValue(null), null);
  assert.equal(normalizeMoneyValue(""), null);
  assert.equal(normalizeMoneyValue(0), null);
  assert.equal(normalizeMoneyValue(-1), null);
  assert.equal(normalizeMoneyValue(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizeMoneyValue("abc"), null);
});

test("normalizePriceBySizeDefault trims keys and rounds values", () => {
  assert.deepEqual(normalizePriceBySizeDefault({ " 2XL ": 27.995, "3XL": "29.994" }), {
    "2XL": 28,
    "3XL": 29.99,
  });
});

test("normalizePriceBySizeDefault returns null for invalid maps", () => {
  assert.equal(normalizePriceBySizeDefault(null), null);
  assert.equal(normalizePriceBySizeDefault({ "": 24.99 }), null);
  assert.equal(normalizePriceBySizeDefault({ XL: 0 }), null);
  assert.equal(normalizePriceBySizeDefault(["XL"]), null);
});

test("resolveBaseTemplatePrice uses template base before store default and fallback", () => {
  assert.equal(resolveBaseTemplatePrice({ templateBasePriceUsd: 25.5, storeDefaultPriceUsd: 30 }), 25.5);
  assert.equal(resolveBaseTemplatePrice({ templateBasePriceUsd: null, storeDefaultPriceUsd: "30.995" }), 31);
  assert.equal(resolveBaseTemplatePrice({ templateBasePriceUsd: null, storeDefaultPriceUsd: null }), 24.99);
});

test("resolvePriceForSize uses draft override before template per-size before base", () => {
  const params = {
    size: "2XL",
    draftPriceBySizeOverride: { "2XL": 31.111 },
    templatePriceBySizeDefault: { "2XL": 29.999 },
    templateBasePriceUsd: 24.99,
    storeDefaultPriceUsd: 21.99,
  };

  assert.equal(resolvePriceForSize(params), 31.11);
  assert.equal(resolvePriceForSize({ ...params, draftPriceBySizeOverride: null }), 30);
  assert.equal(
    resolvePriceForSize({
      ...params,
      draftPriceBySizeOverride: null,
      templatePriceBySizeDefault: null,
    }),
    24.99,
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/pricing/template-pricing.test.ts
```

Expected: FAIL because `src/lib/pricing/template-pricing.ts` does not exist.

- [ ] **Step 3: Create pricing helper**

Create `src/lib/pricing/template-pricing.ts`:

```ts
export const FALLBACK_TEMPLATE_PRICE_USD = 24.99;

export type PriceMap = Record<string, number>;

function toNumberish(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return null;
}

export function normalizeMoneyValue(value: unknown): number | null {
  const parsed = toNumberish(value);
  if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

export function normalizePriceBySizeDefault(value: unknown): PriceMap | null {
  if (value == null) return null;
  if (Array.isArray(value) || typeof value !== "object") return null;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;

  const normalized: PriceMap = {};
  for (const [rawSize, rawPrice] of entries) {
    const size = rawSize.trim();
    if (!size) return null;
    const price = normalizeMoneyValue(rawPrice);
    if (price == null) return null;
    normalized[size] = price;
  }
  return normalized;
}

export function resolveBaseTemplatePrice(params: {
  templateBasePriceUsd: unknown;
  storeDefaultPriceUsd: unknown;
}): number {
  return (
    normalizeMoneyValue(params.templateBasePriceUsd) ??
    normalizeMoneyValue(params.storeDefaultPriceUsd) ??
    FALLBACK_TEMPLATE_PRICE_USD
  );
}

export function resolvePriceForSize(params: {
  size: string;
  draftPriceBySizeOverride: unknown;
  templatePriceBySizeDefault: unknown;
  templateBasePriceUsd: unknown;
  storeDefaultPriceUsd: unknown;
}): number {
  const draftMap = normalizePriceBySizeDefault(params.draftPriceBySizeOverride);
  const templateMap = normalizePriceBySizeDefault(params.templatePriceBySizeDefault);
  return (
    draftMap?.[params.size] ??
    templateMap?.[params.size] ??
    resolveBaseTemplatePrice({
      templateBasePriceUsd: params.templateBasePriceUsd,
      storeDefaultPriceUsd: params.storeDefaultPriceUsd,
    })
  );
}

export function mergeDraftAndTemplatePriceMaps(params: {
  draftPriceBySizeOverride: unknown;
  templatePriceBySizeDefault: unknown;
}): PriceMap | null {
  const templateMap = normalizePriceBySizeDefault(params.templatePriceBySizeDefault) ?? {};
  const draftMap = normalizePriceBySizeDefault(params.draftPriceBySizeOverride) ?? {};
  const merged = { ...templateMap, ...draftMap };
  return Object.keys(merged).length > 0 ? merged : null;
}
```

- [ ] **Step 4: Run pricing tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/pricing/template-pricing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit pricing helper**

```bash
git add src/lib/pricing/template-pricing.ts src/lib/pricing/template-pricing.test.ts
git commit -m "feat: add template pricing resolver"
```

---

### Task 3: Template API And Service Persistence

**Files:**
- Modify: `src/lib/stores/store-service.ts`
- Modify: `src/app/api/stores/[id]/mockup-templates/route.ts`
- Modify: `src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts`
- Modify: `src/app/api/stores/[id]/wizard-config/route.ts`
- Modify: `src/app/api/stores/mockup-templates-route-source.test.ts`

- [ ] **Step 1: Add source guard test for field coverage**

Append to `src/app/api/stores/mockup-templates-route-source.test.ts`:

```ts
test("mockup templates route includes template pricing and composite defaults", () => {
  const source = readFileSync(join(process.cwd(), routePath), "utf8");

  assert.match(source, /basePriceUsd/);
  assert.match(source, /priceBySizeDefault/);
  assert.match(source, /defaultCompositeRegionPx/);
});
```

- [ ] **Step 2: Run source test and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/mockup-templates-route-source.test.ts
```

Expected: FAIL because route source does not mention the new fields yet.

- [ ] **Step 3: Extend `store-service.ts` template input types**

Add imports:

```ts
import {
  normalizeMoneyValue,
  normalizePriceBySizeDefault,
} from "@/lib/pricing/template-pricing";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";
```

Add these fields to create and update data types:

```ts
    basePriceUsd?: number | string | null;
    priceBySizeDefault?: Record<string, unknown> | null;
    defaultCompositeRegionPx?: unknown;
```

- [ ] **Step 4: Persist normalized fields in create/update**

In `createTemplate()`, add to `data`:

```ts
        basePriceUsd: normalizeMoneyValue(data.basePriceUsd) ?? null,
        priceBySizeDefault:
          normalizePriceBySizeDefault(data.priceBySizeDefault) ?? undefined,
        defaultCompositeRegionPx:
          normalizeCompositeRegionPx(data.defaultCompositeRegionPx) ?? undefined,
```

In `updateTemplate()`, add to `data`:

```ts
        basePriceUsd:
          data.basePriceUsd === undefined
            ? undefined
            : normalizeMoneyValue(data.basePriceUsd),
        priceBySizeDefault:
          data.priceBySizeDefault === undefined
            ? undefined
            : normalizePriceBySizeDefault(data.priceBySizeDefault) ?? Prisma.DbNull,
        defaultCompositeRegionPx:
          data.defaultCompositeRegionPx === undefined
            ? undefined
            : normalizeCompositeRegionPx(data.defaultCompositeRegionPx) ?? Prisma.DbNull,
```

For `basePriceUsd`, keep `null` for clear/reset and reject invalid values in route validation before this service is called.

- [ ] **Step 5: Copy new fields in duplicate**

In `duplicateTemplate()`, add to the created copy:

```ts
        basePriceUsd: original.basePriceUsd,
        priceBySizeDefault: original.priceBySizeDefault ?? undefined,
        defaultCompositeRegionPx: original.defaultCompositeRegionPx ?? undefined,
        defaultMockupSource: original.defaultMockupSource,
```

- [ ] **Step 6: Validate request bodies in template routes**

In `src/app/api/stores/[id]/mockup-templates/route.ts` and `[templateId]/route.ts`, import helpers:

```ts
import { normalizeMoneyValue, normalizePriceBySizeDefault } from "@/lib/pricing/template-pricing";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";
```

Before calling `createTemplate()` or `updateTemplate()`, validate when fields are present:

```ts
  if (body.basePriceUsd != null && normalizeMoneyValue(body.basePriceUsd) == null) {
    return NextResponse.json({ error: "basePriceUsd must be a positive finite number" }, { status: 400 });
  }
  if (body.priceBySizeDefault != null && normalizePriceBySizeDefault(body.priceBySizeDefault) == null) {
    return NextResponse.json({ error: "priceBySizeDefault must be { sizeName: positivePrice }" }, { status: 400 });
  }
  if (body.defaultCompositeRegionPx != null && normalizeCompositeRegionPx(body.defaultCompositeRegionPx) == null) {
    return NextResponse.json({ error: "defaultCompositeRegionPx is invalid" }, { status: 400 });
  }
```

Pass normalized-safe field names through:

```ts
    basePriceUsd: body.basePriceUsd ?? null,
    priceBySizeDefault: body.priceBySizeDefault ?? null,
    defaultCompositeRegionPx: body.defaultCompositeRegionPx ?? null,
```

- [ ] **Step 7: Return fields from template list and wizard config**

In both GET response mappers, add:

```ts
      basePriceUsd: template.basePriceUsd ? Number(template.basePriceUsd) : null,
      priceBySizeDefault: template.priceBySizeDefault ?? null,
      defaultCompositeRegionPx: template.defaultCompositeRegionPx ?? null,
```

- [ ] **Step 8: Run route source and Prisma checks**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/mockup-templates-route-source.test.ts
npx prisma validate
```

Expected: both pass.

- [ ] **Step 9: Commit template API persistence**

```bash
git add src/lib/stores/store-service.ts 'src/app/api/stores/[id]/mockup-templates/route.ts' 'src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts' 'src/app/api/stores/[id]/wizard-config/route.ts' src/app/api/stores/mockup-templates-route-source.test.ts
git commit -m "feat: persist template pricing defaults"
```

---

### Task 4: Composite Region Runtime Scaling And Snapshot Picks

**Files:**
- Modify: `src/lib/mockup/custom-library.ts`
- Modify: `src/lib/mockup/custom-library-region.test.ts`
- Modify: `src/lib/mockup/generation.ts`
- Modify: `src/lib/mockup/worker.ts`
- Modify: `src/lib/mockup/printify-poll-worker.ts`
- Modify: `src/app/api/wizard/drafts/[id]/mockup-sources/route.ts`
- Modify: `src/app/api/wizard/drafts/[id]/mockup-library-picks/route.ts`

- [ ] **Step 1: Add resolver and scaling tests**

Append to `src/lib/mockup/custom-library-region.test.ts`:

```ts
import {
  resolveEffectiveCompositeRegion,
  scaleCompositeRegionToImage,
} from "./custom-library";

test("resolveEffectiveCompositeRegion uses pick before source before template default", () => {
  const templateDefault = { x: 10, y: 10, width: 100, height: 100, rotationDeg: 0, imageWidth: 1000, imageHeight: 1000 };
  const sourceRegion = { x: 20, y: 20, width: 110, height: 110, rotationDeg: 0, imageWidth: 1000, imageHeight: 1000 };
  const pickRegion = { x: 30, y: 30, width: 120, height: 120, rotationDeg: 0, imageWidth: 1000, imageHeight: 1000 };

  assert.deepEqual(
    resolveEffectiveCompositeRegion({
      scope: "TEMPLATE",
      sourceRegion,
      pickRegion,
      templateDefaultRegion: templateDefault,
    }),
    pickRegion,
  );

  assert.deepEqual(
    resolveEffectiveCompositeRegion({
      scope: "TEMPLATE",
      sourceRegion: null,
      pickRegion: null,
      templateDefaultRegion: templateDefault,
    }),
    templateDefault,
  );
});

test("scaleCompositeRegionToImage scales runtime region without mutating saved default", () => {
  const saved = { x: 100, y: 50, width: 300, height: 200, rotationDeg: 7, imageWidth: 1000, imageHeight: 500 };
  const scaled = scaleCompositeRegionToImage(saved, 2000, 1000);

  assert.deepEqual(scaled, { x: 200, y: 100, width: 600, height: 400, rotationDeg: 7, imageWidth: 2000, imageHeight: 1000 });
  assert.deepEqual(saved, { x: 100, y: 50, width: 300, height: 200, rotationDeg: 7, imageWidth: 1000, imageHeight: 500 });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/custom-library-region.test.ts
```

Expected: FAIL because `scaleCompositeRegionToImage` and the new resolver parameter do not exist.

- [ ] **Step 3: Extend `custom-library.ts`**

Update the resolver signature and add runtime scaling:

```ts
export function scaleCompositeRegionToImage(
  region: CompositeRegionPx,
  imageWidth: number,
  imageHeight: number,
): CompositeRegionPx {
  if (
    !region.imageWidth ||
    !region.imageHeight ||
    region.imageWidth === imageWidth &&
      region.imageHeight === imageHeight
  ) {
    return { ...region, imageWidth, imageHeight };
  }

  const scaleX = imageWidth / region.imageWidth;
  const scaleY = imageHeight / region.imageHeight;
  return {
    x: Math.round(region.x * scaleX),
    y: Math.round(region.y * scaleY),
    width: Math.max(1, Math.round(region.width * scaleX)),
    height: Math.max(1, Math.round(region.height * scaleY)),
    rotationDeg: region.rotationDeg,
    imageWidth,
    imageHeight,
  };
}

export function resolveEffectiveCompositeRegion(params: {
  scope: "DRAFT" | "TEMPLATE";
  sourceRegion: unknown;
  pickRegion: unknown;
  templateDefaultRegion?: unknown;
  imageSize?: { width: number; height: number };
}): CompositeRegionPx | null {
  const parsedSource = parseCompositeRegionPx(params.sourceRegion);
  const parsedPick = parseCompositeRegionPx(params.pickRegion);
  const parsedTemplateDefault = parseCompositeRegionPx(params.templateDefaultRegion);

  const resolved =
    params.scope === "DRAFT"
      ? parsedSource ?? parsedPick ?? parsedTemplateDefault
      : parsedPick ?? parsedSource ?? parsedTemplateDefault;

  if (!resolved || !params.imageSize) return resolved;
  return scaleCompositeRegionToImage(resolved, params.imageSize.width, params.imageSize.height);
}
```

This scales only the runtime value returned by the helper. It does not mutate or persist `StoreMockupTemplate.defaultCompositeRegionPx`.

- [ ] **Step 4: Pass template default into all composite readers**

For each resolver call in `mockup-sources/route.ts`, `generation.ts`, `worker.ts`, and `printify-poll-worker.ts`, fetch or select `template.defaultCompositeRegionPx` and pass:

```ts
      templateDefaultRegion: source.template?.defaultCompositeRegionPx ?? draft.template?.defaultCompositeRegionPx ?? null,
```

When the current image dimensions are known, also pass:

```ts
      imageSize: { width: imgW, height: imgH },
```

- [ ] **Step 5: Snapshot template default when creating wizard picks**

In `src/app/api/wizard/drafts/[id]/mockup-library-picks/route.ts`, select template default:

```ts
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    select: {
      id: true,
      templateId: true,
      enabledColorIds: true,
      template: { select: { defaultCompositeRegionPx: true } },
    },
  });
```

Select source region:

```ts
    select: { id: true, colorId: true, compositeRegionPx: true },
```

Set pick region with snapshot behavior:

```ts
        const compositeRegionPx =
          normalizedPlacements.get(sourceId) ??
          existingPlacementBySourceId.get(sourceId) ??
          source.compositeRegionPx ??
          draft.template?.defaultCompositeRegionPx ??
          null;
```

This copies the template default only at pick creation/replacement time. If the template default changes later, existing draft picks keep their snapshot until the user reselects or overrides mockups.

- [ ] **Step 6: Run composite tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/custom-library-region.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit composite resolver changes**

```bash
git add src/lib/mockup/custom-library.ts src/lib/mockup/custom-library-region.test.ts src/lib/mockup/generation.ts src/lib/mockup/worker.ts src/lib/mockup/printify-poll-worker.ts 'src/app/api/wizard/drafts/[id]/mockup-sources/route.ts' 'src/app/api/wizard/drafts/[id]/mockup-library-picks/route.ts'
git commit -m "feat: inherit template composite regions"
```

---

### Task 5: Template Editor UI

**Files:**
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx`

- [ ] **Step 1: Update client types and empty template**

Add fields to `TemplateDetail`:

```ts
basePriceUsd: number | null;
priceBySizeDefault: Record<string, number> | null;
defaultCompositeRegionPx: CompositeRegion | null;
```

Add default values in `createEmptyTemplate()`:

```ts
basePriceUsd: null,
priceBySizeDefault: null,
defaultCompositeRegionPx: null,
```

- [ ] **Step 2: Update save payload**

In `handleSaveTemplate()`, include:

```ts
basePriceUsd: tempTemplateData.basePriceUsd,
priceBySizeDefault: tempTemplateData.priceBySizeDefault,
defaultCompositeRegionPx: tempTemplateData.defaultCompositeRegionPx,
```

- [ ] **Step 3: Update tabs**

Replace the editor step list with:

```ts
const editorSteps: EditorStep[] = showMockupStep
  ? ["blueprint", "variants", "mockups", "pricing"]
  : ["blueprint", "variants", "placement", "pricing"];
```

Add the label:

```ts
pricing: "Giá bán",
```

Render placement only for PRINTIFY:

```tsx
{editorStep === "placement" && !showMockupStep && (
  <EditorPlacementStep
    value={tempTemplateData}
    onChange={(data) => setTempTemplateData((current) => current ? { ...current, ...data } : current)}
  />
)}
```

- [ ] **Step 4: Add `EditorPricingStep`**

Add a component in the same file near other editor step components:

```tsx
function EditorPricingStep({
  store,
  value,
  onChange,
}: {
  store: StoreDetail;
  value: TemplateDetail;
  onChange: (data: Partial<TemplateDetail>) => void;
}) {
  const [sizes, setSizes] = useState<Array<{ size: string; minCostUsd?: number; costUsd?: number }>>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/stores/${store.id}/sizes`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data.sizes)) setSizes(data.sizes);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [store.id]);

  const basePrice = value.basePriceUsd ?? Number(store.defaultPriceUsd ?? 24.99);
  const priceBySizeDefault = value.priceBySizeDefault ?? {};

  return (
    <div className="space-y-4">
      <label className="form-field">
        <span>Giá bán cơ bản</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={value.basePriceUsd ?? ""}
          onChange={(event) => {
            const next = event.target.value.trim();
            onChange({ basePriceUsd: next ? Number(next) : null });
          }}
        />
      </label>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th>Size</th>
            <th>Cost Printify</th>
            <th>Giá bán</th>
            <th>Chênh lệch</th>
          </tr>
        </thead>
        <tbody>
          {sizes.map((size) => {
            const cost = Number(size.costUsd ?? size.minCostUsd ?? 0);
            const retail = priceBySizeDefault[size.size] ?? basePrice;
            return (
              <tr key={size.size}>
                <td>{size.size}</td>
                <td>${cost.toFixed(2)}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceBySizeDefault[size.size] ?? ""}
                    placeholder={basePrice.toFixed(2)}
                    onChange={(event) => {
                      const next = { ...priceBySizeDefault };
                      const raw = event.target.value.trim();
                      if (raw) next[size.size] = Number(raw);
                      else delete next[size.size];
                      onChange({ priceBySizeDefault: Object.keys(next).length ? next : null });
                    }}
                  />
                </td>
                <td>${(retail - cost).toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange({ basePriceUsd: null, priceBySizeDefault: null })}>
        Reset về mặc định
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Render pricing tab**

Add:

```tsx
{editorStep === "pricing" && (
  <EditorPricingStep
    store={store}
    value={tempTemplateData}
    onChange={(data) => setTempTemplateData((current) => current ? { ...current, ...data } : current)}
  />
)}
```

- [ ] **Step 6: Add composite editor props and section**

Pass props to `EditorMockupsStep`:

```tsx
defaultCompositeRegionPx={tempTemplateData.defaultCompositeRegionPx}
onChangeCompositeRegion={(region) =>
  setTempTemplateData((current) => current ? { ...current, defaultCompositeRegionPx: region } : current)
}
```

Inside `EditorMockupsStep`, after the upload grid, choose the first image URL and render:

```tsx
{referenceImageUrl && referenceImageWidth > 0 && referenceImageHeight > 0 && (
  <section className="space-y-3">
    <h3>Tọa độ khung hiển thị design</h3>
    <CompositeRegionEditor
      imageUrl={referenceImageUrl}
      imageWidth={referenceImageWidth}
      imageHeight={referenceImageHeight}
      value={defaultCompositeRegionPx}
      onChange={(region) =>
        onChangeCompositeRegion({
          ...region,
          imageWidth: referenceImageWidth,
          imageHeight: referenceImageHeight,
        })
      }
      context="library"
      scope="TEMPLATE"
    />
  </section>
)}
```

Set `referenceImageUrl`, `referenceImageWidth`, and `referenceImageHeight` from the first uploaded or existing template mockup image. The saved `defaultCompositeRegionPx` must include `imageWidth` and `imageHeight`; the editor component only emits `x`, `y`, `width`, `height`, and `rotationDeg`, so the wrapper adds dimensions before updating template state.

- [ ] **Step 7: Build typecheck through Next build**

Run:

```bash
npm run build
```

Expected: build completes or reports unrelated pre-existing warnings only. Fix any TypeScript error in edited files before continuing.

- [ ] **Step 8: Commit editor UI**

```bash
git add 'src/app/(authed)/stores/[id]/config/page.tsx'
git commit -m "feat: add template pricing editor"
```

---

### Task 6: Wizard Step 5 And Publish Pricing

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/layout.tsx`
- Modify: `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`
- Modify: `src/lib/wizard/use-wizard-store.ts`
- Modify: `src/app/api/wizard/drafts/[id]/route.ts`
- Modify: `src/app/api/wizard/drafts/[id]/publish/route.ts`
- Modify: `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/lib/printify/variant-catalog.ts`

- [ ] **Step 1: Add publish route source guard for template pricing**

Append to `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`:

```ts
it("uses template pricing resolver instead of ProductPricingTemplate lookup", () => {
  assert.match(source, /resolveBaseTemplatePrice/);
  assert.doesNotMatch(source, /productPricingTemplate\.findFirst/);
  assert.doesNotMatch(source, /ProductPricingTemplate/);
});
```

- [ ] **Step 2: Update variant payload API to accept merged price map**

In `src/lib/printify/variant-catalog.ts`, keep the parameter name as `priceBySizeOverride` for backward compatibility but pass the merged map from the pricing helper at callers:

```ts
const overridePrice = priceBySizeOverride?.[v.size];
```

No behavioral change is needed in this file if callers supply the merged draft/template map.

- [ ] **Step 3: Remove pricing expand from draft route and layout**

In `layout.tsx`, change:

```ts
loadDraft(draftId, isStep5 ? "sizes" : undefined);
```

In `src/app/api/wizard/drafts/[id]/route.ts`, delete the `expandSet.has("pricing")` branch and remove `pricingData` from the `Promise.all()` and response.

- [ ] **Step 4: Remove expanded pricing from wizard store**

In `src/lib/wizard/use-wizard-store.ts`, remove `expandedPricing` state and any comment that says `?expand=pricing,sizes`. Keep `expandedSizes`.

Add template pricing fields to `DraftData.template`:

```ts
      basePriceUsd?: number | null;
      priceBySizeDefault?: Record<string, number> | null;
      defaultCompositeRegionPx?: {
        x: number;
        y: number;
        width: number;
        height: number;
        rotationDeg: number;
        imageWidth: number;
        imageHeight: number;
      } | null;
```

- [ ] **Step 5: Initialize Step 5 price from template**

In `step-5/page.tsx`, import:

```ts
import {
  mergeDraftAndTemplatePriceMaps,
  resolveBaseTemplatePrice,
} from "@/lib/pricing/template-pricing";
```

Replace the admin pricing fetch effect with:

```ts
useEffect(() => {
  if (!draft || loading) return;
  const base = resolveBaseTemplatePrice({
    templateBasePriceUsd: draft.template?.basePriceUsd ?? null,
    storeDefaultPriceUsd: draft.store?.defaultPriceUsd ?? null,
  });
  setPrice(base.toFixed(2));
}, [draft, loading]);
```

Initialize per-size price state from merged template defaults plus draft override:

```ts
useEffect(() => {
  if (!draft) return;
  const merged = mergeDraftAndTemplatePriceMaps({
    draftPriceBySizeOverride: draft.priceBySizeOverride,
    templatePriceBySizeDefault: draft.template?.priceBySizeDefault ?? null,
  });
  const asStrings: Record<string, string> = {};
  for (const [size, value] of Object.entries(merged ?? {})) {
    asStrings[size] = value.toFixed(2);
  }
  setPriceBySizeOverride(asStrings);
  setSavedPriceOverride((draft.priceBySizeOverride as Record<string, number> | null) ?? null);
}, [draft]);
```

Keep the save button posting only `WizardDraft.priceBySizeOverride`, so template defaults are not re-saved as draft overrides unless the user edits and saves them.

- [ ] **Step 6: Publish route uses template base fallback**

In `publish/route.ts`, import:

```ts
import { resolveBaseTemplatePrice } from "@/lib/pricing/template-pricing";
```

Replace `ProductPricingTemplate.findFirst()` and `pricingTemplate` usage with:

```ts
  const priceUsd = Number.isFinite(requestedPrice as number)
    ? (requestedPrice as number)
    : resolveBaseTemplatePrice({
        templateBasePriceUsd: template?.basePriceUsd ?? null,
        storeDefaultPriceUsd: draft.store?.defaultPriceUsd ?? null,
      });
```

- [ ] **Step 7: Worker uses shared pricing for Printify and Shopify**

In `src/lib/publish/worker.ts`, import:

```ts
import {
  mergeDraftAndTemplatePriceMaps,
  resolveBaseTemplatePrice,
} from "@/lib/pricing/template-pricing";
```

Replace `ProductPricingTemplate.findFirst()` blocks with:

```ts
const baseRetailPriceUSD = resolveBaseTemplatePrice({
  templateBasePriceUsd: template?.basePriceUsd ?? null,
  storeDefaultPriceUsd: draft.store?.defaultPriceUsd ?? null,
});
const priceBySizeOverride = mergeDraftAndTemplatePriceMaps({
  draftPriceBySizeOverride: draft.priceBySizeOverride,
  templatePriceBySizeDefault: template?.priceBySizeDefault ?? null,
});
```

Pass `priceBySizeOverride` into `buildVariantPayload()` in both Printify variant payload and Shopify variant plan paths.

- [ ] **Step 8: Run targeted tests and source search**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/pricing/template-pricing.test.ts
./node_modules/.bin/tsx --test 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts'
! rg -n "/api/admin/pricing-templates|ProductPricingTemplate.findFirst" src
```

Expected: tests pass, and the `! rg ...` command exits successfully because there are no matches.

- [ ] **Step 9: Commit wizard and publish pricing**

```bash
git add 'src/app/(authed)/wizard/[draftId]/layout.tsx' 'src/app/(authed)/wizard/[draftId]/step-5/page.tsx' src/lib/wizard/use-wizard-store.ts 'src/app/api/wizard/drafts/[id]/route.ts' 'src/app/api/wizard/drafts/[id]/publish/route.ts' 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts' src/lib/publish/worker.ts src/lib/printify/variant-catalog.ts
git commit -m "feat: resolve publish pricing from templates"
```

---

### Task 7: Remove Admin Pricing Surface

**Files:**
- Delete: `src/app/(authed)/admin/pricing/page.tsx`
- Delete: `src/app/api/admin/pricing-templates/route.ts`
- Modify: `src/app/(authed)/AuthedShell.tsx`
- Modify: `src/app/(authed)/admin/acl/AclClient.tsx`

- [ ] **Step 1: Remove sidebar entry**

In `AuthedShell.tsx`, delete the navigation item that links to `/admin/pricing`.

- [ ] **Step 2: Remove ACL key**

In `AclClient.tsx`, delete:

```ts
{ key: "pricing", label: "Pricing" }
```

- [ ] **Step 3: Delete old page and API route**

Delete:

```bash
src/app/(authed)/admin/pricing/page.tsx
src/app/api/admin/pricing-templates/route.ts
```

- [ ] **Step 4: Verify no pricing admin callers remain**

Run:

```bash
! rg -n "/api/admin/pricing-templates|/admin/pricing|key: \"pricing\"|ProductPricingTemplate.findFirst" src
```

Expected: no matches and command exits with status `0` because `! rg` inverts the no-match exit code.

- [ ] **Step 5: Commit admin removal**

```bash
git add 'src/app/(authed)/AuthedShell.tsx' 'src/app/(authed)/admin/acl/AclClient.tsx'
git rm 'src/app/(authed)/admin/pricing/page.tsx' 'src/app/api/admin/pricing-templates/route.ts'
git commit -m "feat: remove admin pricing surface"
```

---

### Task 8: Final Verification

**Files:**
- Verify edited files only unless a failing test points to another file.

- [ ] **Step 1: Run Prisma validation**

```bash
npx prisma validate
```

Expected: schema valid.

- [ ] **Step 2: Run focused tests**

```bash
./node_modules/.bin/tsx --test src/lib/pricing/template-pricing.test.ts
./node_modules/.bin/tsx --test src/lib/mockup/custom-library-region.test.ts
./node_modules/.bin/tsx --test src/lib/wizard/schema-pair-source.test.ts
./node_modules/.bin/tsx --test src/lib/placement/views.test.ts
./node_modules/.bin/tsx --test src/lib/placement/resolver.test.ts
./node_modules/.bin/tsx --test src/app/api/stores/mockup-templates-route-source.test.ts
```

Expected: all pass.

- [ ] **Step 3: Verify pricing route deletion with expected no matches**

```bash
! rg -n "/api/admin/pricing-templates|/admin/pricing|key: \"pricing\"|ProductPricingTemplate.findFirst" src
```

Expected: no output, exit status `0`.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: build passes. If build fails from edited files, fix the edited file and rerun this step.

- [ ] **Step 5: Check git diff hygiene**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Status shows only intended implementation files before final commit, or clean if all task commits were made.

- [ ] **Step 6: Manual browser checks**

Start dev server:

```bash
npm run dev
```

Manual flows:

- PRINTIFY template shows Blueprint -> Variants -> Placement -> Giá bán.
- CUSTOM template shows Blueprint -> Variants -> Mockups -> Giá bán.
- CUSTOM template saves and reloads `defaultCompositeRegionPx`.
- New wizard draft Step 5 shows template base/per-size prices, and saving draft override still writes only `WizardDraft.priceBySizeOverride`.
- CUSTOM mockup library pick inherits the current template default as a snapshot; editing the template default after pick creation does not mutate the existing draft pick.
- Publish payload uses template pricing for Printify and Shopify variant payload generation.
- `/admin/pricing` returns 404.

- [ ] **Step 7: Commit verification fixes only when files changed**

If Task 8 produced fixes:

```bash
git add <edited-files>
git commit -m "fix: verify template pricing rollout"
```

If there were no fixes, do not create an empty commit.
