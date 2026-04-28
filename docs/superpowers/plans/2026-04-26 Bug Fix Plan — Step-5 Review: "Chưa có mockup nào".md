# Bug Fix Plan — Step-5 Review: "Chưa có mockup nào"

**Status**: 🔴 Blocking publish flow. User chọn mockups ở step-3 nhưng step-5 hiển thị empty + checklist "Mockup khớp số màu (0/0)".

**Severity**: P0 — không publish được.

**Estimated effort**: 2-3 giờ engineering + 30 phút QA.

---

## 1. Root cause analysis

Có **3 bugs cùng lúc** tạo ra symptom này, do model confusion giữa `MockupJob` (parent) và `MockupImage` (child).

### Bug A — Backend `getDraft()` không include `mockupJobs.images`

**File**: `app/src/lib/wizard/state.ts:50-59`

```typescript
export async function getDraft(id: string, tenantId: string) {
  return prisma.wizardDraft.findFirst({
    where: { id, tenantId },
    include: {
      mockupJobs: {
        orderBy: { createdAt: "asc" },
        // ❌ THIẾU: include images!
      },
    },
  });
}
```

→ Frontend nhận `draft.mockupJobs[]` toàn job records (id, status, totalImages, ...) nhưng **không có** mockup URLs / colorName / viewPosition.

### Bug B — Step-5 frontend treat MockupJob as MockupImage

**File**: `app/src/app/(authed)/wizard/[draftId]/step-5/page.tsx:29-35, 88-89`

```typescript
interface MockupJob {
  id: string;
  colorName: string;       // ❌ field này ở MockupImage, không phải MockupJob
  colorHex: string;        // ❌ field này không tồn tại ở Mockup* models
  status: string;
  mockupStoragePath: string | null;  // ❌ MockupImage có compositeUrl/sourceUrl
}

const jobs = (draft?.mockupJobs || []) as MockupJob[];
const succeededJobs = jobs.filter((j) => j.status === "SUCCEEDED");  // ❌ status sai
```

→ Sai 3 thứ:
1. Interface mô tả flat structure (1 row = 1 image), nhưng backend trả nested (1 job có nhiều images)
2. Filter status `"SUCCEEDED"` (uppercase) — schema dùng lowercase `"completed"` (xem `printify-poll-worker.ts:85`)
3. Đếm jobs/color không đúng — 1 job có thể chứa nhiều images cho nhiều colors × views

### Bug C — Backend `buildChecklist()` cùng bug status

**File**: `app/src/app/api/wizard/drafts/[id]/route.ts:99-105`

```typescript
async function buildChecklist(draft: any) {
  const jobs = (draft.mockupJobs ?? []) as Array<{ status: string; colorName: string }>;
  // ❌ status filter sai
  const succeededJobs = jobs.filter((j) => j.status === "SUCCEEDED");
  // ❌ Logic so sánh count jobs vs colors — không đúng vì 1 job nhiều colors
  const mockupsMatchColors =
    colors.length > 0 && succeededJobs.length === colors.length;
}
```

→ Cả 2 chỗ checklist đều fail → `mockupsMatchColors = false` → checklist hiển thị "(0/0)" → publish button disabled.

### Bug D (related) — `MockupImage.included` mặc định = `isDefault`

**File**: `app/src/lib/mockup/printify-poll-worker.ts:172`

```typescript
included: mockup.isDefault,  // chỉ default mockup auto-include
```

→ Khi worker save mockups từ Printify, chỉ mockups Printify đánh dấu `isDefault: true` mới có `included = true`. User cần tick manually để include thêm. Nếu user chưa tick gì, tất cả các mockup non-default đều `included = false` → publish chỉ dùng default (OK).

Nhưng nếu Phase C poll worker không set `isDefault` đúng (vd: tất cả `false`) → 0 included → pipeline fail.

**Verify**: cần kiểm tra `printify-poll-worker.ts:172` xem `mockup.isDefault` có value đúng không. Nếu Printify response không có `is_default` flag, mặc định false → tất cả images không included.

---

## 2. Fix plan

### Step 1 — Backend: include `mockupJobs.images` trong getDraft

**File**: `app/src/lib/wizard/state.ts`

```typescript
export async function getDraft(id: string, tenantId: string) {
  return prisma.wizardDraft.findFirst({
    where: { id, tenantId },
    include: {
      design: true,
      store: {
        include: {
          colors: true,
          template: true,
        },
      },
      mockupJobs: {
        orderBy: { createdAt: "asc" },
        include: {
          images: {
            // Lấy hết, frontend tự filter included nếu cần
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });
}
```

**Lưu ý**: Cần `select` cẩn thận để không inflate payload. Nếu draft có 4 jobs × 20 mockups × 2 colors = 160 rows, mỗi row có URL ~200 bytes → ~32KB JSON. OK cho 1 draft.

### Step 2 — Backend: fix `buildChecklist` đếm theo MockupImage

**File**: `app/src/app/api/wizard/drafts/[id]/route.ts`

```typescript
async function buildChecklist(draft: any) {
  // FIX: flatten included images từ tất cả completed jobs
  const completedJobs = (draft.mockupJobs ?? [])
    .filter((j: any) => j.status === "completed");  // lowercase

  const includedImages = completedJobs
    .flatMap((j: any) => j.images ?? [])
    .filter((img: any) => img.included);

  // 1. Mockup count matches selected color count
  // FIX: 1 color cần có ít nhất 1 included mockup
  const colorsWithMockup = new Set(
    includedImages.map((img: any) => img.colorName.toLowerCase())
  );
  const selectedColors = (draft.selectedColors as Array<{ title: string }>) ?? [];

  const mockupsMatchColors =
    selectedColors.length > 0 &&
    selectedColors.every((c) => colorsWithMockup.has(c.title.toLowerCase()));

  // ... rest unchanged
}
```

### Step 3 — Frontend: rewrite step-5 đọc đúng structure

**File**: `app/src/app/(authed)/wizard/[draftId]/step-5/page.tsx`

```typescript
// Interface CHỈNH CHO ĐÚNG MockupImage schema
interface MockupImage {
  id: string;
  printifyMockupId: string;
  variantId: number;
  colorName: string;
  viewPosition: string;       // front|back|sleeve_left|sleeve_right|neck_label
  sourceUrl: string;
  compositeUrl: string | null;
  compositeStatus: string;
  included: boolean;
  isDefault: boolean;
  cameraLabel: string | null;
  mockupType: string;
  sortOrder: number;
}

interface MockupJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  totalImages: number;
  completedImages: number;
  images: MockupImage[];
}

export default function Step6ReviewPage() {
  // ...
  const mockupJobs = (draft?.mockupJobs ?? []) as MockupJob[];

  // Flatten → list of included images from completed jobs
  const allMockups: MockupImage[] = mockupJobs
    .filter((j) => j.status === "completed")
    .flatMap((j) => j.images ?? [])
    .filter((img) => img.included);

  // Get color hex từ store.colors lookup (cần backend trả về)
  const colors = (draft?.selectedColors as Array<{ title: string; hex: string }>) || [];
  const colorHexLookup = new Map(colors.map(c => [c.title.toLowerCase(), c.hex]));

  // Group by color for carousel/grid
  const groupedByColor = useMemo(() => {
    const groups = new Map<string, MockupImage[]>();
    for (const img of allMockups) {
      const arr = groups.get(img.colorName) ?? [];
      arr.push(img);
      groups.set(img.colorName, arr);
    }
    return groups;
  }, [allMockups]);
}
```

**Carousel render**:
```tsx
{allMockups.length > 0 ? (
  <>
    <img
      src={toPublicUrl(allMockups[carouselIdx].compositeUrl ?? allMockups[carouselIdx].sourceUrl)}
      alt={`${allMockups[carouselIdx].colorName} - ${viewLabel(allMockups[carouselIdx].viewPosition)}`}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
    {/* Carousel controls + label */}
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
      {allMockups[carouselIdx].colorName} · {viewLabel(allMockups[carouselIdx].viewPosition)}
    </div>
  </>
) : (
  <EmptyState message="Chưa có mockup được chọn" link="/wizard/.../step-3" />
)}
```

### Step 4 — Add `viewLabel` helper

**File mới**: `app/src/lib/placement/labels.ts`

```typescript
export const VIEW_LABELS_VI: Record<string, string> = {
  front: "Mặt trước",
  back: "Mặt sau",
  sleeve_left: "Tay trái",
  sleeve_right: "Tay phải",
  neck_label: "Nhãn cổ",
  hem: "Gấu áo",
};

export function viewLabel(pos: string): string {
  return VIEW_LABELS_VI[pos] ?? pos;
}
```

Replace ALL chỗ raw render `viewPosition` trong codebase:
- `step-3/page.tsx`
- `step-5/page.tsx`
- `MockupGallery.tsx`
- Listing detail page

### Step 5 — Verify Phase C poll worker đặt `isDefault` đúng

**File**: `app/src/lib/printify/product.ts` (function `parsePrintifyImage`)

Check Printify response structure — `images[]` element có field nào để biết "default"? Theo Printify API docs:
```json
{
  "src": "https://...",
  "variant_ids": [12345],
  "position": "front",
  "is_default": true,         // ← field này
  "is_selected_for_publishing": true
}
```

Nếu poll worker bỏ qua `is_default` hoặc đọc sai key → tất cả images `isDefault: false` → tất cả `included: false` → user thấy gallery rỗng dù có data.

**Fix**: ensure parser map đúng:
```typescript
function parsePrintifyImage(raw: any): ParsedPrintifyMockupImage {
  return {
    // ...
    isDefault: Boolean(raw.is_default),  // ← snake_case từ Printify
    // ...
  };
}
```

### Step 6 — Verify chain xuôi từ step-3 → step-5

End-to-end manual test:
1. Step-3: click "Tạo Mockups" → chờ poll done
2. Step-3: thấy gallery với 8 mockups (Royal Blue × 4 views + Gold × 4 views)
3. Step-3: tick include 4 mockups (Mặt trước cho mỗi màu × 2 colors = 4)
4. Click "Tiếp theo" sang step-4 → step-5
5. **Expected**: Step-5 carousel show 4 mockups, checklist "(2/2)", publish button enabled
6. **Now**: 0 mockups, checklist (0/0), button disabled

---

## 3. Migration / no-DB-change

**Không cần migration**. Schema đã đúng. Chỉ là code đọc sai.

---

## 4. Testing strategy

### Unit tests (must add)

`app/src/lib/wizard/__tests__/state.test.ts`:
```typescript
test("getDraft includes mockupJobs.images", async () => {
  const draft = await getDraft(testDraftId, testTenantId);
  expect(draft?.mockupJobs[0].images).toBeDefined();
  expect(Array.isArray(draft?.mockupJobs[0].images)).toBe(true);
});
```

`app/src/app/api/wizard/drafts/[id]/__tests__/checklist.test.ts`:
```typescript
test("buildChecklist counts included images per color", async () => {
  const draft = mockDraftWith({
    selectedColors: [{ title: "Royal Blue" }, { title: "Gold" }],
    mockupJobs: [{
      status: "completed",
      images: [
        { colorName: "Royal Blue", included: true, viewPosition: "front" },
        { colorName: "Gold", included: true, viewPosition: "front" },
      ],
    }],
  });
  const checklist = await buildChecklist(draft);
  expect(checklist.mockupsMatchColors).toBe(true);
});

test("returns false when 1 color missing mockup", async () => {
  const draft = mockDraftWith({
    selectedColors: [{ title: "Royal Blue" }, { title: "Gold" }],
    mockupJobs: [{
      status: "completed",
      images: [
        { colorName: "Royal Blue", included: true, viewPosition: "front" },
        // Gold không có
      ],
    }],
  });
  const checklist = await buildChecklist(draft);
  expect(checklist.mockupsMatchColors).toBe(false);
});
```

### Manual QA in Edge

1. Reset draft → tạo mới → step-1 chọn store
2. Step-2 chọn design
3. Step-3 chọn 2 màu → "Tạo Mockups" → tick include vài mockups
4. Step-4 generate AI content
5. **Step-5: verify**:
   - Mockup carousel hiển thị ảnh thật
   - Carousel navigation prev/next work
   - Label hiển thị "Royal Blue · Mặt trước" (Vietnamese)
   - Checklist all 4 items ✓
   - "Publish to Shopify & Printify" button enabled
6. Click publish → verify product created

---

## 5. Files cần sửa

```
✏️ app/src/lib/wizard/state.ts                          # Bug A
✏️ app/src/app/api/wizard/drafts/[id]/route.ts          # Bug C
✏️ app/src/app/(authed)/wizard/[draftId]/step-5/page.tsx  # Bug B
✏️ app/src/lib/printify/product.ts                      # Verify Bug D
🆕 app/src/lib/placement/labels.ts                      # viewLabel helper
✏️ app/src/components/mockup/MockupGallery.tsx          # Use viewLabel
✏️ app/src/app/(authed)/wizard/[draftId]/step-3/page.tsx # Use viewLabel
✏️ app/src/app/(authed)/listings/[id]/page.tsx          # Use viewLabel (nếu có)
```

---

## 6. Acceptance criteria

- ✅ Step-5 hiển thị mockup carousel có ảnh thật
- ✅ Checklist "Mockup khớp số màu (X/X)" với X = số colors đã chọn
- ✅ Publish button enabled khi đủ điều kiện
- ✅ Label tiếng Việt khắp nơi (front → Mặt trước, sleeve_left → Tay trái)
- ✅ Manual E2E test pass: tạo draft → publish thành công lên Shopify/Printify
- ✅ Unit tests pass cho `getDraft` + `buildChecklist`
- ✅ TypeScript: không có any errors
- ✅ Lint: không có warnings

---

## 7. Rollback plan

Nếu deploy gây regression:
- Revert 3 commits (state.ts, route.ts, step-5/page.tsx)
- Re-apply chỉ Step-4 (`viewLabel` helper) — independent, không break gì

---

## 8. Estimate

| Step | Effort |
|---|---|
| Step 1 — Backend getDraft include | 15m |
| Step 2 — buildChecklist fix | 30m |
| Step 3 — Frontend step-5 rewrite carousel | 1h |
| Step 4 — viewLabel helper + replace | 30m |
| Step 5 — Verify isDefault parser | 15m |
| Step 6 — E2E test + QA | 30m |
| Tests (unit) | 30m |
| **Total** | **3.5h** |

---

## 9. Liên quan

Bug này tách bạch với UI Improvement Plan trước đó. Sau khi fix bug này:
- Step-5 hiển thị mockups → có data để áp dụng UI improvements (visual consistency, Vietnamese labels)
- Sprint 1 của UI Improvement Plan có thể chạy song song

Recommend làm bug fix này TRƯỚC vì:
1. P0 blocking publish
2. Nhỏ (3.5h)
3. Không cần migration
4. Sprint 1 UI improvement sẽ thừa nếu data layer còn broken