# Live Preview Source Of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make custom mockup live preview the product source of truth so the backend-rendered image and Shopify mockup media match the preview the user approves.

**Architecture:** Custom mockup placement has one effective region: listing override, then library/template default, then smart-fit fallback. The UI preview, backend Sharp renderer, and Shopify media publish path must all consume the same effective placement semantics. Printify-generated mockups stay out of scope because Printify renders with its own engine.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Prisma, Sharp, Node test runner, existing mockup worker and publish worker.

---

## Scope

In scope:
- Custom mockup and template/library custom mockup only.
- Rename the preview modal labels so users do not see technical renderer names.
- Ensure backend custom composite output uses the same scaled effective placement shown in live preview.
- Verify Shopify continues to publish `MockupImage.compositeUrl`, which must now be the live-preview-matching final image.

Out of scope:
- Printify-generated mockup visual parity.
- Capturing the browser DOM/live preview as an image.
- Replacing the publish flow or changing Shopify product media APIs.

## File Structure

- Modify `src/components/mockup/ColorMockupCard.tsx`
  - Owns the preview modal labels and live preview display.
  - Keep it as the UI shell; do not move publish or render logic here.
- Modify `src/lib/mockup/worker.ts`
  - Owns backend custom mockup rendering.
  - Use existing placement scaling helper before calling Sharp composite.
- Modify `src/lib/mockup/custom-library-region.test.ts`
  - Source-level guard that worker uses `scaleCompositeRegionToImage`.
- Modify `src/components/mockup/custom-mockup-ui-contract.test.ts`
  - Source-level guard that UI uses user-facing labels and does not expose technical renderer wording.
- Modify `src/lib/publish/worker.test.ts`
  - Guard that Shopify media selection continues to prefer `compositeUrl` over source/live-preview assets.

## Effective Placement Contract

The effective placement for custom mockups is:

```ts
const effectivePlacement =
  listingOverrideCompositeRegionPx ??
  templateOrLibraryDefaultCompositeRegionPx ??
  smartFitFallbackRegion;
```

The same effective placement must drive:
- live preview display,
- backend custom composite output,
- Shopify media through `MockupImage.compositeUrl`.

---

### Task 1: Rename Preview Modal Labels

**Files:**
- Modify: `src/components/mockup/ColorMockupCard.tsx`
- Modify: `src/components/mockup/custom-mockup-ui-contract.test.ts`

- [ ] **Step 1: Add the UI wording contract test**

Append this test to `src/components/mockup/custom-mockup-ui-contract.test.ts`:

```ts
test("mockup preview modal uses user-facing publish labels instead of renderer labels", () => {
  const source = read("src/components/mockup/ColorMockupCard.tsx");

  assert.match(source, /Ảnh xem trước/);
  assert.match(source, /Ảnh sẽ publish/);
  assert.doesNotMatch(source, /Vị trí hiện tại \(Live Preview\)/);
  assert.doesNotMatch(source, /Ảnh mockup đã tạo \(Backend Output\)/);
});
```

- [ ] **Step 2: Run the focused UI contract test and verify it fails before the label change**

Run:

```bash
pnpm exec tsx --test src/components/mockup/custom-mockup-ui-contract.test.ts
```

Expected before implementation:

```text
not ok ... mockup preview modal uses user-facing publish labels instead of renderer labels
```

- [ ] **Step 3: Change only the two visible labels**

In `src/components/mockup/ColorMockupCard.tsx`, replace:

```tsx
Vị trí hiện tại (Live Preview)
```

with:

```tsx
Ảnh xem trước
```

Replace:

```tsx
Ảnh mockup đã tạo (Backend Output)
```

with:

```tsx
Ảnh sẽ publish
```

- [ ] **Step 4: Run the focused UI contract test and verify it passes**

Run:

```bash
pnpm exec tsx --test src/components/mockup/custom-mockup-ui-contract.test.ts
```

Expected:

```text
ok ... mockup preview modal uses user-facing publish labels instead of renderer labels
```

- [ ] **Step 5: Commit the label-only change**

```bash
git add src/components/mockup/ColorMockupCard.tsx src/components/mockup/custom-mockup-ui-contract.test.ts
git commit -m "fix: rename custom mockup preview tabs"
```

---

### Task 2: Make Backend Custom Render Use Scaled Effective Placement

**Files:**
- Modify: `src/lib/mockup/worker.ts`
- Modify: `src/lib/mockup/custom-library-region.test.ts`

- [ ] **Step 1: Add the worker scaling guard test**

Append this assertion to the existing `generation and worker use template mockup items instead of legacy custom sources` test in `src/lib/mockup/custom-library-region.test.ts`:

```ts
  assert.match(worker, /scaleCompositeRegionToImage/);
  assert.doesNotMatch(worker, /effectiveRegion\.imageWidth = imgW/);
  assert.doesNotMatch(worker, /effectiveRegion\.imageHeight = imgH/);
```

Also update the import block in `src/lib/mockup/custom-library-region.test.ts` only if the file needs an extra helper for new assertions. The existing test already reads `worker.ts` as text, so no new import is required.

- [ ] **Step 2: Run the focused placement test and verify it fails before implementation**

Run:

```bash
pnpm exec tsx --test src/lib/mockup/custom-library-region.test.ts
```

Expected before implementation:

```text
not ok ... generation and worker use template mockup items instead of legacy custom sources
```

- [ ] **Step 3: Import the existing scale helper in the worker**

In `src/lib/mockup/worker.ts`, change:

```ts
import { normalizeCompositeRegionPx } from "./custom-library";
```

to:

```ts
import { normalizeCompositeRegionPx, scaleCompositeRegionToImage } from "./custom-library";
```

- [ ] **Step 4: Replace metadata mutation with real scaling**

In `src/lib/mockup/worker.ts`, replace:

```ts
          const effectiveRegion = compositeRegionPx
            ? normalizeCompositeRegionPx(compositeRegionPx)
            : null;
          if (effectiveRegion) {
            // Scale to actual image dimensions if needed
            effectiveRegion.imageWidth = imgW;
            effectiveRegion.imageHeight = imgH;
          }
```

with:

```ts
          const effectiveRegion = compositeRegionPx
            ? normalizeCompositeRegionPx(compositeRegionPx)
            : null;
          const runtimeRegion = effectiveRegion
            ? scaleCompositeRegionToImage(effectiveRegion, imgW, imgH)
            : null;
```

Then replace:

```ts
          if (effectiveRegion) {
            const stored = coerceCustomCompositeRegion(effectiveRegion);
```

with:

```ts
          if (runtimeRegion) {
            const stored = coerceCustomCompositeRegion(runtimeRegion);
```

- [ ] **Step 5: Run the focused placement test and verify it passes**

Run:

```bash
pnpm exec tsx --test src/lib/mockup/custom-library-region.test.ts
```

Expected:

```text
ok ... scaleCompositeRegionToImage scales runtime region without mutating saved default
ok ... generation and worker use template mockup items instead of legacy custom sources
```

- [ ] **Step 6: Commit the backend placement scaling fix**

```bash
git add src/lib/mockup/worker.ts src/lib/mockup/custom-library-region.test.ts
git commit -m "fix: scale custom mockup placement before backend render"
```

---

### Task 3: Guard Shopify Media Uses Backend Final Output

**Files:**
- Modify: `src/lib/publish/worker.test.ts`

- [ ] **Step 1: Add or confirm the Shopify media priority test**

In `src/lib/publish/worker.test.ts`, add this test inside `describe("resolveShopifyMockupMedia", () => { ... })` if no equivalent test exists:

```ts
  it("prefers backend compositeUrl for Shopify media", () => {
    const result = resolveShopifyMockupMedia({
      images: [
        {
          colorName: "White",
          compositeUrl: "custom-mockups/renders/job-1/image-1-output.webp",
          sourceUrl: "mockup://library/template-item-1",
        },
      ],
      storage: {
        resolvePath: (key: string) => `/abs/media/${key}`,
      },
      colorNames: ["White"],
      requireRealPrintifyMockups: false,
    });

    assert.deepEqual(result.mockupImages, [
      {
        kind: "local",
        path: "/abs/media/custom-mockups/renders/job-1/image-1-output.webp",
        colorName: "White",
      },
    ]);
    assert.deepEqual(result.mockupPaths, [
      "/abs/media/custom-mockups/renders/job-1/image-1-output.webp",
    ]);
    assert.deepEqual(result.missingColorNames, []);
  });
```

- [ ] **Step 2: Run the focused publish test**

Run:

```bash
pnpm exec tsx --test src/lib/publish/worker.test.ts
```

Expected:

```text
ok ... prefers backend compositeUrl for Shopify media
```

- [ ] **Step 3: Keep implementation unchanged if the test already passes**

No source change is needed if `src/lib/publish/worker.ts` already contains:

```ts
    const source = image.compositeUrl ?? image.sourceUrl;
```

If this line is missing, restore it exactly:

```ts
    const source = image.compositeUrl ?? image.sourceUrl;
```

- [ ] **Step 4: Commit the publish media guard**

```bash
git add src/lib/publish/worker.test.ts src/lib/publish/worker.ts
git commit -m "test: guard shopify custom mockup media source"
```

---

### Task 4: Focused Verification

**Files:**
- Verify: `src/components/mockup/ColorMockupCard.tsx`
- Verify: `src/lib/mockup/worker.ts`
- Verify: `src/lib/mockup/custom-library.ts`
- Verify: `src/lib/publish/worker.ts`

- [ ] **Step 1: Run custom mockup tests**

Run:

```bash
pnpm exec tsx --test src/lib/mockup/custom-library-region.test.ts src/components/mockup/custom-mockup-ui-contract.test.ts src/components/mockup/ColorMockupCard.test.ts
```

Expected:

```text
pass
```

- [ ] **Step 2: Run publish media tests**

Run:

```bash
pnpm exec tsx --test src/lib/publish/worker.test.ts
```

Expected:

```text
pass
```

- [ ] **Step 3: Run project build**

Run:

```bash
pnpm run build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 4: Manual verification in the app**

Use one custom mockup with a saved library/template placement and one listing override placement.

Check this sequence:

```text
1. Open Step 3 custom mockup card.
2. Open preview modal.
3. Confirm tabs read "Ảnh xem trước" and "Ảnh sẽ publish".
4. Confirm "Ảnh xem trước" is the customer-approved placement.
5. Generate mockup.
6. Confirm "Ảnh sẽ publish" visually matches "Ảnh xem trước".
7. Publish to Shopify.
8. Confirm Shopify product media matches "Ảnh sẽ publish".
```

- [ ] **Step 5: Confirm verification did not create unrelated changes**

Run:

```bash
git status --short
```

Expected:

```text
No untracked build artifacts or generated files from verification.
```

If `git status --short` shows only source/test files intentionally changed by Tasks 1-3, do not create a verification commit.

---

## Self-Review

Spec coverage:
- Live preview is the user-facing source of truth: Task 1 and Task 2.
- Backend output must match live preview placement: Task 2.
- Shopify uses backend final output: Task 3.
- Template/library preconfigured placement remains the initial placement source: Task 2 keeps existing precedence and only fixes runtime scaling.
- Printify-generated mockup remains out of scope: Scope section.

Placeholder scan:
- No placeholder steps.
- Every code change step includes exact file paths and code snippets.

Type consistency:
- `CompositeRegionPx` and `scaleCompositeRegionToImage` are existing names from `src/lib/mockup/custom-library.ts`.
- `runtimeRegion` is local to `src/lib/mockup/worker.ts` and is passed through existing `coerceCustomCompositeRegion`.
- `compositeUrl` and `sourceUrl` match existing publish worker test fixtures.
