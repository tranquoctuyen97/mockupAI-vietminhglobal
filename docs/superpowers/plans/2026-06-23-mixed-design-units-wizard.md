# Mixed Design Units Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a wizard draft to publish matched light/dark pairs and every remaining selected design as independent listings in the same draft.

**Architecture:** Derive pair-backed and independent publish units solely from `draftDesigns` plus persisted `designPairs`: matched counterparts form pairs, while every draft design outside those pair rows publishes independently even if its name has a light/dark suffix. Store independent content on `WizardDraftDesign.aiContent`, keep pair content on `WizardDraftDesignPair.aiContent`, and remove all unmatched-suffix navigation, checklist, and publish gates.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL JSONB, React client components, `node:test` source tests, focused route tests, `npm run build`.

**Execution Note:** Do not run `git add` or `git commit` unless the user explicitly authorizes it. Several target files already have work-in-progress diffs; preserve unrelated edits and layer changes carefully.

---

## File Map

- Modify `prisma/schema.prisma`: ensure `WizardDraftDesign.aiContent Json? @map("ai_content")` exists.
- Create `prisma/migrations/20260623000001_wizard_draft_design_ai_content/migration.sql`: add `wizard_draft_designs.ai_content`.
- Create `src/lib/wizard/publish-units.ts`: shared mixed pair/independent unit helper.
- Create `src/lib/wizard/publish-units.test.ts`: focused helper tests.
- Modify `src/lib/wizard/design-pairs.ts` and `src/lib/wizard/design-pairs.test.ts`: remove the obsolete publishability assertion that rejects unmatched suffix designs.
- Modify `src/lib/wizard/use-wizard-store.ts`: ensure `DraftDesign` exposes `aiContent`.
- Modify `src/app/(authed)/wizard/[draftId]/layout.tsx`: allow unmatched suffix designs to continue as independent units.
- Modify `src/app/(authed)/wizard/[draftId]/step-2/page.tsx`: remove missing-counterpart warnings and count unmatched suffix designs as independent.
- Modify `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`: render pair plus independent tabs, save independent content, consume `designs` generate response.
- Modify `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`: assert mixed tabs/save/generate contract.
- Create/modify `src/app/api/wizard/drafts/[id]/designs/[designId]/content/route.ts`: save independent design content.
- Modify `src/app/api/wizard/drafts/[id]/generate-content/route.ts`: generate content for pairs and independent designs.
- Create `src/app/api/wizard/drafts/[id]/generate-content-route-source.test.ts`: source tests for mixed generate contract.
- Modify `src/app/api/wizard/drafts/[id]/checklist.ts`: compute content and mockup readiness for mixed units without pairing completeness.
- Create `src/app/api/wizard/drafts/[id]/checklist-source.test.ts`: source tests for mixed checklist contract.
- Modify `src/app/api/wizard/drafts/[id]/publish/route.ts`: publish both pair and independent listings.
- Modify `src/app/api/wizard/drafts/[id]/publish-pair-source.test.ts` and `publish-route-source.test.ts`: replace pair-only assertions with mixed-unit assertions.
- Modify `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`: mixed summary labels and active content resolution.
- Create `src/app/(authed)/wizard/[draftId]/step-5-source.test.ts`: source tests for labels and content resolution.

---

### Task 1: Add Shared Mixed Unit Helper

**Files:**
- Create: `src/lib/wizard/publish-units.ts`
- Create: `src/lib/wizard/publish-units.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/lib/wizard/publish-units.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatContentChecklistLabel,
  formatListingSummaryLabel,
  getIndependentDraftDesigns,
  getPairedDraftDesignIds,
  hasAiTitle,
} from "./publish-units";

describe("wizard publish units", () => {
  const draftDesigns = [
    { id: "dd-light", designId: "design-light", design: { id: "design-light", name: "Lion Light" } },
    { id: "dd-dark", designId: "design-dark", design: { id: "design-dark", name: "Lion Dark" } },
    { id: "dd-single", designId: "design-single", design: { id: "design-single", name: "Tiger" } },
  ];

  const designPairs = [
    { id: "pair-1", lightDraftDesignId: "dd-light", darkDraftDesignId: "dd-dark" },
  ];

  it("derives paired ids and independent draft designs", () => {
    assert.deepEqual([...getPairedDraftDesignIds(designPairs)].sort(), ["dd-dark", "dd-light"]);
    assert.deepEqual(getIndependentDraftDesigns(draftDesigns, designPairs).map((d) => d.id), [
      "dd-single",
    ]);
  });

  it("treats unmatched suffix designs as independent publish units", () => {
    const unmatchedDraftDesigns = [
      { id: "dd-dark", designId: "design-dark", design: { id: "design-dark", name: "Lion Dark" } },
      { id: "dd-single", designId: "design-single", design: { id: "design-single", name: "Tiger" } },
    ];

    assert.deepEqual(
      getIndependentDraftDesigns(unmatchedDraftDesigns, []).map((design) => design.id),
      ["dd-dark", "dd-single"],
    );
  });

  it("formats mixed labels", () => {
    assert.equal(formatListingSummaryLabel(2, 3), "5 listings (2 cặp, 3 đơn)");
    assert.equal(formatListingSummaryLabel(2, 0), "2 listings (2 cặp)");
    assert.equal(formatListingSummaryLabel(0, 3), "3 listings (3 đơn)");
    assert.equal(formatContentChecklistLabel(2, 3), "Nội dung đầy đủ cho 2 cặp + 3 đơn");
  });

  it("checks ai title safely", () => {
    assert.equal(hasAiTitle({ title: " Ready " }), true);
    assert.equal(hasAiTitle({ title: " " }), false);
    assert.equal(hasAiTitle(null), false);
  });
});
```

- [ ] **Step 2: Run the focused helper test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/publish-units.test.ts
```

Expected: FAIL because `src/lib/wizard/publish-units.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/wizard/publish-units.ts`:

```ts
export interface WizardDraftDesignLike {
  id: string;
  designId?: string | null;
  aiContent?: unknown | null;
  design?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

export interface WizardDesignPairLike {
  id: string;
  lightDraftDesignId: string;
  darkDraftDesignId: string;
  aiContent?: unknown | null;
}

export function getPairedDraftDesignIds(
  designPairs: readonly WizardDesignPairLike[] | null | undefined,
): Set<string> {
  return new Set(
    (designPairs ?? []).flatMap((pair) => [pair.lightDraftDesignId, pair.darkDraftDesignId]),
  );
}

export function getIndependentDraftDesigns<T extends WizardDraftDesignLike>(
  draftDesigns: readonly T[] | null | undefined,
  designPairs: readonly WizardDesignPairLike[] | null | undefined,
): T[] {
  const pairedIds = getPairedDraftDesignIds(designPairs);
  return (draftDesigns ?? []).filter((draftDesign) => !pairedIds.has(draftDesign.id));
}

export function formatListingSummaryLabel(pairCount: number, independentCount: number): string {
  const total = pairCount + independentCount;
  const parts: string[] = [];
  if (pairCount > 0) parts.push(`${pairCount} cặp`);
  if (independentCount > 0) parts.push(`${independentCount} đơn`);
  return `${total} listings (${parts.join(", ")})`;
}

export function formatContentChecklistLabel(pairCount: number, independentCount: number): string {
  const parts: string[] = [];
  if (pairCount > 0) parts.push(`${pairCount} cặp`);
  if (independentCount > 0) parts.push(`${independentCount} đơn`);
  return parts.length > 0 ? `Nội dung đầy đủ cho ${parts.join(" + ")}` : "Nội dung đầy đủ (title)";
}

export function hasAiTitle(content: unknown): boolean {
  if (!content || typeof content !== "object") return false;
  const title = (content as { title?: unknown }).title;
  return typeof title === "string" && title.trim().length > 0;
}
```

- [ ] **Step 4: Run the helper test and verify it passes**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/publish-units.test.ts
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Run:

```bash
git diff -- src/lib/wizard/publish-units.ts src/lib/wizard/publish-units.test.ts
```

Expected: only the shared helper and its tests changed.

---

### Task 2: Add Independent Design Content Storage

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260623000001_wizard_draft_design_ai_content/migration.sql`
- Modify: `src/lib/wizard/use-wizard-store.ts`
- Create/modify: `src/app/api/wizard/drafts/[id]/designs/[designId]/content/route.ts`

- [ ] **Step 1: Ensure Prisma schema has the field**

In `model WizardDraftDesign`, ensure this field exists near other draft-design metadata:

```prisma
aiContent Json? @map("ai_content")
```

- [ ] **Step 2: Add migration SQL**

Create `prisma/migrations/20260623000001_wizard_draft_design_ai_content/migration.sql`:

```sql
ALTER TABLE "wizard_draft_designs"
  ADD COLUMN "ai_content" JSONB;
```

If a local migration already added this column, keep the migration name that exists in the worktree and do not create a duplicate migration.

- [ ] **Step 3: Ensure store typing exposes `DraftDesign.aiContent`**

In `src/lib/wizard/use-wizard-store.ts`, ensure the draft design interface contains:

```ts
interface DraftDesign {
  id: string;
  designId: string;
  design?: Design | null;
  aiContent?: unknown | null;
}
```

Preserve existing fields on the interface.

- [ ] **Step 4: Add or verify independent content endpoint**

Ensure `src/app/api/wizard/drafts/[id]/designs/[designId]/content/route.ts` contains:

```ts
import { NextResponse } from "next/server";

import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  mergeOptimizedTags,
  normalizeOrganizationCollections,
} from "@/lib/wizard/product-organization";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; designId: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId, designId } = await params;
  const draftDesign = await prisma.wizardDraftDesign.findFirst({
    where: {
      id: designId,
      draftId,
      draft: { tenantId: session.tenantId },
    },
    select: { id: true },
  });

  if (!draftDesign) {
    return NextResponse.json({ error: "Draft design not found" }, { status: 404 });
  }

  const body = await request.json();
  const aiContent = {
    title: String(body.title ?? ""),
    description: String(body.description ?? ""),
    tags: mergeOptimizedTags([], Array.isArray(body.tags) ? body.tags : []),
    collections: normalizeOrganizationCollections(
      Array.isArray(body.collections) ? body.collections : [],
    ),
    altText: String(body.altText ?? ""),
    source: body.source === "manual" ? "manual" : "ai",
  };

  const updated = await prisma.wizardDraftDesign.update({
    where: { id: designId },
    data: { aiContent },
  });

  return NextResponse.json({ draftDesign: updated });
}
```

- [ ] **Step 5: Validate schema and build typing**

Run:

```bash
npx prisma validate
npm run build
```

Expected: Prisma validation passes and build sees `WizardDraftDesign.aiContent`. If `npx prisma validate` fails with the known local Prisma CLI `ERR_REQUIRE_ESM` issue, record it and continue with `npm run build`.

---

### Task 3: Remove Unmatched-Suffix Gating From Step 2 And Layout

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/layout.tsx`
- Modify: `src/app/(authed)/wizard/[draftId]/step-2/page.tsx`
- Modify: `src/lib/wizard/design-pairs.ts`
- Modify: `src/lib/wizard/design-pairs.test.ts`
- Create: `src/app/(authed)/wizard/[draftId]/layout-source.test.ts`

- [ ] **Step 1: Add source tests for mixed gating**

Create `src/app/(authed)/wizard/[draftId]/layout-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layoutSource = readFileSync("src/app/(authed)/wizard/[draftId]/layout.tsx", "utf8");
const step2Source = readFileSync("src/app/(authed)/wizard/[draftId]/step-2/page.tsx", "utf8");

test("wizard layout allows unmatched suffix designs to continue independently", () => {
  assert.doesNotMatch(layoutSource, /pairing\.unpaired/);
  assert.doesNotMatch(layoutSource, /hasUnpairedDraftDesigns/);
  assert.doesNotMatch(layoutSource, /selectedDesignCount\s*!==\s*pairCount\s*\*\s*2/);
});

test("step 2 treats unmatched suffix designs as independent without warnings", () => {
  assert.match(
    step2Source,
    /Design sáng\/tối chỉ ghép cặp khi chọn đủ hai bản\. Design còn lại sẽ publish riêng\./,
  );
  assert.match(step2Source, /pairing\.independent\.length\s*\+\s*pairing\.unpaired\.length/);
  assert.doesNotMatch(step2Source, /Thiếu design để ghép cặp/);
  assert.doesNotMatch(step2Source, /thiếu bản sáng\/tối còn lại/);
});
```

- [ ] **Step 2: Run the source test and verify current state**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/layout-source.test.ts'
```

Expected: FAIL while layout or Step 2 still blocks and warns about unmatched suffix designs.

- [ ] **Step 3: Remove unmatched-suffix navigation gates**

Delete imports and conditions using `pairDesigns`, `pairing.unpaired`, or `hasUnpairedDraftDesigns` from the Step 2-to-Step 3 navigation path. Keep only the existing requirement that at least one design is selected.

- [ ] **Step 4: Update Step 2 summary and warning UI**

Use this copy:

```tsx
<p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
  Chọn 1 hoặc nhiều design. Design sáng/tối chỉ ghép cặp khi chọn đủ hai bản. Design còn lại sẽ publish riêng.
</p>
```

Compute the displayed independent count with:

```ts
const independentCount = pairing.independent.length + pairing.unpaired.length;
```

Use `independentCount` in the pair summary. Delete the warning badge and unmatched-design warning rows so unmatched suffix designs look and behave like normal independent selections.

- [ ] **Step 5: Re-run the source test**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/layout-source.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Remove the obsolete publishability assertion**

Delete `assertPairingIsPublishable` from `src/lib/wizard/design-pairs.ts` and delete its blocking/allowing tests from `src/lib/wizard/design-pairs.test.ts`. Pair-row construction remains unchanged; only matched pairs create `WizardDraftDesignPair` rows.

---

### Task 4: Finish Step 4 Mixed Content Tabs

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`
- Modify: `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`

- [ ] **Step 1: Extend Step 4 source tests**

Append these tests to `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`:

```ts
it("builds Step 4 tabs from both pairs and independent draft designs", () => {
  assert.match(source, /getIndependentDraftDesigns/);
  assert.match(source, /kind:\s*"pair"/);
  assert.match(source, /kind:\s*"independent"/);
  assert.match(source, /draftDesign\.aiContent/);
});

it("saves independent content through the draft design content endpoint", () => {
  assert.match(source, /\/api\/wizard\/drafts\/\$\{draftId\}\/designs\/\$\{activeTab\.id\}\/content/);
  assert.match(source, /method:\s*"PATCH"/);
});

it("reads generated independent content from the designs response array", () => {
  assert.match(source, /data\.designs/);
  assert.match(source, /activeTab\.kind\s*===\s*"independent"/);
});
```

- [ ] **Step 2: Run the Step 4 source test**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts'
```

Expected: FAIL until Step 4 imports and uses the shared helper contract consistently.

- [ ] **Step 3: Import the shared helper**

In `step-4/page.tsx`, add:

```ts
import { getIndependentDraftDesigns } from "@/lib/wizard/publish-units";
```

- [ ] **Step 4: Build mixed tabs with helper output**

Use this tab type:

```ts
type ContentTab =
  | {
      kind: "pair";
      id: string;
      label: string;
      aiContent: any;
      pair: PairContentEntry;
    }
  | {
      kind: "independent";
      id: string;
      label: string;
      aiContent: any;
      draftDesign: DraftDesignEntry;
    };
```

Build tabs with:

```ts
const tabs = useMemo<ContentTab[]>(() => {
  const sortedPairs = [...((draft?.designPairs ?? []) as PairContentEntry[])].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt),
  );

  const pairTabs: ContentTab[] = sortedPairs.map((pair, index) => ({
    kind: "pair",
    id: pair.id,
    label: pair.baseName || `Cặp ${index + 1}`,
    aiContent: pair.aiContent,
    pair,
  }));

  const independentTabs: ContentTab[] = getIndependentDraftDesigns(
    (draft?.draftDesigns ?? []) as DraftDesignEntry[],
    sortedPairs,
  ).map((draftDesign) => ({
    kind: "independent",
    id: draftDesign.id,
    label: draftDesign.design?.name ?? `Design ${draftDesign.id.slice(0, 6)}`,
    aiContent: draftDesign.aiContent,
    draftDesign,
  }));

  return [...pairTabs, ...independentTabs];
}, [draft?.designPairs, draft?.draftDesigns]);
```

- [ ] **Step 5: Save independent tabs to the design content endpoint**

In `handleSaveManual`, use:

```ts
const endpoint =
  activeTab.kind === "pair"
    ? `/api/wizard/drafts/${draftId}/design-pairs/${activeTab.id}/content`
    : `/api/wizard/drafts/${draftId}/designs/${activeTab.id}/content`;

const res = await fetch(endpoint, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...content, source: "manual" }),
});
```

After success, update local draft state so the saved tab shows ready without requiring a full reload:

```ts
if (activeTab.kind === "pair") {
  updateDraft({
    designPairs: (draft?.designPairs ?? []).map((pair: any) =>
      pair.id === activeTab.id ? { ...pair, aiContent: { ...content, source: "manual" } } : pair,
    ),
  } as any);
} else {
  updateDraft({
    draftDesigns: (draft?.draftDesigns ?? []).map((draftDesign: any) =>
      draftDesign.id === activeTab.id
        ? { ...draftDesign, aiContent: { ...content, source: "manual" } }
        : draftDesign,
    ),
  } as any);
}
```

- [ ] **Step 6: Consume mixed generate response**

After `POST /generate-content`, resolve returned content by active tab:

```ts
const generated =
  activeTab.kind === "pair"
    ? data.pairs?.find((entry: any) => entry.id === activeTab.id)?.content
    : data.designs?.find((entry: any) => entry.id === activeTab.id)?.content;

const nextContent = generated ?? data.content;
```

When triggering generation for one tab, send:

```ts
body: JSON.stringify(
  activeTab.kind === "pair" ? { pairId: activeTab.id } : { designId: activeTab.id },
),
```

- [ ] **Step 7: Re-run the Step 4 source test**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts'
```

Expected: PASS.

---

### Task 5: Generate Content For Independent Designs

**Files:**
- Modify: `src/app/api/wizard/drafts/[id]/generate-content/route.ts`
- Create: `src/app/api/wizard/drafts/[id]/generate-content-route-source.test.ts`

- [ ] **Step 1: Add source tests for generate-content mixed contract**

Create `src/app/api/wizard/drafts/[id]/generate-content-route-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/wizard/drafts/[id]/generate-content/route.ts", "utf8");

test("generate content derives independent draft designs alongside pairs", () => {
  assert.match(source, /getIndependentDraftDesigns/);
  assert.match(source, /requestedDesignId/);
  assert.match(source, /draft\.designPairs/);
  assert.match(source, /independentDraftDesigns/);
});

test("generate content saves independent aiContent to wizardDraftDesign", () => {
  assert.match(source, /wizardDraftDesign\.update/);
  assert.match(source, /where:\s*\{\s*id:\s*draftDesign\.id\s*\}/s);
  assert.match(source, /data:\s*\{\s*aiContent\s*\}/s);
});

test("generate content returns both pair and design result arrays", () => {
  assert.match(source, /pairs:\s*pairResults/);
  assert.match(source, /designs:\s*designResults/);
});
```

- [ ] **Step 2: Run the source test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/drafts/[id]/generate-content-route-source.test.ts'
```

Expected: FAIL until mixed generation is implemented.

- [ ] **Step 3: Import the shared helper**

In `generate-content/route.ts`, add:

```ts
import { getIndependentDraftDesigns, getPairedDraftDesignIds } from "@/lib/wizard/publish-units";
```

- [ ] **Step 4: Parse `designId` target**

After reading the body, add:

```ts
const requestedPairId = typeof body?.pairId === "string" ? body.pairId : null;
const requestedDesignId = typeof body?.designId === "string" ? body.designId : null;

if (requestedPairId && requestedDesignId) {
  return NextResponse.json({ error: "Choose either pairId or designId" }, { status: 400 });
}
```

- [ ] **Step 5: Derive independent target designs**

After loading the draft with `draftDesigns` and `designPairs`, add:

```ts
const pairedDraftDesignIds = getPairedDraftDesignIds(draft.designPairs);
const independentDraftDesigns = getIndependentDraftDesigns(draft.draftDesigns, draft.designPairs);

if (requestedDesignId && pairedDraftDesignIds.has(requestedDesignId)) {
  return NextResponse.json(
    { error: "Design belongs to a pair. Generate content by pairId instead." },
    { status: 400 },
  );
}

const targetPairs = requestedPairId
  ? draft.designPairs.filter((pair) => pair.id === requestedPairId)
  : requestedDesignId
    ? []
    : draft.designPairs;

const targetIndependentDesigns = requestedDesignId
  ? independentDraftDesigns.filter((draftDesign) => draftDesign.id === requestedDesignId)
  : requestedPairId
    ? []
    : independentDraftDesigns;
```

- [ ] **Step 6: Generate and save independent content**

Mirror the existing pair generation loop, but save to `wizardDraftDesign`:

```ts
const designResults = await Promise.all(
  targetIndependentDesigns.map(async (draftDesign) => {
    const designName = draftDesign.design?.name ?? "Design";
    const prompt = buildPrompt({
      draft,
      designName,
      colors,
      template,
    });
    const generated = await generateListingContent(prompt);
    const aiContent = {
      title: generated.title,
      description: generated.description,
      tags: mergeOptimizedTags([], generated.tags),
      collections: normalizeOrganizationCollections(generated.collections),
      altText: generated.altText,
      source: "ai",
    };

    await prisma.wizardDraftDesign.update({
      where: { id: draftDesign.id },
      data: { aiContent },
    });

    return { id: draftDesign.id, content: aiContent, cached: false };
  }),
);
```

Use the route's existing prompt/content generation functions and names instead of inventing new AI utilities. Keep imports static at the top of the file.

- [ ] **Step 7: Return mixed result arrays**

Return:

```ts
return NextResponse.json({
  content: pairResults[0]?.content ?? designResults[0]?.content ?? null,
  pairs: pairResults,
  designs: designResults,
});
```

- [ ] **Step 8: Re-run generate-content source test**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/drafts/[id]/generate-content-route-source.test.ts'
```

Expected: PASS.

---

### Task 6: Make Checklist Mixed-Unit Aware

**Files:**
- Modify: `src/app/api/wizard/drafts/[id]/checklist.ts`
- Create: `src/app/api/wizard/drafts/[id]/checklist-source.test.ts`

- [ ] **Step 1: Add source tests for checklist mixed contract**

Create `src/app/api/wizard/drafts/[id]/checklist-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/wizard/drafts/[id]/checklist.ts", "utf8");

test("checklist derives independent draft designs from pairs", () => {
  assert.match(source, /getIndependentDraftDesigns/);
  assert.match(source, /independentDraftDesigns/);
});

test("checklist content requires pair and independent titles", () => {
  assert.match(source, /pairsContentComplete/);
  assert.match(source, /independentContentComplete/);
  assert.match(source, /hasAiTitle\(pair\.aiContent\)/);
  assert.match(source, /hasAiTitle\(draftDesign\.aiContent\)/);
});

test("checklist does not expose pairing completeness", () => {
  assert.doesNotMatch(source, /hasUnpairedDraftDesigns/);
  assert.doesNotMatch(source, /pairingComplete/);
});
```

- [ ] **Step 2: Run the source test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/drafts/[id]/checklist-source.test.ts'
```

Expected: FAIL until checklist uses the shared mixed helper.

- [ ] **Step 3: Import shared helper**

In `checklist.ts`, add:

```ts
import {
  getIndependentDraftDesigns,
  hasAiTitle,
} from "@/lib/wizard/publish-units";
```

- [ ] **Step 4: Compute independent designs once**

Near the existing `designPairs` setup, add:

```ts
const independentDraftDesigns = getIndependentDraftDesigns(draft.draftDesigns ?? [], designPairs);
```

- [ ] **Step 5: Replace content completeness logic**

Replace the pair/non-pair branch with:

```ts
const pairsContentComplete = designPairs.every((pair) => hasAiTitle(pair.aiContent));
const independentContentComplete = independentDraftDesigns.every((draftDesign) =>
  hasAiTitle(draftDesign.aiContent),
);
const contentComplete = pairsContentComplete && independentContentComplete;
```

- [ ] **Step 6: Remove pairing completeness**

Delete `pairingComplete` calculation, remove it from `readyToPublish`, and remove it from the returned checklist object. Unmatched suffix designs are already included in `independentDraftDesigns` because they do not belong to a persisted pair.

- [ ] **Step 7: Include independent designs in mockup coverage**

Keep the existing pair mockup color-group checks for `designPairs`. Add normal selected-color coverage for each independent draft design:

```ts
const independentMockupsMatchColors = independentDraftDesigns.every((draftDesign) => {
  const jobsForDesign = mockupJobs.filter((job) => job.draftDesignId === draftDesign.id);
  return colors.every((color) =>
    jobsForDesign.some((job) => job.colorId === color.id && job.status === "completed"),
  );
});

mockupsMatchColors = pairMockupsMatchColors && independentMockupsMatchColors;
```

Use the existing local mockup job field names from `checklist.ts`; do not rename persisted statuses.

- [ ] **Step 8: Re-run checklist source test**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/drafts/[id]/checklist-source.test.ts'
```

Expected: PASS.

---

### Task 7: Publish Pair And Independent Listings

**Files:**
- Modify: `src/app/api/wizard/drafts/[id]/publish/route.ts`
- Modify: `src/app/api/wizard/drafts/[id]/publish-pair-source.test.ts`
- Modify: `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`

- [ ] **Step 1: Replace pair-only publish source test**

Update `src/app/api/wizard/drafts/[id]/publish-pair-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/wizard/drafts/[id]/publish/route.ts", "utf8");

test("publish route creates listings for both design pairs and independent draft designs", () => {
  assert.match(source, /getIndependentDraftDesigns/);
  assert.match(source, /for \(const pair of draft\.designPairs\)/);
  assert.match(source, /for \(const draftDesign of independentDraftDesigns\)/);
  assert.match(source, /wizardDraftDesignPairId/);
  assert.match(source, /wizardDraftDesignId/);
});

test("publish route does not require selected design count to equal pairs times two", () => {
  assert.doesNotMatch(source, /selectedDraftDesigns\.length\s*!==\s*draft\.designPairs\.length\s*\*\s*2/);
  assert.doesNotMatch(source, /hasUnpairedDraftDesigns/);
});
```

- [ ] **Step 2: Add route source assertions for content validation**

Append to `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`:

```ts
test("publish route validates mixed unit content directly on pairs and draft designs", () => {
  assert.match(source, /hasAiTitle\(pair\.aiContent\)/);
  assert.match(source, /hasAiTitle\(draftDesign\.aiContent\)/);
  assert.doesNotMatch(source, /if \(!aiContent\?\.title\)/);
});
```

- [ ] **Step 3: Run publish source tests and verify they fail**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/drafts/[id]/publish-pair-source.test.ts' 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts'
```

Expected: FAIL until publish supports independent units.

- [ ] **Step 4: Import shared helper**

In `publish/route.ts`, add:

```ts
import {
  getIndependentDraftDesigns,
  hasAiTitle,
} from "@/lib/wizard/publish-units";
```

- [ ] **Step 5: Remove draft-level content requirement**

Delete the top-level block that requires:

```ts
if (!aiContent?.title) {
  return NextResponse.json({ error: "..." }, { status: 400 });
}
```

Content validation now happens per unit.

- [ ] **Step 6: Derive every non-paired design as independent**

After `selectedDraftDesigns` is computed, add:

```ts
const independentDraftDesigns = getIndependentDraftDesigns(selectedDraftDesigns, draft.designPairs);
```

Remove both the old selected-count equality block and the `hasUnpairedDraftDesigns` rejection. A suffix design missing its counterpart has no pair row and therefore appears in `independentDraftDesigns` automatically.

- [ ] **Step 7: Validate content per unit**

Before creating listings, add:

```ts
const pairMissingContent = draft.designPairs.find((pair) => !hasAiTitle(pair.aiContent));
if (pairMissingContent) {
  return NextResponse.json(
    { error: `Thiếu nội dung cho cặp ${pairMissingContent.baseName || pairMissingContent.id}` },
    { status: 400 },
  );
}

const independentMissingContent = independentDraftDesigns.find(
  (draftDesign) => !hasAiTitle(draftDesign.aiContent),
);
if (independentMissingContent) {
  return NextResponse.json(
    {
      error: `Thiếu nội dung cho design ${
        independentMissingContent.design?.name || independentMissingContent.id
      }`,
    },
    { status: 400 },
  );
}
```

- [ ] **Step 8: Keep pair publish loop and add independent loop**

Keep the existing pair loop. After it, add independent listing creation:

```ts
for (const draftDesign of independentDraftDesigns) {
  const content = draftDesign.aiContent as {
    title?: string;
    description?: string;
    tags?: string[];
    collections?: unknown[];
    altText?: string;
  };

  const existing = await prisma.listing.findUnique({
    where: { wizardDraftDesignId: draftDesign.id },
  });

  const listing = existing
    ? existing
    : await prisma.listing.create({
        data: {
          tenantId: draft.tenantId,
          storeId: draft.storeId,
          wizardDraftId: draft.id,
          wizardDraftDesignId: draftDesign.id,
          designId: draftDesign.designId,
          title: content.title || "",
          descriptionHtml: formatDescriptionHtml(content.description),
          tags: content.tags || [],
          organizationCollections: normalizeOrganizationCollections(content.collections),
          status: "draft",
        },
      });

  listings.push({
    id: listing.id,
    draftDesignId: draftDesign.id,
    designId: draftDesign.designId,
    designPairId: null,
    created: !existing,
  });
}
```

Match the existing listing create fields in `publish/route.ts`; the snippet shows the required mixed-unit fields, but implementation must keep the route's current product/template/mockup snapshot fields intact.

- [ ] **Step 9: Re-run publish source tests**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/drafts/[id]/publish-pair-source.test.ts' 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts'
```

Expected: PASS.

---

### Task 8: Fix Step 5 Mixed Review Labels And Content Resolution

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`
- Create: `src/app/(authed)/wizard/[draftId]/step-5-source.test.ts`

- [ ] **Step 1: Add Step 5 source tests**

Create `src/app/(authed)/wizard/[draftId]/step-5-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/(authed)/wizard/[draftId]/step-5/page.tsx", "utf8");

test("step 5 formats mixed listing and content labels", () => {
  assert.match(source, /formatListingSummaryLabel/);
  assert.match(source, /formatContentChecklistLabel/);
  assert.doesNotMatch(source, /designPairs\.length ×/);
  assert.doesNotMatch(source, /pairingComplete/);
  assert.doesNotMatch(source, /Tất cả design đã ghép cặp sáng\/tối/);
});

test("step 5 resolves active independent content from draftDesign aiContent", () => {
  assert.match(source, /activeIndependentDesign/);
  assert.match(source, /activeIndependentDesign\?\.aiContent/);
  assert.doesNotMatch(source, /designPairs\[0\]/);
});
```

- [ ] **Step 2: Run the source test and verify it fails**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/step-5-source.test.ts'
```

Expected: FAIL until Step 5 uses helper labels and independent content.

- [ ] **Step 3: Import shared helpers**

In `step-5/page.tsx`, add:

```ts
import {
  formatContentChecklistLabel,
  formatListingSummaryLabel,
  getIndependentDraftDesigns,
  getPairedDraftDesignIds,
} from "@/lib/wizard/publish-units";
```

- [ ] **Step 4: Derive independent designs and counts**

Use:

```ts
const pairedDraftDesignIds = useMemo(() => getPairedDraftDesignIds(designPairs), [designPairs]);

const independentDesigns = useMemo(
  () => getIndependentDraftDesigns(selectedDraftDesigns as any[], designPairs),
  [selectedDraftDesigns, designPairs],
);

const independentCount = independentDesigns.length;
const listingsCount = designPairs.length + independentCount;
const overallSummaryLabel = formatListingSummaryLabel(designPairs.length, independentCount);
const contentChecklistLabel = formatContentChecklistLabel(designPairs.length, independentCount);
```

- [ ] **Step 5: Resolve active content by unit**

Replace the current `aiContent` resolution with:

```ts
const activePair = useMemo(() => {
  if (!activeDesign) return null;
  return (
    designPairs.find(
      (pair) =>
        pair.lightDraftDesignId === activeDesign.id || pair.darkDraftDesignId === activeDesign.id,
    ) ?? null
  );
}, [activeDesign, designPairs]);

const activeIndependentDesign = useMemo(() => {
  if (!activeDesign || pairedDraftDesignIds.has(activeDesign.id)) return null;
  return independentDesigns.find((draftDesign) => draftDesign.id === activeDesign.id) ?? null;
}, [activeDesign, independentDesigns, pairedDraftDesignIds]);

const aiContent = useMemo(() => {
  if (activePair) return (activePair.aiContent as AiContent | null) || null;
  if (activeIndependentDesign) {
    return (activeIndependentDesign.aiContent as AiContent | null) || null;
  }
  return null;
}, [activePair, activeIndependentDesign]);
```

- [ ] **Step 6: Update labels**

Use:

```tsx
{overallSummaryLabel}. Tất cả listings dùng chung template, màu sắc và placement.
```

For the content checklist row:

```tsx
<ChecklistRow ok={localChecklist.contentComplete} label={contentChecklistLabel} />
```

Delete `pairingComplete` from the local checklist type and remove the complete Step 5 checklist row labelled `Tất cả design đã ghép cặp sáng/tối`.

- [ ] **Step 7: Re-run Step 5 source test**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/step-5-source.test.ts'
```

Expected: PASS.

---

### Task 9: Final Verification

**Files:**
- All files touched above.

- [ ] **Step 1: Run focused tests**

Run:

```bash
./node_modules/.bin/tsx --test \
  src/lib/wizard/publish-units.test.ts \
  'src/app/(authed)/wizard/[draftId]/layout-source.test.ts' \
  'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts' \
  'src/app/(authed)/wizard/[draftId]/step-5-source.test.ts' \
  'src/app/api/wizard/drafts/[id]/checklist-source.test.ts' \
  'src/app/api/wizard/drafts/[id]/generate-content-route-source.test.ts' \
  'src/app/api/wizard/drafts/[id]/publish-pair-source.test.ts' \
  'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run existing pair/wizard focused tests**

Run:

```bash
./node_modules/.bin/tsx --test \
  src/lib/wizard/design-pairs.test.ts \
  src/lib/wizard/state.test.ts \
  'src/app/api/wizard/drafts/[id]/design-pairs/route.test.ts' \
  'src/app/api/wizard/drafts/[id]/design-pairs/[pairId]/content/route.test.ts'
```

Expected: PASS. If an existing test encodes pair-only behavior, update the expectation to the mixed unit contract rather than preserving the old restriction.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Manual verification on a fresh draft**

Use a fresh wizard draft and verify:

Unmatched-suffix scenario:

1. Select one matched light/dark pair and one independent design.
2. Step 2 shows the matched pair and independent count without blocking.
3. Remove one side of the pair and verify Step 2 now reports both remaining designs as independent without a warning.
4. Continue through Content and verify both unmatched designs have independent tabs.
5. Review shows `2 listings (2 đơn)` and contains no pairing-completeness checklist row.
6. Publish creates one listing for each independent design.

Mixed pair plus independent scenario:

1. Select one matched light/dark pair and one independent design.
2. Step 3 generates mockups for all selected draft designs and switches the custom mockup grid by active unit.
3. Step 4 shows one pair tab plus one independent tab.
4. Save content separately for pair and independent tabs.
5. Step 5 summary shows `2 listings (1 cặp, 1 đơn)` without a pairing-completeness row.
6. Step 5 content preview changes correctly between pair and independent active designs.
7. Publish creates one pair listing and one independent listing.

- [ ] **Step 6: Review checkpoint**

Run:

```bash
git status --short
git diff --stat
```

Expected: only mixed design unit implementation files, tests, docs, schema, and migration changed. Do not stage or commit.
