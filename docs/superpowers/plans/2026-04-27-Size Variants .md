# Amendment v2 — Size Variants Plan (Cost Data via Dummy Product)

**Status**: 🔴 CRITICAL FIX — Plan v1 sai assumption về Catalog API.
**Verified**: User confirm + tôi đọc `lib/printify/types.ts` line 28-33 chỉ có `id, title, options, placeholders`.
**Decision**: Option C — Dummy product strategy.

---

## 1. Confirm bug trong plan v1

### Plan v1 sai
```typescript
// SIZE_VARIANTS_IMPLEMENTATION_PLAN.md §4.1
costCents: Math.round((v.cost ?? 0) * 100),  // ❌ v.cost = undefined!
isAvailable: v.is_available !== false,       // ❌ v.is_available = undefined → always true!
```

### Reality
**Printify Catalog API** `GET /v1/catalog/blueprints/5/print_providers/29/variants.json`:
```json
{
  "id": 17391,
  "title": "Heather Grey / S",
  "options": { "color": "Heather Grey", "size": "S" },
  "placeholders": [...],
  "decoration_methods": ["dtg"]
}
```
→ KHÔNG có `cost`, `is_available`, `sku`, `color_hex`.

**Printify Shop Product API** `GET /v1/shops/{shopId}/products/{productId}.json`:
```json
{
  "variants": [
    {
      "id": 17391,
      "sku": "BC3001-HG-S-1234",
      "cost": 1409,            // ← cents
      "price": 2500,
      "is_enabled": true,
      "is_available": true,
      "is_default": false,
      "options": [3, 19]
    }
  ]
}
```
→ Cost data đầy đủ, NHƯNG yêu cầu **product đã được tạo** trên Printify.

### Hệ quả nếu ship plan v1
- `costCents = 0` cho mọi variant
- `costDeltaCents = 0` → UI không hiển thị "+$2", "+$4"
- Per-variant pricing fail → 3XL+ bán giá flat → seller lỗ
- `is_available` luôn true → không disable variants out-of-stock

---

## 2. Option C — Dummy product strategy

### Flow

```
┌───────────────────────────────────────────────────────────┐
│ ADMIN: Save Blueprint trong Store Config                   │
│   1. POST /api/stores/{id}/template (existing)             │
│   2. Trigger ensureVariantCostCache(bp, pp) async          │
│      ↓                                                      │
│   3. Check PrintifyVariantCache TTL                        │
│      ├─ Fresh (<7 ngày) → return cached                    │
│      └─ Missing/stale:                                     │
│         a. Create dummy Printify product                   │
│            POST /shops/{shopId}/products.json              │
│            with placeholder design + all blueprint variants│
│         b. Read response.variants[]                        │
│            → has cost, is_available, sku, color_hex        │
│         c. UPSERT PrintifyVariantCache                     │
│         d. DELETE dummy product                            │
│            DELETE /shops/{shopId}/products/{id}.json       │
│         e. Cache stored, ready for use                     │
└───────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────┐
│ STORE CONFIG UI: Show sizes với cost                       │
│   - Read from PrintifyVariantCache (no API call)           │
│   - Group by size, compute deltaCents                      │
│   - Display checkbox + price + delta                       │
└───────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────┐
│ WIZARD STEP-3: Show sizes selectable                       │
│   - Read from PrintifyVariantCache (no API call)           │
└───────────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────┐
│ PUBLISH: Compute per-variant prices                        │
│   - Read from PrintifyVariantCache                         │
│   - basePriceCents + deltaCents per variant                │
│   - Pass to Printify Publish API                           │
└───────────────────────────────────────────────────────────┘
```

### Trade-offs

| Aspect | Trade-off |
|---|---|
| **API calls** | +2 calls 1 lần khi setup (POST + DELETE). Cache 7 ngày. |
| **Time cost** | ~2-5s khi save Blueprint lần đầu (admin chờ). Async OK. |
| **Risk** | Nếu DELETE fail → orphan product trên Printify dashboard. Có cleanup cron. |
| **Stale data** | Printify đổi giá → cache stale 7 ngày max. Add manual "Refresh giá" button. |
| **Concurrency** | 2 admin save Blueprint cùng lúc → dùng DB compound key + ON CONFLICT. |

---

## 3. Updated types

### `lib/printify/types.ts`

```typescript
// EXISTING — Catalog Variant (4 fields)
export interface CatalogVariant {
  id: number;
  title: string;
  options: Record<string, string>;
  placeholders: Placeholder[];
}

// NEW — Shop Product Variant (10 fields)
export interface ShopProductVariant {
  id: number;
  sku: string;
  cost: number;           // cents
  price: number;          // cents
  title?: string;
  grams: number;
  is_enabled: boolean;
  is_default: boolean;
  is_available: boolean;
  options: number[];      // option value IDs
}

// Backward-compat alias — keep "Variant" as Catalog version
export type Variant = CatalogVariant;
```

### `lib/printify/client.ts` — Add type to product response

```typescript
export interface PrintifyProduct {
  id: string;
  title: string;
  description: string;
  variants: ShopProductVariant[];   // ← add this
  images: PrintifyProductImage[];
  external?: { id: string; handle: string; };
  // ... other fields
}
```

---

## 4. New function — `fetchVariantCostsViaDummyProduct`

**File**: `app/src/lib/printify/variant-catalog.ts` (UPDATED)

```typescript
import { prisma } from "@/lib/db";
import type { PrintifyClient } from "./client";
import type { ShopProductVariant, CatalogVariant } from "./types";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const DUMMY_PRODUCT_TITLE_PREFIX = "[INTERNAL_COST_LOOKUP]";

export interface CachedVariant {
  variantId: number;
  colorName: string;
  colorHex: string | null;
  size: string;
  sku: string | null;
  costCents: number;
  isAvailable: boolean;
}

/**
 * Ensure variant cost cache exists for blueprint+provider.
 * Creates dummy product on Printify to fetch costs, then deletes it.
 *
 * Idempotent: if cache fresh (<7 days), no-op.
 * Concurrent-safe: DB upsert with compound key.
 */
export async function ensureVariantCostCache(input: {
  client: PrintifyClient;
  shopId: number;
  blueprintId: number;
  printProviderId: number;
  forceRefresh?: boolean;
}): Promise<CachedVariant[]> {
  const { client, shopId, blueprintId, printProviderId, forceRefresh } = input;

  // 1. Check cache freshness
  if (!forceRefresh) {
    const cached = await prisma.printifyVariantCache.findMany({
      where: { blueprintId, printProviderId },
    });
    if (cached.length > 0) {
      const oldest = cached.reduce(
        (o, v) => (v.fetchedAt < o ? v.fetchedAt : o),
        new Date(),
      );
      if (Date.now() - oldest.getTime() < CACHE_TTL_MS) {
        return cached.map(toCachedVariant);
      }
    }
  }

  // 2. Fetch catalog variants (chỉ có id, title, options, placeholders)
  const catalogResponse = await client.getBlueprintVariants(
    blueprintId,
    printProviderId,
  );
  const catalogVariants = catalogResponse.variants;

  if (catalogVariants.length === 0) {
    throw new Error(`No variants found for blueprint ${blueprintId} / provider ${printProviderId}`);
  }

  // 3. Build dummy product payload (all variants enabled, $0 price)
  const dummyImageId = await uploadDummyDesignImage(client);

  const dummyPayload = {
    title: `${DUMMY_PRODUCT_TITLE_PREFIX} ${blueprintId}/${printProviderId} ${Date.now()}`,
    description: "Internal product to fetch variant costs. Auto-deleted.",
    blueprint_id: blueprintId,
    print_provider_id: printProviderId,
    variants: catalogVariants.map((v) => ({
      id: v.id,
      price: 100, // $1.00 placeholder
      is_enabled: true,
    })),
    print_areas: [
      {
        variant_ids: catalogVariants.map((v) => v.id),
        placeholders: [
          {
            position: "front",
            images: [
              {
                id: dummyImageId,
                x: 0.5,
                y: 0.5,
                scale: 0.1, // small placement to minimize processing
                angle: 0,
              },
            ],
          },
        ],
      },
    ],
  };

  // 4. Create dummy product
  let dummyProduct: any = null;
  try {
    dummyProduct = await client.createProduct(shopId, dummyPayload);

    // 5. Read variants array — has cost, sku, is_available, etc.
    const shopVariants = (dummyProduct.variants ?? []) as ShopProductVariant[];

    // 6. Build option_id → option_value lookup from blueprint
    // Printify variants[].options là array số (option value IDs)
    // Cần map về (color name, size, color_hex) từ blueprint metadata
    const optionLookup = await buildOptionValueLookup(
      client,
      blueprintId,
      printProviderId,
    );

    // 7. Merge catalog (color/size names) + shop (cost/availability)
    const merged: CachedVariant[] = catalogVariants.map((cv) => {
      const sv = shopVariants.find((s) => s.id === cv.id);
      const optionIds = sv?.options ?? [];
      const colorOption = optionIds
        .map((id) => optionLookup.get(id))
        .find((o) => o?.type === "color");
      const colorHex = colorOption?.colors?.[0] ?? null;

      return {
        variantId: cv.id,
        colorName: cv.options.color ?? "Unknown",
        colorHex,
        size: cv.options.size ?? "ONE_SIZE",
        sku: sv?.sku ?? null,
        costCents: sv?.cost ?? 0,
        isAvailable: sv?.is_available ?? true,
      };
    });

    // 8. UPSERT cache
    await prisma.$transaction([
      prisma.printifyVariantCache.deleteMany({
        where: { blueprintId, printProviderId },
      }),
      prisma.printifyVariantCache.createMany({
        data: merged.map((v) => ({
          blueprintId,
          printProviderId,
          variantId: v.variantId,
          colorName: v.colorName,
          colorHex: v.colorHex,
          size: v.size,
          sku: v.sku,
          costCents: v.costCents,
          isAvailable: v.isAvailable,
        })),
      }),
    ]);

    return merged;
  } finally {
    // 9. Cleanup — DELETE dummy product (always, even on error)
    if (dummyProduct?.id) {
      try {
        await client.deleteProduct(shopId, dummyProduct.id);
      } catch (err) {
        // Log but don't throw — orphan cleanup will retry via cron
        console.warn(
          `[variant-cache] Failed to delete dummy product ${dummyProduct.id}:`,
          err,
        );
      }
    }
  }
}

/**
 * Get/create a small placeholder PNG for dummy products.
 * Cached at tenant level — only 1 upload per tenant.
 */
async function uploadDummyDesignImage(client: PrintifyClient): Promise<string> {
  // 1x1 transparent PNG (smallest valid PNG)
  const TRANSPARENT_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

  const result = await client.uploadImageBase64({
    fileName: "dummy_cost_lookup.png",
    contentsBase64: TRANSPARENT_PNG_BASE64,
  });
  return result.id;
}

/**
 * Get blueprint option metadata để map color name → hex.
 * Printify exposes via blueprint detail endpoint.
 */
async function buildOptionValueLookup(
  client: PrintifyClient,
  blueprintId: number,
  printProviderId: number,
): Promise<Map<number, { type: string; title: string; colors?: string[] }>> {
  // GET /v1/catalog/blueprints/{id}/print_providers/{pp}.json
  // Response.options[] có structure:
  //   { name: "colors", type: "color", values: [{id, title, colors:["#hex"]}] }
  //   { name: "sizes",  type: "size",  values: [{id, title}] }
  const detail = await client.getProviderDetail(blueprintId, printProviderId);
  const lookup = new Map<number, { type: string; title: string; colors?: string[] }>();

  for (const option of detail.options ?? []) {
    for (const value of option.values ?? []) {
      lookup.set(value.id, {
        type: option.type,
        title: value.title,
        colors: value.colors,
      });
    }
  }
  return lookup;
}

function toCachedVariant(row: any): CachedVariant {
  return {
    variantId: row.variantId,
    colorName: row.colorName,
    colorHex: row.colorHex,
    size: row.size,
    sku: row.sku,
    costCents: row.costCents,
    isAvailable: row.isAvailable,
  };
}

// ─── Existing helpers (groupSizes, computeVariantMatrix) ──────────────────────
// Logic giữ nguyên, chỉ đổi data source từ getCachedVariants → ensureVariantCostCache

export function groupSizes(variants: CachedVariant[]) { /* same as v1 */ }
export function computeVariantMatrix(variants, colors, sizes) { /* same as v1 */ }
```

### Add new methods to `PrintifyClient`

**File**: `lib/printify/client.ts` (UPDATED)

```typescript
async createProduct(shopId: number, payload: any): Promise<any> {
  return this.request(`/shops/${shopId}/products.json`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async deleteProduct(shopId: number, productId: string): Promise<void> {
  await this.request(`/shops/${shopId}/products/${productId}.json`, {
    method: "DELETE",
  });
}

async getProviderDetail(
  blueprintId: number,
  printProviderId: number,
): Promise<{ options: Array<{ name: string; type: string; values: Array<{ id: number; title: string; colors?: string[] }> }> }> {
  return this.request(
    `/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}.json`,
  );
}

async uploadImageBase64(input: { fileName: string; contentsBase64: string }): Promise<{ id: string }> {
  return this.request("/uploads/images.json", {
    method: "POST",
    body: JSON.stringify({
      file_name: input.fileName,
      contents: input.contentsBase64,
    }),
  });
}
```

---

## 5. Trigger points

### A. Khi admin save Blueprint trong Store Config

**File**: `app/src/app/api/stores/[id]/template/route.ts`

```typescript
// In PATCH handler, after updating template
if (data.printifyBlueprintId !== undefined || data.printifyPrintProviderId !== undefined) {
  // Trigger cost cache fetch async (don't block response)
  const { client, externalShopId } = await getClientForStore(storeId);
  ensureVariantCostCache({
    client,
    shopId: externalShopId,
    blueprintId: data.printifyBlueprintId ?? template.printifyBlueprintId,
    printProviderId: data.printifyPrintProviderId ?? template.printifyPrintProviderId,
  }).catch((err) => {
    console.error(`[cost-cache] Failed for store ${storeId}:`, err);
    // Non-fatal — cache will be retried next time API endpoint reads it
  });
}
```

### B. Khi `/api/stores/[id]/sizes` GET endpoint được call

**File**: `app/src/app/api/stores/[id]/sizes/route.ts`

```typescript
export async function GET(...) {
  // ... auth ...
  const store = await prisma.store.findFirst({...});
  
  const { client, externalShopId } = await getClientForStore(storeId);
  
  // Lazy-load cost cache (creates dummy product if needed)
  const variants = await ensureVariantCostCache({
    client,
    shopId: externalShopId,
    blueprintId: store.template.printifyBlueprintId,
    printProviderId: store.template.printifyPrintProviderId,
  });
  
  const sizes = groupSizes(variants);
  return NextResponse.json({ sizes, enabledSizes: store.template.enabledSizes });
}
```

### C. Manual refresh button

Admin variants tab thêm button:
```tsx
<button onClick={async () => {
  await fetch(`/api/stores/${store.id}/variant-cache/refresh`, { method: "POST" });
  toast.success("Đã cập nhật giá từ Printify");
}}>
  Refresh giá Printify
</button>
```

Endpoint: `/api/stores/[id]/variant-cache/refresh` calls `ensureVariantCostCache(forceRefresh: true)`.

---

## 6. Cleanup orphan dummy products

**File**: `app/src/lib/cron/cleanup-orphan-dummy-products.ts` (NEW)

```typescript
/**
 * Daily cron — find orphan dummy products on Printify (DELETE failed)
 * và cleanup. Match by title prefix.
 */
export async function cleanupOrphanDummyProducts() {
  const stores = await prisma.store.findMany({
    where: { printifyShopId: { not: null } },
    select: { id: true, printifyShopId: true },
  });

  for (const store of stores) {
    try {
      const { client, externalShopId } = await getClientForStore(store.id);
      const products = await client.getProducts(externalShopId, { limit: 100 });
      
      const orphans = products.filter(p =>
        p.title.startsWith(DUMMY_PRODUCT_TITLE_PREFIX)
      );
      
      for (const orphan of orphans) {
        try {
          await client.deleteProduct(externalShopId, orphan.id);
        } catch (e) {
          console.warn(`Failed to delete orphan ${orphan.id}:`, e);
        }
      }
    } catch (e) {
      console.error(`Orphan cleanup failed for store ${store.id}:`, e);
    }
  }
}
```

Schedule: chạy daily 3 AM.

---

## 7. Failure modes + UX fallback

### Trường hợp `ensureVariantCostCache` fail

**Nguyên nhân**:
- Printify API down
- Rate limit
- Auth error
- Blueprint không support tạo product (rare)

**Fallback strategy**:
```typescript
try {
  const variants = await ensureVariantCostCache(...);
  return { sizes: groupSizes(variants), pricing: "computed" };
} catch (err) {
  // Fallback: use catalog variants WITHOUT cost data
  const catalog = await client.getBlueprintVariants(bp, pp);
  const sizes = groupSizesFromCatalog(catalog.variants);  // size only, no cost
  return {
    sizes,
    pricing: "unavailable",
    warning: "Không lấy được giá Printify. Variants vẫn dùng được, nhưng size delta sẽ = $0."
  };
}
```

UI hiển thị warning banner:
```
⚠ Tạm thời không lấy được giá Printify.
   Bạn vẫn có thể chọn sizes, nhưng giá size lớn (3XL+) sẽ không tự cộng delta.
   [Thử lại] · [Liên hệ support]
```

→ Seller vẫn có thể work, không bị block.

---

## 8. Updated Sprint plan

### Sprint 1 — Schema + Variant cache infrastructure (5-6h, +1h vs v1)

- [ ] DB migration `20260427_add_size_variants.sql` (same as v1)
- [ ] Prisma schema update (same as v1)
- [ ] **NEW**: Update `lib/printify/types.ts` — add `ShopProductVariant`, `PrintifyProduct`
- [ ] **NEW**: `lib/printify/client.ts` — add `createProduct`, `deleteProduct`, `getProviderDetail`, `uploadImageBase64`
- [ ] **NEW**: `lib/printify/variant-catalog.ts` — implement `ensureVariantCostCache` với dummy product flow
- [ ] **NEW**: Unit tests for `ensureVariantCostCache` với mocked Printify client
  - Test cache hit (no API call)
  - Test cache miss (creates dummy → fetches → deletes → caches)
  - Test failure recovery (DELETE fail → logs warning, doesn't throw)
  - Test concurrent calls (DB upsert handles race)

### Sprint 2 — API endpoints (3-4h)

- [ ] `/api/stores/[id]/sizes` GET (lazy-trigger cache)
- [ ] `/api/stores/[id]/variant-cache/refresh` POST (force refresh)
- [ ] PATCH `/api/stores/[id]/template` — trigger cache async khi đổi blueprint
- [ ] PATCH `/api/wizard/drafts/[id]` — accept enabledSizes, recompute matrix

### Sprint 3 — Frontend (4-5h)

(same as v1 plan §5)

### Sprint 4 — Publish flow (3-4h)

- [ ] `buildVariantPricing` (same as v1)
- [ ] Update `buildPrintifyProductPayload`
- [ ] **NEW**: Force refresh cache trước publish (đảm bảo cost data fresh)
- [ ] Update worker.ts

### Sprint 5 — Cleanup + edge cases (2-3h, +1h vs v1)

- [ ] **NEW**: Cron `cleanup-orphan-dummy-products` daily 3 AM
- [ ] **NEW**: UI warning banner cho fallback case
- [ ] **NEW**: Manual "Refresh giá" button
- [ ] QA E2E:
  - First time admin save Blueprint → wait dummy product flow (~3s) → variants cached
  - Subsequent loads → use cache (instant)
  - Force refresh works
  - Concurrent save (2 admin tabs) handled

**Total: 17-22h ≈ 2.5-3 ngày** (vs 12-16h trong v1)

---

## 9. Risk assessment update

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dummy product creation fail (API down) | Medium | Medium | Fallback no-cost mode + warning banner |
| Dummy product DELETE fail (orphan) | Low | Low | Daily cron cleanup, idempotent |
| Concurrent admin save → 2 dummy products | Low | Low | DB compound key + UPSERT |
| Printify rate limit (5+ stores save simultaneously) | Low | Medium | Sequential queue per tenant |
| Cost data stale (Printify changes prices) | Medium | Low | 7-day TTL + manual refresh button |
| Dummy product visible in Printify dashboard window (~2-5s) | Low | Very low | Title prefix `[INTERNAL_COST_LOOKUP]` makes it obvious |
| Print Provider doesn't allow product creation | Low | High | Catch error, fallback no-cost mode |

---

## 10. Open questions

1. **Dummy product placement**: Plan dùng `placeholders[].images[]` với 1 dummy image. Có thể lighter — Printify cho phép tạo product KHÔNG có print_areas? Cần verify để bypass image upload step.

2. **Tenant-level vs store-level dummy image**: Plan upload 1 dummy image per `ensureVariantCostCache` call. Nên cache `dummyImageId` vào tenant settings để reuse?

3. **API quota**: Printify free tier có rate limit. Tạo dummy product có count vào quota không? Nếu có → throttle ở app level.

4. **Test in staging first**: Trước khi prod, test với Printify sandbox account (nếu có) để verify dummy creation flow không gây side effect (vd webhook fire).

---

## 11. Acceptance criteria (updated)

- ✅ Khi admin save Blueprint mới → dummy product tự create, cache populated, dummy deleted (within 5s)
- ✅ Subsequent calls đọc từ cache, không tạo dummy
- ✅ Cache TTL 7 ngày auto-refresh
- ✅ "Refresh giá" button force update
- ✅ Daily cron cleanup orphan products
- ✅ Fallback works khi Printify down → seller vẫn dùng được
- ✅ Per-variant pricing chuẩn khi publish (dùng cost từ cache)
- ✅ E2E flow Color × Size publish thành công

---

## 12. Tóm tắt thay đổi vs Plan v1

| Aspect | v1 | v2 |
|---|---|---|
| Cost data source | Catalog API (sai) | Dummy product → cache (correct) |
| Variant types | 1 type | 2 types (Catalog vs Shop) |
| Sprint count | 4 | 5 |
| Effort | 12-16h | 17-22h |
| Setup latency | None | +3-5s khi admin save Blueprint lần đầu |
| Fallback | None | Graceful degrade if Printify fail |
| Cleanup | None | Daily cron orphan products |

**Net impact**: +5-6h effort, nhưng đảm bảo plan thực sự chạy được. Đây là correctness fix, không phải scope creep.