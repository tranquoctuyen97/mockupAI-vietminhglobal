# Mixed Design Units Wizard Design

## Goal

Allow one wizard draft to contain both light/dark design pairs and independent single designs. A pair publishes as one listing with two designs. An independent design publishes as one listing by itself. Both unit types can coexist in the same draft.

## Chosen Direction

Use a clean-break mixed unit model.

Every publishable item in the wizard is one of:

- `pair`: backed by `WizardDraftDesignPair`, with content stored in `WizardDraftDesignPair.aiContent`.
- `independent`: backed by one `WizardDraftDesign`, with content stored in `WizardDraftDesign.aiContent`.

Old wizard drafts do not need compatibility behavior. The user will delete old drafts, so implementation should not add fallback/backfill paths that make the new flow harder to reason about.

Pairing is opportunistic, not mandatory. A selected light/dark counterpart set becomes a pair. Any selected draft design that is not part of a persisted matched pair is an independent publish unit, even when its name contains a light/dark suffix.

## Non-Goals

- Do not store independent design content in `WizardDraft.aiContent`.
- Do not add a legacy migration/backfill for existing drafts.
- Do not change how `pairDesigns()` detects pairs.
- Do not change template selection, color selection, mockup generation, or Shopify/Printify product creation beyond mixed unit support.

## Current Context

`src/lib/designs/design-pairing.ts` already returns `pairs`, `unpaired`, `independent`, and `hasPairIntent`. Pair detection continues to use this split, but publish-unit classification is based on persisted matched pair membership:

- `pairs`: valid light/dark matched designs.
- `unpaired`: designs with light/dark intent but missing the matching side; these publish independently.
- `independent`: designs without light/dark intent.

`src/lib/wizard/design-pairs.ts` and `src/lib/wizard/state.ts` should continue to create `WizardDraftDesignPair` rows only for matched pairs. Independent designs stay only in `WizardDraftDesign`.

Some files already contain work-in-progress mixed-mode changes. Implementation should preserve useful WIP and normalize the final contract rather than reverting unrelated diffs.

## Data Model

Add per-design content storage:

```prisma
model WizardDraftDesign {
  // existing fields
  aiContent Json? @map("ai_content")
}
```

Migration:

```sql
ALTER TABLE "wizard_draft_designs"
  ADD COLUMN "ai_content" JSONB;
```

No data backfill is required.

## Shared Mixed Unit Contract

Create one shared helper for client and server code:

```ts
type WizardPublishUnit =
  | { kind: "pair"; pair: WizardDraftDesignPairLike }
  | { kind: "independent"; draftDesign: WizardDraftDesignLike };
```

The helper derives:

- paired draft design IDs from all `designPairs`;
- independent draft designs as `draft.draftDesigns - pairedDraftDesignIds`;
- summary labels such as `5 listings (2 cặp, 3 đơn)`;
- checklist labels such as `Nội dung đầy đủ cho 2 cặp + 3 đơn`.

This avoids repeating slightly different mixed-mode logic in Step 4, Step 5, checklist, generate, and publish.

## Step 2 And Layout

Step 2 selection remains suffix-driven:

- If all selected suffix designs have counterparts, they become pairs.
- Every selected design not included in a matched pair is independent and valid, regardless of its suffix.
- Unmatched suffix designs do not block navigation or publish readiness.

Layout must require at least one selected design, but it must not gate on `pairing.unpaired` or compare selected design count to `designPairs.length * 2`.

Step 2 must not show a missing-counterpart warning. Its summary counts unmatched suffix designs together with other independent designs.

Step 2 copy should state the new behavior:

```text
Chọn 1 hoặc nhiều design. Design sáng/tối chỉ ghép cặp khi chọn đủ hai bản. Design còn lại sẽ publish riêng.
```

## Step 4 Content

Step 4 shows tabs for every publishable unit:

- pair tabs first, sorted by existing pair order;
- independent design tabs after pair tabs, sorted by selected draft design order.

For pair tabs:

- initial content comes from `pair.aiContent`;
- save calls the existing pair content endpoint;
- generated content is saved to `WizardDraftDesignPair.aiContent`.

For independent tabs:

- initial content comes from `draftDesign.aiContent`;
- save calls `PATCH /api/wizard/drafts/[id]/designs/[designId]/content`;
- generated content is saved to `WizardDraftDesign.aiContent`.

`WizardDraft.aiContent` is not the content source for new selected designs. It can remain in the model for unrelated older code, but this flow should not depend on it.

Template default tags still behave as seed-only content:

1. If the active unit already has tags, show those tags.
2. If it has no tags, seed from `draft.template.defaultTags`.
3. After local edit/save, the visible content is authoritative.
4. AI generation must not merge template default tags into generated tags.

## Generate Content API

`POST /api/wizard/drafts/[id]/generate-content` generates content for requested publish units.

Request body supports:

```ts
{
  pairId?: string;
  designId?: string;
}
```

Rules:

- `pairId` generates only that pair.
- `designId` generates only that independent draft design.
- no target generates all pairs and all independent designs.
- a `designId` that belongs to a pair is rejected with `400`, because pair content belongs to the pair.

Response:

```ts
{
  content: AiContent | null;
  pairs: Array<{ id: string; content: AiContent; cached: boolean }>;
  designs: Array<{ id: string; content: AiContent; cached: boolean }>;
}
```

`content` is the first generated content for compatibility with existing UI handling, but Step 4 should prefer `pairs` or `designs` by active tab ID.

## Checklist API

Checklist readiness is based on mixed units:

- `contentComplete`: every pair has `pair.aiContent.title`, and every independent design has `draftDesign.aiContent.title`.
- `mockupsMatchColors`: pair mockup checks apply to pair units; normal per-design color coverage applies to independent units.
- `colorsSelected`, `templateSelected`, and other existing checks stay unchanged.

The Step 5 checklist label for content is:

```text
Nội dung đầy đủ cho 2 cặp + 3 đơn
```

Counts should adapt naturally:

- `Nội dung đầy đủ cho 2 cặp`
- `Nội dung đầy đủ cho 3 đơn`
- `Nội dung đầy đủ cho 2 cặp + 3 đơn`

## Publish API

Publish validates and creates listings for every publish unit:

- pair listing: one listing per `WizardDraftDesignPair`;
- independent listing: one listing per independent `WizardDraftDesign`.

Remove the hard block:

```ts
selectedDraftDesigns.length !== draft.designPairs.length * 2
```

Replace it with:

- every pair has content title;
- every independent design has content title;
- every unit has required mockups according to existing readiness rules.

Listing uniqueness:

- pair listings are unique by `wizardDraftDesignPairId`;
- independent listings are unique by `wizardDraftDesignId`.

Publish response includes both unit types. Pair responses include `designPairId`; independent responses include `draftDesignId` and `designId`.

## Step 5 Review

Step 5 summary uses mixed count labels:

```text
5 listings (2 cặp, 3 đơn)
```

When only one type exists:

```text
2 listings (2 cặp)
3 listings (3 đơn)
```

The active design preview resolves content by unit:

- if the active draft design belongs to a pair, show that pair's `aiContent`;
- otherwise show that active draft design's `aiContent`.

Step 5 must not fall back to the first pair content when the active design is independent.

## Error Handling

Missing content should identify whether the missing unit is a pair or independent design when possible.

Missing mockups continue through the existing checklist/publish error flow.

## Testing

Focused verification should cover:

- schema and migration add `WizardDraftDesign.aiContent`;
- shared helper derives paired IDs, independent designs, and mixed labels;
- unmatched suffix designs are included in independent publish units;
- layout does not block unmatched suffix designs;
- Step 2 copy says independent designs publish separately;
- Step 4 renders both pair and independent tabs and saves independent content through the design content endpoint;
- generate-content returns both `pairs` and `designs` and writes independent content to `WizardDraftDesign.aiContent`;
- checklist marks mixed content complete only when both pairs and independents have titles;
- checklist and Step 5 do not expose a pairing-completeness item;
- publish creates listings for both pair and independent units and removes the `selectedDraftDesigns.length === pairs * 2` assumption;
- Step 5 count/content labels match the chosen copy and active independent preview uses `draftDesign.aiContent`;
- `npm run build` passes;
- `git diff --check` passes.
