# Template Default Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add template-level default collections in store template config and seed them into wizard Step 4 only when the listing content has no collections.

**Architecture:** Mirror the existing `defaultTags` flow with a separate `defaultCollections` field on `StoreMockupTemplate`. Persist normalized collections through store template services/APIs, expose them in wizard draft/config responses, then let Step 4 derive initial editable collections from `draft.template.defaultCollections` without changing AI generation, optimizer, or publish behavior.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL scalar lists, React client components, `node:test`, focused source tests, `npm run build`.

**Execution Note:** Do not run `git add` or `git commit` unless the user explicitly authorizes it. Use review checkpoints instead.

---

## File Map

- Modify `prisma/schema.prisma`: add `StoreMockupTemplate.defaultCollections`.
- Create `prisma/migrations/20260707000000_template_default_collections/migration.sql`: add `default_collections TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`.
- Modify `src/lib/stores/store-service.ts`: load, normalize, persist, update, and duplicate `defaultCollections`.
- Modify `src/app/api/stores/[id]/mockup-templates/route.ts`: serialize and accept `defaultCollections`.
- Modify `src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts`: accept `defaultCollections` on update.
- Modify `src/app/api/stores/[id]/wizard-config/route.ts`: include `defaultCollections` in template responses.
- Modify `src/app/api/wizard/drafts/[id]/route.ts`: include `defaultCollections` on draft template/store templates.
- Modify `src/app/(authed)/stores/[id]/config/page.tsx`: add `defaultCollections` to template editor state, dirty check, save payload, create defaults, and chip input.
- Modify `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`: seed editable collections from `draft.template.defaultCollections` only when active content has no collections.
- Modify focused tests:
  - `src/app/api/stores/mockup-templates-route-source.test.ts`
  - `src/app/api/stores/template-pricing-dirty-source.test.ts`
  - `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`

---

### Task 1: Add Prisma Field and Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260707000000_template_default_collections/migration.sql`

- [ ] **Step 1: Add schema field**

In `model StoreMockupTemplate`, add the field directly after `defaultTags`:

```prisma
defaultTags             String[]                    @default([]) @map("default_tags")
defaultCollections      String[]                    @default([]) @map("default_collections")
```

- [ ] **Step 2: Add migration SQL**

Create `prisma/migrations/20260707000000_template_default_collections/migration.sql`:

```sql
ALTER TABLE "store_mockup_templates"
  ADD COLUMN "default_collections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
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
git diff -- prisma/schema.prisma prisma/migrations/20260707000000_template_default_collections/migration.sql
```

Expected: only one schema field and one migration are present.

---

### Task 2: Add Service and API Contract Tests

**Files:**
- Modify: `src/app/api/stores/mockup-templates-route-source.test.ts`

- [ ] **Step 1: Add failing source test**

Append this test to `src/app/api/stores/mockup-templates-route-source.test.ts`:

```ts
test("mockup templates routes include defaultCollections in read and write contracts", () => {
  const listRoute = readFileSync(join(process.cwd(), "src/app/api/stores/[id]/mockup-templates/route.ts"), "utf8");
  const detailRoute = readFileSync(join(process.cwd(), "src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts"), "utf8");
  const wizardConfigRoute = readFileSync(join(process.cwd(), "src/app/api/stores/[id]/wizard-config/route.ts"), "utf8");
  const draftRoute = readFileSync(join(process.cwd(), "src/app/api/wizard/drafts/[id]/route.ts"), "utf8");
  const service = readFileSync(join(process.cwd(), "src/lib/stores/store-service.ts"), "utf8");

  assert.match(listRoute, /loadTemplateDefaultCollections/);
  assert.match(listRoute, /defaultCollectionsByTemplateId\.get\(template\.id\)\s*\?\?\s*\[\]/);
  assert.match(listRoute, /defaultCollections\?:\s*unknown/);
  assert.match(detailRoute, /defaultCollections:\s*body\.defaultCollections/);
  assert.match(wizardConfigRoute, /loadTemplateDefaultCollections/);
  assert.match(wizardConfigRoute, /defaultCollectionsByTemplateId\.get\(template\.id\)\s*\?\?\s*\[\]/);
  assert.match(draftRoute, /loadTemplateDefaultCollections/);
  assert.match(draftRoute, /defaultCollectionsByTemplateId\.get\(draft\.template\.id\)\s*\?\?\s*\[\]/);
  assert.match(service, /defaultCollections\?:\s*unknown/);
  assert.match(service, /function updateTemplateDefaultCollections/);
  assert.match(service, /loadTemplateDefaultCollections/);
  assert.match(service, /originalDefaultCollections/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/mockup-templates-route-source.test.ts
```

Expected: FAIL because `defaultCollections` is not wired.

---

### Task 3: Persist Template Default Collections in Store Service

**Files:**
- Modify: `src/lib/stores/store-service.ts`

- [ ] **Step 1: Import the collection normalizer**

Change the existing import from `src/lib/stores/store-service.ts`:

```ts
import { normalizeTags } from "@/lib/wizard/product-organization";
```

to:

```ts
import {
  normalizeOrganizationCollections,
  normalizeTags,
} from "@/lib/wizard/product-organization";
```

- [ ] **Step 2: Add load/update helpers**

After `updateTemplateDefaultTags()`, add:

```ts
export async function loadTemplateDefaultCollections(
  templateIds: string[],
  client: Pick<TemplateDefaultTagsClient, "$queryRaw"> = prisma,
): Promise<Map<string, string[]>> {
  if (templateIds.length === 0) return new Map();

  const rows = await client.$queryRaw<Array<{ id: string; default_collections: string[] | null }>>(
    Prisma.sql`
      SELECT id, default_collections
      FROM "store_mockup_templates"
      WHERE id IN (${Prisma.join(templateIds)})
    `,
  );

  return new Map(
    rows.map((row) => [row.id, normalizeOrganizationCollections(row.default_collections ?? [])]),
  );
}

async function updateTemplateDefaultCollections(
  templateId: string,
  defaultCollections: unknown,
  client: Pick<TemplateDefaultTagsClient, "$executeRaw">,
): Promise<void> {
  await client.$executeRaw`
    UPDATE "store_mockup_templates"
    SET "default_collections" = ${normalizeOrganizationCollections(defaultCollections)}
    WHERE "id" = ${templateId}
  `;
}
```

- [ ] **Step 3: Extend create/update input types**

In the `createTemplate(...)` data type, add:

```ts
defaultCollections?: unknown;
```

In the `updateTemplate(...)` data type, add:

```ts
defaultCollections?: unknown;
```

- [ ] **Step 4: Persist collections on create/update**

In `createTemplate()`, after:

```ts
await updateTemplateDefaultTags(template.id, data.defaultTags, tx);
```

add:

```ts
await updateTemplateDefaultCollections(template.id, data.defaultCollections, tx);
```

In `updateTemplate()`, after the `defaultTags` update block, add:

```ts
if (data.defaultCollections !== undefined) {
  await updateTemplateDefaultCollections(templateId, data.defaultCollections, tx);
}
```

- [ ] **Step 5: Copy collections on duplicate**

After `originalDefaultTags`, add:

```ts
const originalDefaultCollections = (await loadTemplateDefaultCollections([templateId])).get(templateId) ?? [];
```

After:

```ts
await updateTemplateDefaultTags(copy.id, originalDefaultTags, tx);
```

add:

```ts
await updateTemplateDefaultCollections(copy.id, originalDefaultCollections, tx);
```

- [ ] **Step 6: Run the focused test**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/mockup-templates-route-source.test.ts
```

Expected: still FAIL because routes are not wired yet, but service assertions for helper names and duplicate copy should now pass.

---

### Task 4: Wire Template APIs and Wizard Serialization

**Files:**
- Modify: `src/app/api/stores/[id]/mockup-templates/route.ts`
- Modify: `src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts`
- Modify: `src/app/api/stores/[id]/wizard-config/route.ts`
- Modify: `src/app/api/wizard/drafts/[id]/route.ts`

- [ ] **Step 1: Wire list/create route**

In `src/app/api/stores/[id]/mockup-templates/route.ts`, add `loadTemplateDefaultCollections` to the store-service import:

```ts
import {
  createTemplate,
  loadTemplateDefaultCollections,
  loadTemplateDefaultTags,
  updateTemplatePlacement,
} from "@/lib/stores/store-service";
```

After `defaultTagsByTemplateId`, add:

```ts
const defaultCollectionsByTemplateId = await loadTemplateDefaultCollections(
  store.templates.map((template) => template.id),
);
```

In the template JSON object, add:

```ts
defaultCollections: defaultCollectionsByTemplateId.get(template.id) ?? [],
```

In the POST body type, add:

```ts
defaultCollections?: unknown;
```

In the `createTemplate()` call, add:

```ts
defaultCollections: normalizeOrganizationCollections(data.defaultCollections),
```

Also update the product organization import in this route to include collections:

```ts
import {
  normalizeOrganizationCollections,
  normalizeTags,
} from "@/lib/wizard/product-organization";
```

- [ ] **Step 2: Wire detail update route**

In `src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts`, add to the `updateTemplate()` payload:

```ts
defaultCollections: body.defaultCollections,
```

- [ ] **Step 3: Wire wizard config route**

In `src/app/api/stores/[id]/wizard-config/route.ts`, change the import to:

```ts
import {
  loadTemplateDefaultCollections,
  loadTemplateDefaultTags,
} from "@/lib/stores/store-service";
```

After `defaultTagsByTemplateId`, add:

```ts
const defaultCollectionsByTemplateId = await loadTemplateDefaultCollections(
  store.templates.map((template) => template.id),
);
```

In the template JSON object, add:

```ts
defaultCollections: defaultCollectionsByTemplateId.get(template.id) ?? [],
```

- [ ] **Step 4: Wire draft route**

In `src/app/api/wizard/drafts/[id]/route.ts`, change the import to:

```ts
import {
  loadTemplateDefaultCollections,
  loadTemplateDefaultTags,
} from "@/lib/stores/store-service";
```

After `defaultTagsByTemplateId`, add:

```ts
const defaultCollectionsByTemplateId = await loadTemplateDefaultCollections([
  ...(draft.template ? [draft.template.id] : []),
  ...(draft.store?.templates?.map((template) => template.id) ?? []),
]);
```

In the `template` response object, add:

```ts
defaultCollections: defaultCollectionsByTemplateId.get(draft.template.id) ?? [],
```

In the store template response object, add:

```ts
defaultCollections: defaultCollectionsByTemplateId.get(template.id) ?? [],
```

- [ ] **Step 5: Run route source test**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/mockup-templates-route-source.test.ts
```

Expected: PASS.

---

### Task 5: Add Template Config UI Contract Tests

**Files:**
- Modify: `src/app/api/stores/template-pricing-dirty-source.test.ts`

- [ ] **Step 1: Add failing UI source test**

Append this test to `src/app/api/stores/template-pricing-dirty-source.test.ts`:

```ts
test("template default collections are editable, saved, and mark editor dirty", () => {
  const source = readFileSync("src/app/(authed)/stores/[id]/config/page.tsx", "utf8");
  const isDirtyBlock = source.match(/const isDirty = useMemo\(\(\) => \{[\s\S]*?return false;\n  \}, \[tempTemplateData, originalTemplate\]\);/);

  assert.ok(isDirtyBlock, "expected TemplatesSection isDirty useMemo block");
  assert.match(source, /defaultCollections:\s*\[\]/);
  assert.match(source, /defaultCollections:\s*tempTemplateData\.defaultCollections/);
  assert.match(isDirtyBlock[0], /defaultCollections/);
  assert.match(source, /function TemplateDefaultCollectionsField/);
  assert.match(source, /<TemplateDefaultCollectionsField[\s\S]*value=\{value\.defaultCollections/);
  assert.match(source, /MAX_ORGANIZATION_COLLECTIONS/);
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/template-pricing-dirty-source.test.ts
```

Expected: FAIL because the config UI does not expose `defaultCollections`.

---

### Task 6: Add Template Config UI

**Files:**
- Modify: `src/app/(authed)/stores/[id]/config/page.tsx`

- [ ] **Step 1: Import collection max/normalizer if missing**

Ensure the product organization import includes:

```ts
import {
  MAX_ORGANIZATION_COLLECTIONS,
  MAX_TAGS,
  normalizeOrganizationCollections,
  normalizeTags,
} from "@/lib/wizard/product-organization";
```

Keep any existing imported names from that module.

- [ ] **Step 2: Add `defaultCollections` to template types and defaults**

Where `TemplateDetail` is defined, add:

```ts
defaultCollections: string[];
```

Where new/empty template state is created, add:

```ts
defaultCollections: [],
```

- [ ] **Step 3: Add dirty check and save payload**

In the template `isDirty` block, after the default tags comparison, add:

```ts
if (JSON.stringify(tempTemplateData.defaultCollections ?? []) !== JSON.stringify(originalTemplate.defaultCollections ?? [])) return true;
```

In `handleSaveTemplate()` payload, after `defaultTags`, add:

```ts
defaultCollections: tempTemplateData.defaultCollections,
```

- [ ] **Step 4: Render collections field near tags**

In the template general settings card, after `TemplateDefaultTagsField`, add:

```tsx
<TemplateDefaultCollectionsField
  value={value.defaultCollections ?? []}
  onChange={(defaultCollections) => onChange({ defaultCollections })}
/>
```

- [ ] **Step 5: Add the field component**

After `TemplateDefaultTagsField`, add:

```tsx
function TemplateDefaultCollectionsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (collections: string[]) => void;
}) {
  const [collectionInput, setCollectionInput] = useState("");
  const collections = normalizeOrganizationCollections(value);

  function addCollection() {
    const next = normalizeOrganizationCollections([...collections, collectionInput]);
    onChange(next);
    setCollectionInput("");
  }

  function removeCollection(collection: string) {
    onChange(collections.filter((item) => item !== collection));
  }

  return (
    <div style={{ marginTop: 16 }}>
      <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: "0.85rem" }}>
        Default collections ({collections.length}/{MAX_ORGANIZATION_COLLECTIONS})
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {collections.map((collection) => (
          <span
            key={collection}
            className="flex items-center gap-1"
            style={{ padding: "4px 10px", borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-tertiary)", fontSize: "0.78rem", fontWeight: 500 }}
          >
            {collection}
            <button
              type="button"
              onClick={() => removeCollection(collection)}
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
          value={collectionInput}
          onChange={(event) => setCollectionInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCollection();
            }
          }}
          placeholder="Thêm default collection..."
          style={{ flex: 1, maxWidth: 360 }}
          disabled={collections.length >= MAX_ORGANIZATION_COLLECTIONS}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={addCollection}
          disabled={collections.length >= MAX_ORGANIZATION_COLLECTIONS || !collectionInput.trim()}
          style={{ fontSize: "0.8rem" }}
        >
          <Plus size={14} /> Thêm
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run focused UI source test**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/template-pricing-dirty-source.test.ts
```

Expected: PASS.

---

### Task 7: Add Step 4 Seed Tests

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`

- [ ] **Step 1: Add failing source tests**

Append these tests inside `describe("Step 4 product organization UI source", () => { ... })`:

```ts
  it("seeds template default collections only when active content has no collections", () => {
    assert.match(source, /templateDefaultCollections/);
    assert.match(source, /existingCollections\.length\s*>\s*0\s*\?\s*existingCollections\s*:\s*templateDefaultCollections/);
    assert.match(source, /normalizeOrganizationCollections\(draft\?\.template\?\.defaultCollections/);
  });

  it("does not merge template default collections inside AI generation", () => {
    const generateHandler = source.match(/async function handleGenerateAI\(\)[\s\S]*?^\s*}\n\n  \/\/ ── Manual save/m)?.[0] ?? "";
    assert.ok(generateHandler, "expected handleGenerateAI block");
    assert.doesNotMatch(generateHandler, /templateDefaultCollections/);
    assert.doesNotMatch(generateHandler, /defaultCollections/);
  });
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts'
```

Expected: FAIL because Step 4 does not read `defaultCollections`.

---

### Task 8: Seed Collections in Step 4

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`

- [ ] **Step 1: Add derived default collection values**

Near the existing tag derivation:

```ts
const templateDefaultTags = normalizeTags(draft?.template?.defaultTags);
const existingTags = normalizeTags(existing?.tags || []);
const initialTags = existingTags.length > 0 ? existingTags : templateDefaultTags;
const existingTagsKey = existingTags.join("\u0000");
const templateDefaultTagsKey = templateDefaultTags.join("\u0000");
```

add:

```ts
const templateDefaultCollections = normalizeOrganizationCollections(draft?.template?.defaultCollections);
const existingCollections = normalizeOrganizationCollections(existing?.collections || []);
const initialCollections = existingCollections.length > 0 ? existingCollections : templateDefaultCollections;
const existingCollectionsKey = existingCollections.join("\u0000");
const templateDefaultCollectionsKey = templateDefaultCollections.join("\u0000");
```

- [ ] **Step 2: Use initial collections in state**

In the initial `useState<AiContent>()`, change:

```ts
collections: normalizeOrganizationCollections(existing?.collections || []),
```

to:

```ts
collections: initialCollections,
```

In the sync `useEffect()`, change:

```ts
collections: normalizeOrganizationCollections(existing?.collections || []),
```

to:

```ts
collections: initialCollections,
```

- [ ] **Step 3: Update sync effect dependencies**

In the sync `useEffect()` dependency array, add:

```ts
existingCollectionsKey,
templateDefaultCollectionsKey,
```

The dependency list should include both collection keys alongside the existing tag keys.

- [ ] **Step 4: Run Step 4 source test**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts'
```

Expected: PASS.

---

### Task 9: Full Focused Verification

**Files:**
- Review all touched files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/mockup-templates-route-source.test.ts src/app/api/stores/template-pricing-dirty-source.test.ts 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts' src/lib/wizard/product-organization.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Prisma validation**

Run:

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS. If build fails because `next/font` cannot fetch Google Fonts in the sandbox, record it as an environment limitation and include the exact error in the handoff.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Review final diff**

Run:

```bash
git diff -- prisma/schema.prisma prisma/migrations/20260707000000_template_default_collections/migration.sql src/lib/stores/store-service.ts 'src/app/api/stores/[id]/mockup-templates/route.ts' 'src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts' 'src/app/api/stores/[id]/wizard-config/route.ts' 'src/app/api/wizard/drafts/[id]/route.ts' 'src/app/(authed)/stores/[id]/config/page.tsx' 'src/app/(authed)/wizard/[draftId]/step-4/page.tsx' src/app/api/stores/mockup-templates-route-source.test.ts src/app/api/stores/template-pricing-dirty-source.test.ts 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts'
```

Expected: only template default collections changes are present. Existing unrelated dirty files remain untouched.

---

## Implementation Notes

- Reuse `normalizeOrganizationCollections()`; do not add a second collection normalizer.
- Keep `defaultCollections` seed-only. It must not be referenced inside `handleGenerateAI()` or `handleOptimizeOrganization()`.
- Keep publish unchanged. Template defaults reach publish only after Step 4 saves them into visible content.
- Do not add autocomplete, Shopify collection lookup, or collection creation.
- Do not `git add` or `git commit` unless the user explicitly asks.
