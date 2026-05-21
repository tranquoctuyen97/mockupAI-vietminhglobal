# Template Default Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent incomplete mockup templates from becoming a store default, restore the visible default action, and keep Wizard readiness aligned with template readiness.

**Architecture:** Add one shared readiness helper for `StoreMockupTemplate` objects with linked colors, then use it in service logic, preset status, API error responses, and Store Templates UI. The server owns the invariant; the UI mirrors it for guidance and clearer workflow.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, React client components, `node:test`, `tsx`.

**Commit Policy:** Do not commit during execution unless the user explicitly re-enables commits. Use `git status --short` and `git diff --check` checkpoints instead.

---

## File Structure

- Create: `src/lib/stores/template-readiness.ts`
  - Pure helper for template readiness, missing keys, labels, and status.
- Create: `src/lib/stores/template-readiness.test.ts`
  - Unit tests for the readiness helper.
- Modify: `src/lib/stores/preset.ts`
  - Reuse the helper for async and sync store preset readiness.
- Modify: `src/lib/stores/store-service.ts`
  - Enforce ready-only default, avoid auto-defaulting incomplete first templates, and promote only ready templates after deletion.
- Create: `src/lib/stores/store-service-default.test.ts`
  - Unit-style tests for service logic with mocked Prisma.
- Modify: `src/app/api/stores/[id]/mockup-templates/[templateId]/default/route.ts`
  - Return structured `400` response for incomplete templates.
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx`
  - Restore Star action, render readiness badges, show no-ready-default banner, and handle structured missing errors.
- Modify: `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`
  - Clarify preset warning copy so fallback preview is not mistaken for saved preset configuration.

---

### Task 1: Add Pure Template Readiness Helper

**Files:**
- Create: `src/lib/stores/template-readiness.ts`
- Create: `src/lib/stores/template-readiness.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/stores/template-readiness.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  getTemplateReadiness,
  getTemplateReadinessLabel,
  TEMPLATE_MISSING_LABELS,
} from "./template-readiness";

const placement = {
  version: "2.1",
  variants: {
    _default: {
      front: {
        xMm: 77.8,
        yMm: 78.2,
        widthMm: 200,
        heightMm: 250,
        rotationDeg: 0,
        lockAspect: true,
        mirrored: false,
        placementMode: "preserve",
      },
    },
  },
};

function template(overrides: Record<string, unknown> = {}) {
  return {
    printifyBlueprintId: 12,
    printifyPrintProviderId: 34,
    enabledVariantIds: [101],
    defaultPlacement: placement,
    colors: [{ id: "tc_1" }],
    isDefault: false,
    ...overrides,
  };
}

test("getTemplateReadiness returns ready for a runnable template", () => {
  assert.deepEqual(getTemplateReadiness(template()), {
    ready: true,
    missing: [],
  });
});

test("getTemplateReadiness reports every missing setup item", () => {
  assert.deepEqual(
    getTemplateReadiness(
      template({
        printifyBlueprintId: 0,
        printifyPrintProviderId: 0,
        enabledVariantIds: [],
        defaultPlacement: null,
        colors: [],
      }),
    ),
    {
      ready: false,
      missing: ["blueprint", "provider", "variants", "colors", "placement"],
    },
  );
});

test("getTemplateReadiness does not count fallback front placement", () => {
  assert.deepEqual(
    getTemplateReadiness(template({ defaultPlacement: { version: "2.1", variants: {} } })),
    {
      ready: false,
      missing: ["placement"],
    },
  );
});

test("getTemplateReadinessLabel distinguishes default incomplete from default ready", () => {
  assert.equal(getTemplateReadinessLabel(template({ isDefault: true })), "DEFAULT");
  assert.equal(
    getTemplateReadinessLabel(template({ isDefault: true, enabledVariantIds: [] })),
    "DEFAULT INCOMPLETE",
  );
  assert.equal(getTemplateReadinessLabel(template({ isDefault: false })), "READY");
  assert.equal(
    getTemplateReadinessLabel(template({ isDefault: false, colors: [] })),
    "INCOMPLETE",
  );
});

test("TEMPLATE_MISSING_LABELS has stable user-facing labels", () => {
  assert.equal(TEMPLATE_MISSING_LABELS.blueprint, "Blueprint");
  assert.equal(TEMPLATE_MISSING_LABELS.provider, "Provider");
  assert.equal(TEMPLATE_MISSING_LABELS.variants, "Variants");
  assert.equal(TEMPLATE_MISSING_LABELS.colors, "Colors");
  assert.equal(TEMPLATE_MISSING_LABELS.placement, "Placement");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/stores/template-readiness.test.ts
```

Expected: FAIL with module not found for `./template-readiness`.

- [ ] **Step 3: Implement helper**

Create `src/lib/stores/template-readiness.ts`:

```ts
import { getEnabledViews, normalizePlacementData } from "@/lib/placement/views";

export type TemplateMissing =
  | "blueprint"
  | "provider"
  | "variants"
  | "colors"
  | "placement";

export type TemplateReadinessLabel =
  | "DEFAULT"
  | "DEFAULT INCOMPLETE"
  | "READY"
  | "INCOMPLETE";

export interface TemplateReadiness {
  ready: boolean;
  missing: TemplateMissing[];
}

export const TEMPLATE_MISSING_LABELS: Record<TemplateMissing, string> = {
  blueprint: "Blueprint",
  provider: "Provider",
  variants: "Variants",
  colors: "Colors",
  placement: "Placement",
};

export type TemplateReadinessInput = {
  printifyBlueprintId?: number | null;
  printifyPrintProviderId?: number | null;
  enabledVariantIds?: number[] | null;
  defaultPlacement?: unknown;
  colors?: unknown[] | null;
  isDefault?: boolean | null;
};

export function getTemplateReadiness(
  template: TemplateReadinessInput | null | undefined,
): TemplateReadiness {
  const missing: TemplateMissing[] = [];

  if (!template?.printifyBlueprintId) missing.push("blueprint");
  if (!template?.printifyPrintProviderId) missing.push("provider");
  if (!template?.enabledVariantIds?.length) missing.push("variants");
  if (!template?.colors?.length) missing.push("colors");

  const hasPlacement = Boolean(
    template?.defaultPlacement &&
      getEnabledViews(normalizePlacementData(template.defaultPlacement, false)).length > 0,
  );
  if (!hasPlacement) missing.push("placement");

  return {
    ready: missing.length === 0,
    missing,
  };
}

export function getTemplateReadinessLabel(
  template: TemplateReadinessInput,
): TemplateReadinessLabel {
  const readiness = getTemplateReadiness(template);
  if (template.isDefault && readiness.ready) return "DEFAULT";
  if (template.isDefault) return "DEFAULT INCOMPLETE";
  return readiness.ready ? "READY" : "INCOMPLETE";
}

export function formatTemplateMissing(missing: TemplateMissing[]): string {
  return missing.map((key) => TEMPLATE_MISSING_LABELS[key]).join(", ");
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/stores/template-readiness.test.ts
```

Expected: PASS.

- [ ] **Step 5: Check diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; new helper and test are uncommitted.

---

### Task 2: Reuse Readiness in Store Preset Status

**Files:**
- Modify: `src/lib/stores/preset.ts`

- [ ] **Step 1: Extend helper test coverage for preset-compatible inputs**

Append to `src/lib/stores/template-readiness.test.ts`:

```ts
test("getTemplateReadiness accepts Prisma include colors shape", () => {
  const readiness = getTemplateReadiness(
    template({
      colors: [
        {
          id: "template_color_1",
          color: { id: "color_1", name: "Black", hex: "#000000" },
        },
      ],
    }),
  );

  assert.equal(readiness.ready, true);
});
```

- [ ] **Step 2: Run test**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/stores/template-readiness.test.ts
```

Expected: PASS.

- [ ] **Step 3: Update `preset.ts` imports and logic**

In `src/lib/stores/preset.ts`, replace placement imports:

```ts
import { prisma } from "@/lib/db";
import { getTemplateReadiness, type TemplateMissing } from "@/lib/stores/template-readiness";
```

Replace `PresetMissing` definition with:

```ts
export type PresetMissing = TemplateMissing;
```

Update `computePresetStatus()` to load the default template with colors and use readiness:

```ts
export async function computePresetStatus(storeId: string): Promise<PresetStatus> {
  const template = await prisma.storeMockupTemplate.findFirst({
    where: { storeId, isDefault: true },
    include: { colors: true },
  });

  const { missing } = getTemplateReadiness(template);
  const done = TOTAL_PRESET_ITEMS - missing.length;
  return {
    ready: missing.length === 0,
    missing,
    completionPercent: Math.round((done / TOTAL_PRESET_ITEMS) * 100),
  };
}
```

Update `getPresetStatusSync()` input shape and body:

```ts
export function getPresetStatusSync(store: {
  templates?: Array<{
    printifyBlueprintId?: number | null;
    printifyPrintProviderId?: number | null;
    enabledVariantIds?: number[];
    defaultPlacement?: unknown;
    isDefault?: boolean;
    colors?: unknown[];
  }> | null;
}): PresetStatus {
  const template = store.templates?.find((t) => t.isDefault) ?? null;
  const { missing } = getTemplateReadiness(template);
  const done = TOTAL_PRESET_ITEMS - missing.length;
  return {
    ready: missing.length === 0,
    missing,
    completionPercent: Math.round((done / TOTAL_PRESET_ITEMS) * 100),
  };
}
```

- [ ] **Step 4: Run targeted tests and type check through build**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/stores/template-readiness.test.ts
npm run build
```

Expected: helper tests PASS; build completes or only fails for pre-existing unrelated environment issues. If build fails, capture the first TypeScript error and fix if related to `preset.ts`.

- [ ] **Step 5: Check diff**

Run:

```bash
git diff -- src/lib/stores/preset.ts src/lib/stores/template-readiness.ts src/lib/stores/template-readiness.test.ts
```

Expected: preset status no longer counts global store colors; it checks linked template colors.

---

### Task 3: Enforce Ready-Only Default in Store Service

**Files:**
- Modify: `src/lib/stores/store-service.ts`
- Create: `src/lib/stores/store-service-default.test.ts`

- [ ] **Step 1: Export a domain error**

Add this import to `src/lib/stores/store-service.ts`:

```ts
import {
  getTemplateReadiness,
  type TemplateMissing,
} from "@/lib/stores/template-readiness";
```

Add this class near the top-level exports:

```ts
export class TemplateNotReadyError extends Error {
  missing: TemplateMissing[];

  constructor(missing: TemplateMissing[]) {
    super("Template is incomplete and cannot be set as default");
    this.name = "TemplateNotReadyError";
    this.missing = missing;
  }
}
```

- [ ] **Step 2: Prevent first incomplete template from auto-defaulting**

In `createTemplate()`, replace:

```ts
const existingCount = await prisma.storeMockupTemplate.count({ where: { storeId } });
const isDefault = existingCount === 0;
```

with:

```ts
const existingCount = await prisma.storeMockupTemplate.count({ where: { storeId } });
const draftTemplateForReadiness = {
  printifyBlueprintId: data.printifyBlueprintId,
  printifyPrintProviderId: data.printifyPrintProviderId,
  enabledVariantIds: data.enabledVariantIds ?? [],
  defaultPlacement: data.defaultPlacement,
  colors: data.colorIds ?? [],
};
const isDefault = existingCount === 0 && getTemplateReadiness(draftTemplateForReadiness).ready;
```

- [ ] **Step 3: Replace `setDefaultTemplate()` with validating transaction**

Replace the current `setDefaultTemplate()` implementation with:

```ts
export async function setDefaultTemplate(storeId: string, templateId: string) {
  const template = await prisma.storeMockupTemplate.findFirst({
    where: { id: templateId, storeId },
    include: { colors: true },
  });

  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }

  const readiness = getTemplateReadiness(template);
  if (!readiness.ready) {
    throw new TemplateNotReadyError(readiness.missing);
  }

  return prisma.$transaction([
    prisma.storeMockupTemplate.updateMany({
      where: { storeId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.storeMockupTemplate.update({
      where: { id: templateId },
      data: { isDefault: true },
    }),
  ]);
}
```

- [ ] **Step 4: Promote only ready template after delete**

In `deleteTemplate()`, replace the `nextTemplate` lookup block with:

```ts
const nextTemplates = await tx.storeMockupTemplate.findMany({
  where: { storeId: template.storeId },
  orderBy: { sortOrder: "asc" },
  include: { colors: true },
});
const nextTemplate = nextTemplates.find((candidate) => getTemplateReadiness(candidate).ready);
if (nextTemplate) {
  await tx.storeMockupTemplate.update({
    where: { id: nextTemplate.id },
    data: { isDefault: true },
  });
}
```

- [ ] **Step 5: Write service tests with mocked Prisma**

Create `src/lib/stores/store-service-default.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { setDefaultTemplate, TemplateNotReadyError } from "./store-service";

describe("setDefaultTemplate", () => {
  it("blocks incomplete templates", async () => {
    const db = await import("@/lib/db");
    const findFirst = mock.method(db.prisma.storeMockupTemplate, "findFirst", async () => ({
      id: "tpl_1",
      storeId: "store_1",
      printifyBlueprintId: 1,
      printifyPrintProviderId: 2,
      enabledVariantIds: [],
      defaultPlacement: null,
      colors: [],
    }));
    const transaction = mock.method(db.prisma, "$transaction", async () => []);

    await assert.rejects(
      () => setDefaultTemplate("store_1", "tpl_1"),
      (error: unknown) => {
        assert.ok(error instanceof TemplateNotReadyError);
        assert.deepEqual(error.missing, ["variants", "colors", "placement"]);
        return true;
      },
    );

    assert.equal(findFirst.mock.callCount(), 1);
    assert.equal(transaction.mock.callCount(), 0);
  });

  it("sets ready templates as default", async () => {
    const db = await import("@/lib/db");
    mock.method(db.prisma.storeMockupTemplate, "findFirst", async () => ({
      id: "tpl_1",
      storeId: "store_1",
      printifyBlueprintId: 1,
      printifyPrintProviderId: 2,
      enabledVariantIds: [101],
      defaultPlacement: {
        version: "2.1",
        variants: {
          _default: {
            front: {
              xMm: 77.8,
              yMm: 78.2,
              widthMm: 200,
              heightMm: 250,
              rotationDeg: 0,
              lockAspect: true,
              mirrored: false,
              placementMode: "preserve",
            },
          },
        },
      },
      colors: [{ id: "tc_1" }],
    }));
    const transaction = mock.method(db.prisma, "$transaction", async (ops: unknown[]) => ops);

    await setDefaultTemplate("store_1", "tpl_1");

    assert.equal(transaction.mock.callCount(), 1);
  });
});
```

- [ ] **Step 6: Run service tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/stores/template-readiness.test.ts src/lib/stores/store-service-default.test.ts
```

Expected: PASS. If Prisma object methods cannot be mocked directly due generated client descriptors, move the pure transaction selection into exported helpers and test those helpers instead.

- [ ] **Step 7: Check diff**

Run:

```bash
git diff --check
git diff -- src/lib/stores/store-service.ts src/lib/stores/store-service-default.test.ts
```

Expected: no whitespace errors; service enforces invariant.

---

### Task 4: Return Structured API Error

**Files:**
- Modify: `src/app/api/stores/[id]/mockup-templates/[templateId]/default/route.ts`

- [ ] **Step 1: Import the domain error**

Change imports:

```ts
import {
  setDefaultTemplate,
  TemplateNotReadyError,
} from "@/lib/stores/store-service";
```

- [ ] **Step 2: Let service verify template readiness and map errors**

Replace the final service call:

```ts
await setDefaultTemplate(storeId, templateId);
return NextResponse.json({ success: true });
```

with:

```ts
try {
  await setDefaultTemplate(storeId, templateId);
  return NextResponse.json({ success: true });
} catch (error) {
  if (error instanceof TemplateNotReadyError) {
    return NextResponse.json(
      {
        error: error.message,
        missing: error.missing,
      },
      { status: 400 },
    );
  }
  throw error;
}
```

Keep the existing store/template ownership checks so 404 behavior stays unchanged.

- [ ] **Step 3: Run targeted build or route type check**

Run:

```bash
npm run build
```

Expected: build completes or only fails for unrelated existing environment issues. Fix any error tied to this route or service imports.

- [ ] **Step 4: Check diff**

Run:

```bash
git diff -- 'src/app/api/stores/[id]/mockup-templates/[templateId]/default/route.ts'
```

Expected: route returns `{ error, missing }` on incomplete template.

---

### Task 5: Restore Store Templates Default UI

**Files:**
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx`

- [ ] **Step 1: Add frontend readiness helpers**

Near the `type Tab` declaration, add:

```ts
type TemplateMissing = "blueprint" | "provider" | "variants" | "colors" | "placement";

const TEMPLATE_MISSING_LABELS: Record<TemplateMissing, string> = {
  blueprint: "Blueprint",
  provider: "Provider",
  variants: "Variants",
  colors: "Colors",
  placement: "Placement",
};

function getTemplateMissing(template: TemplateDetail): TemplateMissing[] {
  const missing: TemplateMissing[] = [];
  if (!template.printifyBlueprintId) missing.push("blueprint");
  if (!template.printifyPrintProviderId) missing.push("provider");
  if (!template.enabledVariantIds?.length) missing.push("variants");
  if (!template.colors?.length) missing.push("colors");
  if (getEnabledViews(normalizePlacementData(template.defaultPlacement, false)).length === 0) {
    missing.push("placement");
  }
  return missing;
}

function formatTemplateMissingLabels(missing: TemplateMissing[]): string {
  return missing.map((key) => TEMPLATE_MISSING_LABELS[key]).join(", ");
}
```

- [ ] **Step 2: Improve `handleSetDefault()` toast**

Inside `handleSetDefault()`, replace error handling:

```ts
const err = await res.json();
toast.error(err.error || "Lỗi thiết lập mặc định");
```

with:

```ts
const err = await res.json();
const missing = Array.isArray(err.missing)
  ? formatTemplateMissingLabels(err.missing as TemplateMissing[])
  : "";
toast.error(
  missing
    ? `Template chưa hoàn tất: ${missing}. Hoàn tất template trước khi đặt default.`
    : err.error || "Lỗi thiết lập mặc định",
);
```

- [ ] **Step 3: Add no-ready-default banner**

Before the table card in the templates list view, add:

```tsx
{store.templates.length > 0 && !store.templates.some((t) => t.isDefault && getTemplateMissing(t).length === 0) && (
  <div
    className="alert"
    style={{
      marginBottom: 12,
      backgroundColor: "rgba(245, 158, 11, 0.06)",
      border: "1px solid rgba(245, 158, 11, 0.25)",
    }}
  >
    <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
    <span className="flex-1" style={{ fontSize: "0.84rem" }}>
      Chưa có default template sẵn sàng. Hoàn tất một template rồi đặt làm default để Wizard có thể chạy.
    </span>
  </div>
)}
```

- [ ] **Step 4: Render readiness badges in each row**

Inside `filteredTemplates.map((t) => { ... })`, after `enabledViews`, add:

```ts
const missing = getTemplateMissing(t);
const ready = missing.length === 0;
const statusLabel = t.isDefault
  ? ready ? "DEFAULT" : "DEFAULT INCOMPLETE"
  : ready ? "READY" : "INCOMPLETE";
const statusStyle = ready
  ? { backgroundColor: "rgba(159,232,112,0.18)", color: "#166534" }
  : { backgroundColor: "rgba(245, 158, 11, 0.12)", color: "#92400e" };
```

Replace the existing `DEFAULT` badge next to template name:

```tsx
{t.isDefault && <span className="badge badge-success" style={{ fontSize: "0.62rem" }}>DEFAULT</span>}
```

with:

```tsx
<span
  className="badge"
  style={{
    fontSize: "0.62rem",
    ...statusStyle,
  }}
  title={ready ? statusLabel : `Thiếu: ${formatTemplateMissingLabels(missing)}`}
>
  {statusLabel}
</span>
```

- [ ] **Step 5: Restore Star default action**

In the action cell, after Duplicate and before Settings, add:

```tsx
{!t.isDefault && (
  <button
    onClick={() => ready ? handleSetDefault(t.id) : undefined}
    className="btn btn-secondary"
    disabled={!ready}
    style={{
      padding: "4px 8px",
      fontSize: "0.75rem",
      opacity: ready ? 1 : 0.45,
      cursor: ready ? "pointer" : "not-allowed",
    }}
    title={ready ? "Đặt làm mặc định" : `Không thể đặt default. Thiếu: ${formatTemplateMissingLabels(missing)}`}
  >
    <Star size={12} />
  </button>
)}
```

- [ ] **Step 6: Run build**

Run:

```bash
npm run build
```

Expected: build completes or reports unrelated pre-existing issues. Fix JSX/type errors in `config/page.tsx`.

- [ ] **Step 7: Manual UI check**

Run dev server:

```bash
npm run dev
```

Open Store Settings manually and verify:

- Incomplete templates show `INCOMPLETE` or `DEFAULT INCOMPLETE`.
- Ready templates show `READY`.
- Star action is visible for non-default ready templates.
- Star action is disabled for incomplete non-default templates.
- The warning banner appears when there is no ready default.

Stop the dev server after verification.

---

### Task 6: Clarify Wizard Preset Warning Copy

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`

- [ ] **Step 1: Add label map**

Near the component top after `isAdmin`, add:

```ts
const PRESET_MISSING_LABELS: Record<string, string> = {
  blueprint: "Blueprint",
  provider: "Provider",
  variants: "Variants",
  colors: "Colors",
  placement: "Placement đã lưu",
};
```

- [ ] **Step 2: Replace warning message**

Replace:

```tsx
<p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }}>Store của bạn còn thiếu: {presetStatus.missing.join(", ")}.</p>
```

with:

```tsx
<p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }}>
  Default template chưa sẵn sàng. Còn thiếu:{" "}
  {(presetStatus.missing as string[])
    .map((key) => PRESET_MISSING_LABELS[key] ?? key)
    .join(", ")}
  .
</p>
```

Replace the placement card helper copy if it says `Đang dùng preset mặc định của store` while no saved placement exists. Use:

```tsx
<p style={{ margin: "4px 0 0", fontSize: "0.78rem", opacity: 0.5 }}>
  {placementOverride
    ? "Đang dùng override riêng cho listing này."
    : enabledPlacementViews.length > 0
      ? "Đang dùng placement đã lưu trong default template."
      : "Preview có thể dùng fallback để xem nhanh, nhưng default template vẫn cần placement đã lưu."}
</p>
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: build completes or reports unrelated pre-existing issues. Fix JSX/type errors in `step-3/page.tsx`.

- [ ] **Step 4: Manual Wizard check**

With a store that has an incomplete default:

- Wizard warning says `Default template chưa sẵn sàng`.
- Missing `placement` appears as `Placement đã lưu`.
- `Tạo Mockups` remains disabled until preset status is ready.

---

### Task 7: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/stores/template-readiness.test.ts src/lib/stores/store-service-default.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run related existing tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/placement/views.test.ts src/lib/placement/schema.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS. If build fails for unrelated environment issues, capture the first unrelated error in the final handoff and still verify TypeScript errors from changed files are resolved.

- [ ] **Step 4: Run diff checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; changed files are visible and uncommitted.

- [ ] **Step 5: Manual API check**

With a running dev server and authenticated admin session, use the browser UI or an authenticated request to confirm:

- Incomplete template default request returns HTTP 400 with `missing`.
- Ready template default request returns success.
- Store preset status becomes ready only after a ready default exists.

Do not commit.

---

## Self-Review

Spec coverage:

- Ready-only default invariant: Task 1, Task 3, Task 4.
- Visible default action: Task 5.
- Incomplete state guidance: Task 5, Task 6.
- Wizard alignment: Task 2, Task 6.
- Existing incomplete templates preserved: Task 3 deletion/create behavior and Task 5 `DEFAULT INCOMPLETE` state.
- Tests: Tasks 1, 3, 7.

Scan result: no unresolved markers or unspecified implementation steps remain.

Type consistency: `TemplateMissing`, `TemplateReadiness`, `TemplateNotReadyError`, and `missing` response shape are defined before use.
