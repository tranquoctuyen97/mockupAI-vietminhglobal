# Step 3 Preview Layout Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Wizard Step 3 preview so the seller sees a compact placement summary, no sidebar overflow, and Live Preview reflects the selected enabled print view instead of always using front placement.

**Architecture:** Keep placement state in `step-3/page.tsx`, add small pure helpers in `src/lib/placement/views.ts`, and make `LivePreview` controllable for selected view and per-view placement. Do not change DB schema, mockup generation, or the placement editor modal.

**Tech Stack:** Next.js App Router, React client components, TypeScript, existing inline style conventions, Node test runner via `tsx --test`.

---

## Current Findings

- `src/app/(authed)/wizard/[draftId]/step-3/page.tsx:407-426` renders the full placement summary twice inside a 240px sidebar.
- `src/lib/placement/views.ts:157-160` only exposes one long `summarizePlacementViews()` string, so UI has no compact count or detail variant.
- `src/app/(authed)/wizard/[draftId]/step-3/page.tsx:480-523` always reads `.front` placement, while `LivePreview` shows tabs for multiple views. Clicking `Mặt sau` can change the shirt silhouette but still uses front placement coordinates.
- Screenshot confirmed visible overflow: green badge `4 vị trí: Mặt trước, Mặt sau, Tay...` spills from sidebar into the Live Preview column.

## File Structure

- Modify `src/lib/placement/views.ts`
  - Add compact and detailed summary helpers.
  - Keep existing `summarizePlacementViews()` for backward compatibility.
- Modify `src/lib/placement/views.test.ts`
  - Add unit tests for short count, detail labels, and disabled state.
- Modify `src/components/mockup/LivePreview.tsx`
  - Add optional controlled view props and per-view placement map.
  - Keep existing API working for callers that pass a single `placement`.
- Modify `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`
  - Use compact placement summary in the sidebar.
  - Move detailed view list into wrapped text.
  - Track `livePreviewView` and pass the correct placement to `LivePreview`.
- Verify with `npx tsc --noEmit`, focused tests, and browser screenshot on `http://localhost:3000/wizard/cmod4zu670000dzt0tuw10b6e/step-3`.

---

### Task 1: Add Placement Summary Helpers

**Files:**
- Modify: `src/lib/placement/views.ts`
- Test: `src/lib/placement/views.test.ts`

- [ ] **Step 1: Write failing tests for compact and detailed placement summaries**

Add these tests to `src/lib/placement/views.test.ts`:

```ts
import {
  formatPlacementViewCount,
  formatPlacementViewDetails,
  getPlacementViewLabels,
  normalizePlacementData,
  setPlacementForView,
} from "./views";
import { DEFAULT_PLACEMENT } from "./types";

test("placement summary helpers split compact count from detailed labels", () => {
  let data = normalizePlacementData(null, false);
  data = setPlacementForView(data, "front", DEFAULT_PLACEMENT);
  data = setPlacementForView(data, "back", { ...DEFAULT_PLACEMENT, xMm: 12 });
  data = setPlacementForView(data, "sleeve_left", { ...DEFAULT_PLACEMENT, xMm: 22 });
  data = setPlacementForView(data, "sleeve_right", { ...DEFAULT_PLACEMENT, xMm: 32 });

  assert.equal(formatPlacementViewCount(data), "4 vị trí");
  assert.equal(formatPlacementViewDetails(data), "Mặt trước, Mặt sau, Tay trái, Tay phải");
  assert.deepEqual(getPlacementViewLabels(data), ["Mặt trước", "Mặt sau", "Tay trái", "Tay phải"]);
});

test("placement summary helpers handle empty placement data", () => {
  const data = normalizePlacementData(null, false);

  assert.equal(formatPlacementViewCount(data), "Chưa cấu hình");
  assert.equal(formatPlacementViewDetails(data), "Chưa có vị trí in nào được bật");
  assert.deepEqual(getPlacementViewLabels(data), []);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx tsx --test src/lib/placement/views.test.ts
```

Expected: fail because `formatPlacementViewCount`, `formatPlacementViewDetails`, and `getPlacementViewLabels` are not exported yet.

- [ ] **Step 3: Implement helpers**

Add this block after `getEnabledViews()` in `src/lib/placement/views.ts`:

```ts
export function getPlacementViewLabels(data: PlacementData | null | undefined): string[] {
  return getEnabledViews(data).map((view) => VIEW_LABELS[view]);
}

export function formatPlacementViewCount(data: PlacementData | null | undefined): string {
  const count = getEnabledViews(data).length;
  return count > 0 ? `${count} vị trí` : "Chưa cấu hình";
}

export function formatPlacementViewDetails(data: PlacementData | null | undefined): string {
  const labels = getPlacementViewLabels(data);
  return labels.length > 0 ? labels.join(", ") : "Chưa có vị trí in nào được bật";
}
```

Keep existing `summarizePlacementViews()` unchanged for other screens.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx tsx --test src/lib/placement/views.test.ts
```

Expected: all placement view tests pass.

---

### Task 2: Make LivePreview Use the Selected View Placement

**Files:**
- Modify: `src/components/mockup/LivePreview.tsx`

- [ ] **Step 1: Extend LivePreview props without breaking existing callers**

Change the `Props` interface in `src/components/mockup/LivePreview.tsx` to:

```ts
interface Props {
  colorHex: string;
  designUrl?: string | null;
  placement: PlacementSpec;
  placementsByView?: Partial<Record<ShirtView, PlacementSpec | null>>;
  printArea: PrintAreaSpec;
  availableViews?: ShirtView[];
  initialView?: ShirtView;
  selectedView?: ShirtView;
  onViewChange?: (view: ShirtView) => void;
  showTabs?: boolean;
  height?: number;
}
```

- [ ] **Step 2: Replace internal view state with controlled fallback**

Replace the current state block:

```ts
const [view, setView] = useState<ShirtView>(initialView);
```

with:

```ts
const [internalView, setInternalView] = useState<ShirtView>(initialView);
const view = selectedView ?? internalView;
const activePlacement = placementsByView?.[view] ?? placement;

function selectView(nextView: ShirtView) {
  setInternalView(nextView);
  onViewChange?.(nextView);
}
```

- [ ] **Step 3: Use activePlacement for SVG coordinate math**

Replace these lines:

```ts
const designSvgX = paSvgX + placement.xMm * mmToSvg;
const designSvgY = paSvgY + placement.yMm * mmToSvg;
const designSvgW = placement.widthMm * mmToSvg;
const designSvgH = placement.heightMm * mmToSvg;
```

with:

```ts
const designSvgX = paSvgX + activePlacement.xMm * mmToSvg;
const designSvgY = paSvgY + activePlacement.yMm * mmToSvg;
const designSvgW = activePlacement.widthMm * mmToSvg;
const designSvgH = activePlacement.heightMm * mmToSvg;
```

If rotation is used later in the component, it must read `activePlacement.rotationDeg`, not `placement.rotationDeg`.

- [ ] **Step 4: Wire tabs to selectView**

Find the tab button `onClick={() => setView(v)}` near the bottom of `LivePreview.tsx` and replace it with:

```tsx
onClick={() => selectView(v)}
```

- [ ] **Step 5: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: pass.

---

### Task 3: Compact Wizard Step 3 Placement Sidebar

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`

- [ ] **Step 1: Import the new helpers and view helpers**

Replace:

```ts
import { normalizePlacementData, summarizePlacementViews } from "@/lib/placement/views";
```

with:

```ts
import {
  formatPlacementViewCount,
  formatPlacementViewDetails,
  getEnabledViews,
  getPlacementForView,
  normalizePlacementData,
} from "@/lib/placement/views";
import type { ViewKey } from "@/lib/placement/types";
```

Keep the existing `PlacementData` type import.

- [ ] **Step 2: Derive compact sidebar summary and live preview view**

After:

```ts
const [previewColorIdx, setPreviewColorIdx] = useState(0);
```

add:

```ts
const [livePreviewView, setLivePreviewView] = useState<ViewKey>("front");
```

After:

```ts
const activePlacement = normalizePlacementData(placementOverride || template?.defaultPlacement, true);
```

replace the current placement summary derivation with:

```ts
const placementCountLabel = formatPlacementViewCount(activePlacement);
const placementDetailLabel = formatPlacementViewDetails(activePlacement);
const enabledPlacementViews = getEnabledViews(activePlacement);
const previewPlacementView = enabledPlacementViews.includes(livePreviewView)
  ? livePreviewView
  : enabledPlacementViews[0] ?? "front";
```

Do not add a new hook after the `if (loading) return` block. The derived `previewPlacementView` fallback above keeps the render valid even if `livePreviewView` points to a now-disabled view.

- [ ] **Step 3: Replace overflowing placement header**

Replace `src/app/(authed)/wizard/[draftId]/step-3/page.tsx:407-418` with:

```tsx
<div className="flex justify-between items-start gap-3" style={{ marginBottom: 12 }}>
  <div style={{ minWidth: 0 }}>
    <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>Vị trí in</h3>
    <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
      {placementSourceLabel}
    </p>
  </div>
  <span
    className="badge badge-success"
    style={{
      flexShrink: 0,
      maxWidth: 86,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    }}
    title={placementDetailLabel}
  >
    {placementCountLabel}
  </span>
</div>
```

- [ ] **Step 4: Replace nested summary card with compact unframed text**

Replace `src/app/(authed)/wizard/[draftId]/step-3/page.tsx:420-426` with:

```tsx
<div style={{ display: "grid", gap: 10 }}>
  <div style={{ display: "grid", gap: 5 }}>
    <p style={{ margin: 0, fontWeight: 800, fontSize: "0.95rem", lineHeight: 1.25 }}>
      {placementCountLabel}
    </p>
    <p
      style={{
        margin: 0,
        opacity: 0.62,
        fontSize: "0.75rem",
        lineHeight: 1.35,
        overflowWrap: "anywhere",
      }}
      title={placementDetailLabel}
    >
      {placementDetailLabel}
    </p>
    <p style={{ margin: 0, opacity: 0.5, fontSize: "0.72rem", lineHeight: 1.35 }}>
      {placementOverride
        ? "Chỉ áp dụng cho listing hiện tại."
        : "Đang dùng preset mặc định của store."}
    </p>
  </div>
```

This removes the card-inside-card pattern and prevents the long list from crossing into Live Preview.

- [ ] **Step 5: Keep action buttons full width but reduce text pressure**

Keep the existing buttons but ensure both have:

```ts
minHeight: 44,
whiteSpace: "normal",
lineHeight: 1.2,
```

Expected visual result:
- Button labels fit inside the 240px sidebar.
- No text crosses the sidebar boundary.
- Primary seller action remains `Điều chỉnh vị trí`.

---

### Task 4: Pass Multi-View Placement to LivePreview

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`

- [ ] **Step 1: Build placements for enabled views**

Inside the Live Preview IIFE, replace the front-only placement code:

```ts
// Resolve placement front coords from activePlacement
const variantsObj = (activePlacement as any)?.variants ?? {};
const firstVariantKey = Object.keys(variantsObj)[0];
const frontPlacement = firstVariantKey ? variantsObj[firstVariantKey]?.front : null;
```

with:

```ts
const livePreviewViews = enabledPlacementViews.filter((view): view is Exclude<ViewKey, "hem"> =>
  view !== "hem",
);
const placementsByView = Object.fromEntries(
  livePreviewViews.map((view) => [view, getPlacementForView(activePlacement, view)]),
) as Partial<Record<Exclude<ViewKey, "hem">, ReturnType<typeof getPlacementForView>>>;
const selectedLivePreviewView = livePreviewViews.includes(previewPlacementView as Exclude<ViewKey, "hem">)
  ? (previewPlacementView as Exclude<ViewKey, "hem">)
  : livePreviewViews[0] ?? "front";
const currentPreviewPlacement = getPlacementForView(activePlacement, selectedLivePreviewView)
  ?? getPlacementForView(activePlacement, "front");
```

Reason: `LivePreview` currently supports `front`, `back`, `sleeve_left`, `sleeve_right`, and `neck_label`; `hem` should stay out of preview tabs until there is a silhouette for it.

- [ ] **Step 2: Pass controlled props to LivePreview**

Replace:

```tsx
{previewColor && frontPlacement ? (
  <LivePreview
    colorHex={previewColor.hex}
    designUrl={designPreviewUrl}
    placement={frontPlacement}
    printArea={{ widthMm: 355.6, heightMm: 406.4, safeMarginMm: 12.7 }}
    height={420}
  />
) : (
```

with:

```tsx
{previewColor && currentPreviewPlacement ? (
  <LivePreview
    colorHex={previewColor.hex}
    designUrl={designPreviewUrl}
    placement={currentPreviewPlacement}
    placementsByView={placementsByView}
    availableViews={livePreviewViews}
    selectedView={selectedLivePreviewView}
    onViewChange={(view) => setLivePreviewView(view)}
    printArea={{ widthMm: 355.6, heightMm: 406.4, safeMarginMm: 12.7 }}
    height={420}
  />
) : (
```

- [ ] **Step 3: Adjust empty state copy**

In the fallback block, replace:

```tsx
<p style={{ fontSize: "0.85rem", margin: 0 }}>Chọn ít nhất 1 màu để xem preview.</p>
```

with:

```tsx
<p style={{ fontSize: "0.85rem", margin: 0 }}>Chọn màu và bật ít nhất 1 vị trí in để xem preview.</p>
```

- [ ] **Step 4: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: pass.

---

### Task 5: Browser Verify Desktop and Narrow Layout

**Files:**
- No source file changes unless verification finds a regression.

- [ ] **Step 1: Run full focused checks**

Run:

```bash
npx tsx --test src/lib/placement/views.test.ts
npx tsc --noEmit
```

Expected: tests pass and typecheck pass.

- [ ] **Step 2: Open the known draft in Edge**

Run:

```bash
open -a "Microsoft Edge" "http://localhost:3000/wizard/cmod4zu670000dzt0tuw10b6e/step-3"
```

Expected:
- Page renders `Preview & Colors`.
- Sidebar placement badge says `4 vị trí`, not the full long list.
- Detailed labels wrap inside the placement card: `Mặt trước, Mặt sau, Tay trái, Tay phải`.
- No green badge or text crosses into Live Preview.

- [ ] **Step 3: Verify Live Preview tabs**

Manual browser checks:
- Click `Mặt sau`; shirt switches to back view and design uses the back placement from `activePlacement`.
- Click `Tay trái`; shirt switches to sleeve shape and design uses sleeve placement.
- Color swatches still switch shirt color.
- `Tạo Mockups` remains visible and aligned in the mockup section.

- [ ] **Step 4: Check horizontal overflow in console**

In DevTools console, run:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Expected:
- `true` at the current desktop width.

Then set browser width near 1280px and run it again.

Expected:
- `true`.
- Sidebar stacks naturally if the viewport reaches the responsive breakpoint.

- [ ] **Step 5: Capture final screenshot**

Run:

```bash
screencapture -x /tmp/mockupai-step3-preview-layout-fixed.png
```

Expected: screenshot shows no sidebar overflow and Live Preview remains centered.

---

## Acceptance Criteria

- Placement sidebar uses compact count in the green badge: `4 vị trí`.
- Full view list wraps inside sidebar and never overlaps Live Preview.
- There is no nested card inside the placement card.
- Live Preview uses the selected view's placement, not hard-coded front placement.
- Live Preview tabs only include views that it can render.
- `npx tsx --test src/lib/placement/views.test.ts` passes.
- `npx tsc --noEmit` passes.
- Browser check shows no horizontal overflow on the known draft URL.

## Non-Goals

- No DB schema change.
- No mockup generation behavior change.
- No redesign of the placement editor modal internals.
- No new design system or component library.
