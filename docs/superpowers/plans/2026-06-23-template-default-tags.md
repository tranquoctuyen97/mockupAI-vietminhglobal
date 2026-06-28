# Template Default Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add template-level default Shopify tags and seed them into wizard Step 4 only when the listing content has no tags.

**Architecture:** Persist normalized `defaultTags` on `StoreMockupTemplate`, expose it through existing template APIs and store config UI, then let Step 4 derive initial editable tags from `draft.template.defaultTags` without changing AI generation or publish behavior. Keep publish unchanged: only saved `aiContent.tags` reaches `Listing.tags`.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL scalar lists, React client components, `node:test`, focused source tests, `npm run build`.

**Execution Note:** Do not run `git add` or `git commit` unless the user explicitly authorizes it. Use review checkpoints instead.

---

## File Map

- Modify `prisma/schema.prisma`: add `StoreMockupTemplate.defaultTags`.
- Create `prisma/migrations/20260623000000_template_default_tags/migration.sql`: add `default_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`.
- Modify `src/lib/wizard/product-organization.ts`: add `normalizeTags()` as the shared tag normalizer.
- Modify `src/lib/stores/store-service.ts`: accept, normalize, persist, and duplicate `defaultTags`.
- Modify `src/app/api/stores/[id]/mockup-templates/route.ts`: serialize and accept `defaultTags`.
- Modify `src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts`: accept normalized `defaultTags` on update.
- Inspect/modify `src/app/api/stores/[id]/wizard-config/route.ts`: include `defaultTags` if this route serializes templates used by wizard setup.
- Modify `src/app/(authed)/stores/[id]/config/page.tsx`: add `defaultTags` to `TemplateDetail`, dirty check, save payload, create defaults, and a chip input in general settings.
- Modify `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`: seed editable tags from `draft.template.defaultTags` only when active content has no tags.
- Add/modify focused tests:
  - `src/lib/wizard/product-organization.test.ts`
  - `src/app/api/stores/mockup-templates-route-source.test.ts`
  - `src/app/api/stores/template-pricing-dirty-source.test.ts`
  - `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`
  - `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`

---

### Task 1: Add Shared Tag Normalization

**Files:**
- Modify: `src/lib/wizard/product-organization.ts`
- Modify: `src/lib/wizard/product-organization.test.ts`

- [ ] **Step 1: Add failing normalization tests**

Append these tests to `src/lib/wizard/product-organization.test.ts` or add them inside the existing describe block if one exists:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_TAGS, normalizeTags } from "./product-organization";

test("normalizeTags trims, dedupes, filters internal tags, and caps output", () => {
  const input = [
    "  Shirt  ",
    "shirt",
    "",
    "mockupai",
    "draft-preview",
    "Gift",
    null,
    undefined,
    ...Array.from({ length: MAX_TAGS + 5 }, (_, index) => `Tag ${index}`),
  ];

  const result = normalizeTags(input);

  assert.equal(result[0], "Shirt");
  assert.equal(result[1], "Gift");
  assert.equal(result.includes("mockupai"), false);
  assert.equal(result.includes("draft-preview"), false);
  assert.equal(result.length, MAX_TAGS);
});

test("normalizeTags returns an empty list for non-array values", () => {
  assert.deepEqual(normalizeTags(undefined), []);
  assert.deepEqual(normalizeTags("shirt"), []);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/product-organization.test.ts
```

Expected: FAIL because `normalizeTags` is not exported.

- [ ] **Step 3: Implement `normalizeTags()`**

Update `src/lib/wizard/product-organization.ts`:

```ts
export function normalizeTags(values: unknown, max = MAX_TAGS): string[] {
  if (!Array.isArray(values)) return [];
  return mergeOptimizedTags([], values).slice(0, max);
}
```

Keep the existing `mergeOptimizedTags()` implementation unchanged.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/product-organization.test.ts
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Run:

```bash
git diff -- src/lib/wizard/product-organization.ts src/lib/wizard/product-organization.test.ts
```

Expected: only the normalizer and tests changed.

---

### Task 2: Add Prisma Field and Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260623000000_template_default_tags/migration.sql`

- [ ] **Step 1: Add schema field**

In `model StoreMockupTemplate`, add the field near other template defaults:

```prisma
defaultTags             String[] @default([]) @map("default_tags")
```

Place it after `priceBySizeDefault` so template defaults stay grouped.

- [ ] **Step 2: Add migration SQL**

Create `prisma/migrations/20260623000000_template_default_tags/migration.sql`:

```sql
ALTER TABLE "store_mockup_templates"
  ADD COLUMN "default_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
```

- [ ] **Step 3: Validate Prisma schema**

Run:

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 4: Review checkpoint**

Run:

```bash
git diff -- prisma/schema.prisma prisma/migrations/20260623000000_template_default_tags/migration.sql
```

Expected: only one schema field and one migration are present.

---

### Task 3: Persist Template Default Tags in Services and APIs

**Files:**
- Modify: `src/lib/stores/store-service.ts`
- Modify: `src/app/api/stores/[id]/mockup-templates/route.ts`
- Modify: `src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts`
- Inspect/modify: `src/app/api/stores/[id]/wizard-config/route.ts`
- Modify: `src/app/api/stores/mockup-templates-route-source.test.ts`

- [ ] **Step 1: Add failing API/source tests**

Append to `src/app/api/stores/mockup-templates-route-source.test.ts`:

```ts
test("mockup templates routes include defaultTags in read and write contracts", () => {
  const listRoute = readFileSync(join(process.cwd(), "src/app/api/stores/[id]/mockup-templates/route.ts"), "utf8");
  const detailRoute = readFileSync(join(process.cwd(), "src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts"), "utf8");
  const service = readFileSync(join(process.cwd(), "src/lib/stores/store-service.ts"), "utf8");

  assert.match(listRoute, /defaultTags:\s*template\.defaultTags/);
  assert.match(listRoute, /defaultTags\?:\s*unknown/);
  assert.match(listRoute, /normalizeTags\(data\.defaultTags/);
  assert.match(detailRoute, /defaultTags:\s*body\.defaultTags/);
  assert.match(service, /defaultTags\?:\s*unknown/);
  assert.match(service, /defaultTags:\s*normalizeTags\(data\.defaultTags/);
  assert.match(service, /defaultTags:\s*original\.defaultTags/);
});
```

- [ ] **Step 2: Run the focused route test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/mockup-templates-route-source.test.ts
```

Expected: FAIL because `defaultTags` is not wired.

- [ ] **Step 3: Import normalizer in service**

In `src/lib/stores/store-service.ts`, add:

```ts
import { normalizeTags } from "@/lib/wizard/product-organization";
```

Keep import grouping consistent with existing `@/` imports.

- [ ] **Step 4: Extend service input types**

In both `createTemplate()` and `updateTemplate()` input object types, add:

```ts
defaultTags?: unknown;
```

- [ ] **Step 5: Persist default tags on create**

Inside `createTemplate()` `tx.storeMockupTemplate.create({ data: { ... } })`, add:

```ts
defaultTags: normalizeTags(data.defaultTags),
```

- [ ] **Step 6: Persist default tags on update**

Inside `updateTemplate()` `tx.storeMockupTemplate.update({ data: { ... } })`, add:

```ts
defaultTags:
  data.defaultTags === undefined
    ? undefined
    : normalizeTags(data.defaultTags),
```

This preserves existing values when the field is omitted.

- [ ] **Step 7: Copy tags on duplicate**

Inside `duplicateTemplate()` `tx.storeMockupTemplate.create({ data: { ... } })`, add:

```ts
defaultTags: original.defaultTags,
```

- [ ] **Step 8: Serialize defaultTags from GET templates**

In `src/app/api/stores/[id]/mockup-templates/route.ts`, add to each returned template object:

```ts
defaultTags: template.defaultTags,
```

- [ ] **Step 9: Accept defaultTags in create route**

In the local `data` type for `POST`, add:

```ts
defaultTags?: unknown;
```

In the object passed to `createTemplate()`, add:

```ts
defaultTags: normalizeTags(data.defaultTags),
```

Import `normalizeTags` in the route:

```ts
import { normalizeTags } from "@/lib/wizard/product-organization";
```

- [ ] **Step 10: Accept defaultTags in update route**

In `src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts`, add to the object passed to `updateTemplate()`:

```ts
defaultTags: body.defaultTags,
```

The service handles `undefined` versus provided values.

- [ ] **Step 11: Inspect wizard-config serialization**

Open `src/app/api/stores/[id]/wizard-config/route.ts`.

If it serializes templates manually, add:

```ts
defaultTags: template.defaultTags,
```

If it returns Prisma template objects directly with `include`, no change is needed. Add a source-test assertion only if this route has a manual serializer.

- [ ] **Step 12: Run focused route test**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/mockup-templates-route-source.test.ts
```

Expected: PASS.

- [ ] **Step 13: Review checkpoint**

Run:

```bash
git diff -- src/lib/stores/store-service.ts 'src/app/api/stores/[id]/mockup-templates/route.ts' 'src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts' 'src/app/api/stores/[id]/wizard-config/route.ts' src/app/api/stores/mockup-templates-route-source.test.ts
```

Expected: `defaultTags` is normalized on create/update, copied on duplicate, and serialized to clients.

---

### Task 4: Add Template Editor Default Tags UI

**Files:**
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx`
- Modify: `src/app/api/stores/template-pricing-dirty-source.test.ts`

- [ ] **Step 1: Add failing editor source assertions**

Append to `src/app/api/stores/template-pricing-dirty-source.test.ts`:

```ts
test("template default tags are editable, saved, and mark editor dirty", () => {
  const source = readFileSync("src/app/(authed)/stores/[id]/config/page.tsx", "utf8");
  const isDirtyBlock = source.match(/const isDirty = useMemo\(\(\) => \{[\s\S]*?return false;\n  \}, \[tempTemplateData, originalTemplate\]\);/);

  assert.ok(isDirtyBlock, "expected TemplatesSection isDirty useMemo block");
  assert.match(source, /defaultTags:\s*\[\]/);
  assert.match(source, /defaultTags:\s*tempTemplateData\.defaultTags/);
  assert.match(isDirtyBlock[0], /defaultTags/);
  assert.match(source, /function TemplateDefaultTagsField/);
  assert.match(source, /<TemplateDefaultTagsField[\s\S]*value=\{value\.defaultTags/);
});
```

- [ ] **Step 2: Run the focused editor source test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/template-pricing-dirty-source.test.ts
```

Expected: FAIL because editor support is missing.

- [ ] **Step 3: Import tag constants/helper**

In `src/app/(authed)/stores/[id]/config/page.tsx`, import:

```ts
import { MAX_TAGS, normalizeTags } from "@/lib/wizard/product-organization";
```

- [ ] **Step 4: Extend `TemplateDetail`**

Add to the `TemplateDetail` interface:

```ts
defaultTags: string[];
```

- [ ] **Step 5: Initialize empty templates**

In `createEmptyTemplate()`, add:

```ts
defaultTags: [],
```

- [ ] **Step 6: Include tags in dirty check**

In `isDirty`, after `priceBySizeDefault` comparison, add:

```ts
if (JSON.stringify(tempTemplateData.defaultTags ?? []) !== JSON.stringify(originalTemplate.defaultTags ?? [])) return true;
```

- [ ] **Step 7: Include tags in save payload**

In `handleSaveTemplate()` payload, add:

```ts
defaultTags: tempTemplateData.defaultTags,
```

- [ ] **Step 8: Render the field in general settings**

Inside `EditorBlueprintStep`, under the template name input in `Cài đặt chung`, render:

```tsx
<TemplateDefaultTagsField
  value={value.defaultTags ?? []}
  onChange={(defaultTags) => onChange({ defaultTags })}
/>
```

- [ ] **Step 9: Add `TemplateDefaultTagsField` component**

Add this component near `EditorBlueprintStep` helpers in `src/app/(authed)/stores/[id]/config/page.tsx`:

```tsx
function TemplateDefaultTagsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const [tagInput, setTagInput] = useState("");
  const tags = normalizeTags(value);

  function addTag() {
    const next = normalizeTags([...tags, tagInput]);
    onChange(next);
    setTagInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((item) => item !== tag));
  }

  return (
    <div style={{ marginTop: 16 }}>
      <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: "0.85rem" }}>
        Default tags ({tags.length}/{MAX_TAGS})
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1"
            style={{ padding: "4px 10px", borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-tertiary)", fontSize: "0.78rem", fontWeight: 500 }}
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", opacity: 0.5 }}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          className="input"
          value={tagInput}
          onChange={(event) => setTagInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder="Thêm default tag..."
          style={{ flex: 1, maxWidth: 360 }}
          disabled={tags.length >= MAX_TAGS}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={addTag}
          disabled={tags.length >= MAX_TAGS || !tagInput.trim()}
          style={{ fontSize: "0.8rem" }}
        >
          <Plus size={14} /> Thêm
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Run focused editor source test**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/template-pricing-dirty-source.test.ts
```

Expected: PASS.

- [ ] **Step 11: Review checkpoint**

Run:

```bash
git diff -- 'src/app/(authed)/stores/[id]/config/page.tsx' src/app/api/stores/template-pricing-dirty-source.test.ts
```

Expected: UI field is scoped to general template settings, explicit save payload includes `defaultTags`, and dirty check covers changes.

---

### Task 5: Seed Step 4 Tags From Template Only When Empty

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`
- Modify: `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`

- [ ] **Step 1: Add failing Step 4 source assertions**

Append to `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`:

```ts
it("seeds template default tags only when active content has no tags", () => {
  assert.match(source, /templateDefaultTags/);
  assert.match(source, /existingTags\.length\s*>\s*0\s*\?\s*existingTags\s*:\s*templateDefaultTags/);
  assert.match(source, /normalizeTags\(draft\?\.template\?\.defaultTags/);
});

it("does not merge template default tags inside AI generation", () => {
  const generateHandler = source.match(/async function handleGenerateAI\(\)[\s\S]*?^\s*}\n\n  \/\/ ── Manual save/m)?.[0] ?? "";
  assert.ok(generateHandler, "expected handleGenerateAI block");
  assert.doesNotMatch(generateHandler, /templateDefaultTags/);
  assert.doesNotMatch(generateHandler, /defaultTags/);
});
```

- [ ] **Step 2: Run focused Step 4 source test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts'
```

Expected: FAIL because seeding is not implemented.

- [ ] **Step 3: Import normalizer**

In Step 4 import from `@/lib/wizard/product-organization`, include:

```ts
normalizeTags,
```

- [ ] **Step 4: Compute template default tags**

After `existing` is computed, add:

```ts
const templateDefaultTags = normalizeTags(draft?.template?.defaultTags);
const existingTags = normalizeTags(existing?.tags || []);
const initialTags = existingTags.length > 0 ? existingTags : templateDefaultTags;
```

- [ ] **Step 5: Use `initialTags` for initial state**

Update the `useState<AiContent>` initializer:

```ts
const [content, setContent] = useState<AiContent>({
  title: existing?.title || "",
  description: existing?.description || "",
  tags: initialTags,
  collections: normalizeOrganizationCollections(existing?.collections || []),
  altText: existing?.altText || "",
});
```

- [ ] **Step 6: Use `initialTags` in draft sync effect**

Update the sync effect `setContent()` call:

```ts
setContent({
  title: existing?.title || "",
  description: existing?.description || "",
  tags: initialTags,
  collections: normalizeOrganizationCollections(existing?.collections || []),
  altText: existing?.altText || "",
});
```

Update the effect dependency list so tag changes are tracked without broad object dependencies:

```ts
}, [activePairId, draft?.id, existing?.title, existing?.tags, templateDefaultTags]);
```

If React lint complains about array dependencies, use stable string keys:

```ts
const existingTagsKey = existingTags.join("\u0000");
const templateDefaultTagsKey = templateDefaultTags.join("\u0000");
```

and depend on those keys instead.

- [ ] **Step 7: Preserve AI generate behavior**

Confirm `handleGenerateAI()` continues to set:

```ts
tags: c.tags || [],
```

Do not add `templateDefaultTags` to this handler.

- [ ] **Step 8: Run focused Step 4 source test**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts'
```

Expected: PASS.

- [ ] **Step 9: Run publish source guard**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts'
```

Expected: PASS. This confirms publish still snapshots `aiContent.tags`/collections and does not need template tag access.

- [ ] **Step 10: Review checkpoint**

Run:

```bash
git diff -- 'src/app/(authed)/wizard/[draftId]/step-4/page.tsx' 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts' 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts'
```

Expected: Step 4 seeds from template defaults only before manual edits; AI generation stays unchanged.

---

### Task 6: Final Verification

**Files:**
- All modified files from Tasks 1-5.

- [ ] **Step 1: Run focused tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/product-organization.test.ts src/app/api/stores/mockup-templates-route-source.test.ts src/app/api/stores/template-pricing-dirty-source.test.ts 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts' 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Validate Prisma**

Run:

```bash
npx prisma validate
```

Expected: schema valid.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS. If build fails on unrelated legacy assumptions, capture the exact error and inspect whether any modified file caused it before widening scope.

- [ ] **Step 4: Check whitespace and patch health**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Review final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the template default tags implementation, migration, focused tests, spec, and this plan are changed.

- [ ] **Step 6: Stop for user review**

Report:

```text
Implementation complete. I did not stage or commit. Verification run:
- focused tsx tests: PASS
- npx prisma validate: PASS
- npm run build: PASS
- git diff --check: PASS
```

If any verification did not run or did not pass, report the exact command and failure summary instead of claiming completion.

---

## Self-Review

- Spec coverage: data model, normalization, template UI, API contract, Step 4 seed-only behavior, pair mode, publish non-change, error handling, and focused verification are covered.
- Placeholder scan: no TBD/TODO/fill-in steps remain.
- Type consistency: the plan uses one field name, `defaultTags`, across Prisma, APIs, client state, Step 4, and tests.
- Scope check: the plan does not change AI prompts, publish worker tag precedence, Shopify tag lookup, or Printify tag enrichment.
