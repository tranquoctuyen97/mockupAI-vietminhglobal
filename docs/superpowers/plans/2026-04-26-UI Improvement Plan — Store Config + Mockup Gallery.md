# UI Improvement Plan — Store Config + Mockup Gallery

**Scope**: Polish toàn bộ UI sau khi Phase C Printify backend đã code xong. Tập trung vào visual consistency, Vietnamese labels, và edge cases user-facing.

**Estimated effort**: 2-3 ngày engineering, chia nhỏ thành 3 sprint.

---

## Phần 1 — Mockup Gallery (Step-3 Wizard) 🔴 CRITICAL

User feedback chính: **gallery hiện tại trông như debug canvas, không phải mockup sản phẩm**. Live Preview đẹp realistic, nhưng tile thực tế ở gallery lại là ô màu phẳng có "front" tiếng Anh.

### Issue 1.1 — Visual disparity Live Preview ↔ Mockup tiles

**Hiện trạng**:
- Live Preview: SVG silhouette áo, có dashed print area, 4 view tabs
- Mockup tile: ô màu phẳng (Royal Blue/Gold), design tí hon ở giữa, label "front"

**Fix**:
- Nếu real Printify mockup URL có sẵn → render ảnh thật từ Printify (kết quả Phase C)
- Nếu chưa có (đang poll) hoặc fallback → render qua component giống `LivePreview` ở thumbnail size
- Cùng border-radius, border, padding với LivePreview để feel "cùng family"

**File cần sửa**: `app/src/components/mockup/MockupGallery.tsx`

```tsx
// Pseudocode
<MockupTile>
  {realPrintifyUrl ? (
    <img src={realPrintifyUrl} className="rounded-lg" />
  ) : (
    <LivePreview
      colorHex={tile.colorHex}
      designUrl={designUrl}
      placement={placementForView}
      printArea={areaForView}
      showTabs={false}    // Thumbnail không show tabs
      height={180}        // Compact
      initialView={tile.viewPosition}
    />
  )}
</MockupTile>
```

### Issue 1.2 — Tile labels English thay vì Vietnamese

**Hiện trạng**: Label "front" dưới mỗi tile (English raw value từ DB).

**Fix**: Tạo helper `viewLabel(position)` và dùng khắp nơi:

```tsx
// app/src/lib/placement/labels.ts (NEW)
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

Replace mọi chỗ render raw `viewPosition`:
- `MockupGallery.tsx`
- `MockupCard.tsx` (nếu có)
- Step-5 review carousel
- Listing detail page

### Issue 1.3 — Tiles không hiển thị view khác nhau

**Hiện trạng**: Store có placement preset 4 vị trí (Front/Back/Sleeve L/Sleeve R), nhưng gallery toàn show "front". Nguyên nhân: backend `/api/mockup-jobs/route.ts` (cũ) chỉ hardcode `position: "front"` trong `imagesToProcess.push({...})`.

**Fix backend**: 
- Sau Phase C dùng Printify Product API, response `images[]` đã có `position` phong phú (front/back/sleeve_left/...)
- Worker save đúng `viewPosition` từ Printify response → MockupImage table có đủ 4 views

**Fix frontend**:
- Group `MockupImage[]` by `(variantId, colorName)` rồi sub-group by `viewPosition`
- Mỗi color block hiển thị 4 mini-tiles theo views

### Issue 1.4 — Banner khi mockups outdated

**Hiện trạng**: User edit placement xong, mockup cũ vẫn show 1 view → confusing.

**Fix**: Check `MockupImage.createdAt` vs `WizardDraft.placementOverride` updated time. Nếu placement mới hơn:

```tsx
{isOutdated && (
  <div className="alert alert-warning">
    ⚠️ Mockup cũ không khớp placement hiện tại.
    <button onClick={handleRegenerate}>Tạo lại mockup →</button>
  </div>
)}
```

Hoặc đơn giản hơn: dùng flag `mockupsStale` đã có sẵn trong `WizardDraft` schema.

### Issue 1.5 — Tile size + grid layout

**Hiện trạng**: Tile lớn ~200×200px, 2-3 cột, cảm giác "loãng".

**Fix**:
```tsx
<div className="grid grid-cols-4 gap-2">
  <MockupTile size={140} radius="md" border="0.5px" />
</div>
```

Layout target:
- Per color block: 4 thumbnails compact (140×140px each)
- Header color name + swatch (24×24px circle)
- Compact footer label (Mặt trước, Mặt sau, ...) — text-only, không bar đậm

### Issue 1.6 — Selection state rõ ràng

**Hiện trạng**: Circle chọn yếu, hard to scan.

**Fix**:
- Unselected: empty circle 18×18px, border 0.5px, opacity 0.4
- Selected: circle filled green-wise, white check icon ✓
- Default mockup (auto-included): badge "Default" ở top-right
- Hover: scale 1.02 + soft shadow

```tsx
<MockupTile className="relative">
  {isDefault && <Badge>Default</Badge>}
  <SelectionIndicator selected={isSelected} />
  <img />
  <FooterLabel>{viewLabel(position)}</FooterLabel>
</MockupTile>
```

---

## Phần 2 — Placement Tab (Store Config) 🟡 P1

### Issue 2.1 — Print area dimensions identical cho mọi view 🔴 CRITICAL

**Hiện trạng**: Front/Back/Sleeve/Neck đều vẽ rectangle 355.6×406.4 mm. Sleeve thực tế chỉ ~110×110 mm.

**Fix**: 
- Đọc `placeholders[].width / height` từ Printify Catalog API (đã có trong `Variant.placeholders`)
- Cache vào `StoreMockupTemplate.printAreasByView` JSON field:
  ```json
  {
    "front": { "widthMm": 355.6, "heightMm": 406.4, "safeMarginMm": 12.7 },
    "back": { "widthMm": 355.6, "heightMm": 406.4, "safeMarginMm": 12.7 },
    "sleeve_left": { "widthMm": 110, "heightMm": 110, "safeMarginMm": 5 },
    "sleeve_right": { "widthMm": 110, "heightMm": 110, "safeMarginMm": 5 },
    "neck_label": { "widthMm": 50, "heightMm": 60, "safeMarginMm": 3 }
  }
  ```
- `MultiViewPlacementEditor` đọc print area theo active view, không hardcode default

**Migration**:
```sql
ALTER TABLE store_mockup_templates 
  ADD COLUMN print_areas_by_view JSONB DEFAULT '{}';
```

Backfill: với existing stores, fetch placeholders từ Printify API và populate.

### Issue 2.2 — Color switcher trên canvas

**Hiện trạng**: bgColor chỉ lấy `colors[0].hex`. Không thấy placement trên màu khác.

**Fix**: Thêm color dot picker compact (giống Printify Variants panel):

```tsx
<div className="flex items-center gap-2 mb-3">
  <span className="text-xs opacity-60">Xem trên màu:</span>
  {enabledColors.map(c => (
    <button
      onClick={() => setBgColor(c.hex)}
      style={{
        width: 24, height: 24, borderRadius: "50%",
        backgroundColor: c.hex,
        border: bgColor === c.hex ? "2px solid var(--text-primary)" : "1px solid var(--border-default)",
      }}
      title={c.name}
    />
  ))}
</div>
```

### Issue 2.3 — Print area visualization (dashed lines)

**Hiện trạng**: Solid rectangle outline, không match Printify.

**Fix**: 2 đường dashed như Printify:
- Outer: print boundary (`stroke-dasharray="6,4"`)
- Inner: safety margin (`stroke-dasharray="3,3"`, lighter)
- Có thể cần update Konva renderer trong `PlacementEditor.tsx`

### Issue 2.4 — Preset library cho non-Front views

**Hiện trạng**:
- Front: 3 preset (Full front, Ngực trái, Ngực giữa)
- Back: 1 preset (Full back)
- Sleeve L/R: 0 preset thật (chỉ tên duplicate)
- Neck: 0 preset

**Fix**: Mở rộng `PLACEMENT_PRESETS` cho mỗi view:

```typescript
const PLACEMENT_PRESETS = {
  front: [
    { key: "full_front", label: "Full front", placement: { xMm: 77.8, yMm: 78.2, w: 200, h: 250 } },
    { key: "left_chest", label: "Ngực trái", ... },
    { key: "center_chest", label: "Ngực giữa", ... },
    { key: "logo_top", label: "Logo trên cao", ... },
  ],
  back: [
    { key: "full_back", label: "Full back", ... },
    { key: "center_back", label: "Center back", ... },
    { key: "yoke", label: "Yoke (cổ sau)", ... },
  ],
  sleeve_left: [
    { key: "logo_sleeve", label: "Logo nhỏ", placement: { xMm: 30, yMm: 30, w: 50, h: 50 } },
    { key: "center_sleeve", label: "Center", ... },
  ],
  sleeve_right: [...same as left, mirrored],
  neck_label: [
    { key: "neck_logo", label: "Logo cổ", placement: { xMm: 5, yMm: 5, w: 40, h: 50 } },
  ],
};
```

### Issue 2.5 — Empty state khi view tắt

**Hiện trạng**: 2 button "+ Bật Tay trái" duplicate (canvas + right panel).

**Fix**: Chỉ giữ 1 button ở canvas center, right panel hiển thị placeholder "Bật vị trí để chỉnh preset".

### Issue 2.6 — Save button dirty state tracking

**Hiện trạng**: "Lưu Placement" button always enabled.

**Fix**: Track diff vs initial state, disable + tooltip "Chưa có thay đổi":

```typescript
const [initialPlacement] = useState(normalizePlacementData(store.template?.defaultPlacement, true));
const isDirty = JSON.stringify(initialPlacement) !== JSON.stringify(placementData);

<button disabled={!isDirty}>Lưu Placement</button>
```

---

## Phần 3 — Màu sắc Tab 🟡 P2

### Issue 3.1 — 50+ pills flat list

**Fix**: Thêm filter input + group by color family:

```tsx
<input placeholder="Tìm màu..." value={search} onChange={...} />

{COLOR_GROUPS.map(group => (
  <div key={group.name}>
    <h4>{group.name}</h4> {/* "Tối/Đen", "Sáng/Trắng", "Pastel", v.v. */}
    <div className="flex flex-wrap gap-2">
      {filteredColors.filter(c => isInGroup(c, group)).map(c => <ColorPill ... />)}
    </div>
  </div>
))}
```

Color grouping logic dựa trên HSL của `hex` (lightness > 70 = Sáng, < 30 = Tối, etc.).

### Issue 3.2 — Sizes inline quá dài

**Fix**: Bỏ ra tooltip on hover:

```tsx
<button title={`Kích thước: ${g.sizes.join(", ")}`}>
  <Swatch />
  <span>{g.color}</span>
  <span className="opacity-40 text-xs">({g.sizes.length} sizes)</span>
</button>
```

### Issue 3.3 — Color swatch quá nhỏ

**Fix**: Tăng từ 16×16 → 24×24 (vẫn compact, nhưng dễ phân biệt similar colors).

### Issue 3.4 — Persist scroll position khi switch tab

**Fix**: Save scroll position vào URL hash hoặc sessionStorage:

```tsx
useEffect(() => {
  const saved = sessionStorage.getItem(`colors-scroll-${store.id}`);
  if (saved) listRef.current.scrollTop = parseInt(saved);
  return () => {
    sessionStorage.setItem(`colors-scroll-${store.id}`, String(listRef.current?.scrollTop ?? 0));
  };
}, []);
```

### Issue 3.5 — Disable save khi không thay đổi

**Fix**: Track initial selected vs current:

```typescript
const isDirty = !setEquals(initialSelected, selected);
<button disabled={!isDirty || saving}>Lưu màu sắc ({selected.size})</button>
```

---

## Phần 4 — Blueprint Tab 🟢 P3

### Issue 4.1 — Thumbnail/brand không hiển thị trong saved view

**Fix**: Cache vào DB hoặc fetch ngay khi page load:

Option A — Cache (recommended):
```sql
ALTER TABLE store_mockup_templates 
  ADD COLUMN blueprint_image_url TEXT,
  ADD COLUMN blueprint_brand TEXT;
```

Update khi user save Blueprint:
```typescript
await prisma.storeMockupTemplate.update({
  data: {
    blueprintImageUrl: selectedBp.images?.[0],
    blueprintBrand: selectedBp.brand,
    // ... other fields
  }
});
```

Option B — Fetch ngay khi component mount (1 API call, không cần migration).

### Issue 4.2 — Show key product specs

**Fix**: Thêm sub-text dưới blueprint title:

```tsx
<div>
  <div className="font-bold">{displayBpTitle}</div>
  <div className="text-xs opacity-50">
    {displayBpBrand} • {displayBpModel} • {variantCount} variants
  </div>
</div>
```

---

## Phần 5 — Tổng quan Tab 🟢 P3

### Issue 5.1 — Shop ID hiển thị CUID không readable

**Fix**: Thay `Shop #cmo6hebtt00037wt01ocu1gij` (DB CUID) bằng Printify shop name:

```tsx
<span>{store.printifyShopTitle ?? `Shop #${store.printifyShopId}`}</span>
```

Cần cache `printifyShopTitle` vào `Store` table khi user connect.

### Issue 5.2 — Last sync timestamp

**Fix**: Show `lastHealthCheck` field (đã có schema):
```tsx
<div>Lần kiểm tra cuối: {formatRelativeTime(store.lastHealthCheck)}</div>
```

### Issue 5.3 — Placement summary nhiều views

**Fix**: Show "Placement" detail thay vì "1 vị trí: Mặt trước" → list cụ thể:
```tsx
<span>Mặt trước, Mặt sau (2 vị trí)</span>
```

---

## Phần 6 — Layout chung 🟢 P3

### Issue 6.1 — Page width dãn full → loãng

**Fix**: 
```css
.main-content {
  max-width: 1280px;
  margin: 0 auto;
}
```

### Issue 6.2 — Tab bar không responsive

**Fix**: Mobile breakpoint → tabs scroll horizontal hoặc dropdown:
```tsx
<div className="overflow-x-auto md:overflow-x-visible">
  {tabs.map(...)}
</div>
```

### Issue 6.3 — Min-height fix layout overflow

**Fix**:
```css
.config-page { min-height: calc(100vh - 80px); }
```

---

## 📅 Sprint plan

### Sprint 1 (1.5 ngày) — Mockup Gallery overhaul 🔴
- [x] Phase C backend (đã xong)
- [ ] Issue 1.1 — Visual consistency với LivePreview component
- [ ] Issue 1.2 — Vietnamese labels (`viewLabel` helper, replace tất cả)
- [ ] Issue 1.3 — Group by view per color (4 cards/color)
- [ ] Issue 1.4 — Outdated banner
- [ ] Issue 1.5 — Tile size + 4-col grid
- [ ] Issue 1.6 — Selection state với check icon + default badge

### Sprint 2 (1 ngày) — Placement critical fixes 🟡
- [ ] Issue 2.1 — Dynamic print area per view (CRITICAL)
- [ ] Issue 2.2 — Color switcher
- [ ] Issue 2.3 — Dashed lines + safety margin
- [ ] Issue 2.4 — Preset library expansion
- [ ] Issue 2.5 — Single empty state button
- [ ] Issue 2.6 — Dirty state tracking

### Sprint 3 (0.5 ngày) — Polish 🟢
- [ ] Issue 3.x — Màu sắc filter + group + tooltip + dirty
- [ ] Issue 4.x — Blueprint cached metadata
- [ ] Issue 5.x — Tổng quan readable Shop ID, last sync
- [ ] Issue 6.x — Layout max-width, responsive tabs

---

## 🎯 Success criteria

Sau 3 sprint, user cảm nhận:
1. **Mockup Gallery feel realistic** — không còn "ô màu phẳng"
2. **Vietnamese 100% UI** — không còn raw "front/back" leak ra
3. **Placement đúng physics** — sleeve area phải nhỏ, neck phải rất nhỏ
4. **Switch màu mượt** — preview update instant khi click color dot
5. **Selection state clear** — luôn biết tile nào đã chọn, tile nào default
6. **Save buttons honest** — disabled khi không có thay đổi

---

## 🚧 Risk & dependencies

- **Phase C status**: Sprint 1 hiệu quả cao nhất khi Phase C real Printify mockups đã work. Nếu chưa, Sprint 1 dùng LivePreview làm thumbnail (still better than flat squares).
- **Migration cho `printAreasByView`**: cần backfill cho existing stores. Nếu Printify Catalog rate limit, batch async.
- **Color grouping algorithm**: HSL classification cần tune — vài màu Printify có hex weird (vd "Heather" có 2 colors mix). Test với real data.

---

## 📂 Files cần sửa

```
app/src/components/mockup/
  MockupGallery.tsx             # Sprint 1.1, 1.3, 1.5, 1.6
  MockupCard.tsx                # Sprint 1.6 (selection state)
  
app/src/components/placement/
  MultiViewPlacementEditor.tsx  # Sprint 2.1, 2.2, 2.4
  PlacementEditor.tsx           # Sprint 2.3 (dashed lines)
  
app/src/lib/placement/
  labels.ts (NEW)               # Sprint 1.2 (viewLabel helper)
  presets.ts                    # Sprint 2.4 (expand presets)
  views.ts                      # Sprint 5.3 (summary format)

app/src/app/(authed)/stores/[id]/config/page.tsx
  ColorsTab                     # Sprint 3.x
  BlueprintTab                  # Sprint 4.x
  SettingsTab                   # Sprint 5.x

app/src/app/(authed)/wizard/[draftId]/step-3/page.tsx
  Banner outdated mockups       # Sprint 1.4

app/prisma/schema.prisma
  StoreMockupTemplate           # Sprint 2.1, 4.1
  
app/prisma/migrations/
  20260427_print_areas_by_view.sql
  20260427_blueprint_metadata_cache.sql
```

---

## 📊 Estimate breakdown

| Sprint | Tasks | Hours | Days |
|---|---|---|---|
| 1 | Mockup Gallery (6 issues) | 10-14h | 1.5 |
| 2 | Placement (6 issues) | 6-8h | 1 |
| 3 | Polish (3 areas, ~10 issues) | 3-5h | 0.5 |
| Tests + QA | All sprints | 2-4h | 0.3 |
| **Total** | | **21-31h** | **2.5-3.5 days** |