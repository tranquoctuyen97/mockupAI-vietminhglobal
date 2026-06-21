# Store-First Mockup Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the store-first design library pattern for mockups — every mockup belongs to a store, UI requires store selection, upload page is store-scoped, and TemplateMockupPicker passes `storeId` to API calls.

**Architecture:** Add `storeId` to `MockupLibraryItem`, bump upload limit to 100MB, then update GET/POST `/api/mockups` to require `storeId` and validate store ownership. Refactor `/mockups` into a store-first server/client page, create `/mockups/upload` page mirroring `/designs/upload`, fix `TemplateMockupPicker` to scope by store, and add cross-store validation to template attach API.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Prisma, Node `node:test` source tests, local Next docs for async `searchParams`.

---

## File Structure

- Modify `prisma/schema.prisma`
  - Add `storeId` + relation to `MockupLibraryItem` and `Store.mockupLibraryItems`.
- Modify `src/lib/mockup/mockup-library-service.ts`
  - Add `storeId` param to `createMockupLibraryItemFromUpload`, bump `MAX_UPLOAD_BYTES` to 100MB.
- Modify `src/app/api/mockups/route.ts`
  - GET: support `storeId` query param. POST: require `storeId`, validate store ownership.
- Modify `src/app/api/mockups/mockups-route-source.test.ts`
  - Add assertions for store-first API guards.
- Modify `src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts`
  - POST: validate `mockup.storeId === template.storeId`.
- Modify `src/app/api/stores/template-mockups-route-source.test.ts`
  - Add cross-store rejection assertion.
- Modify `src/app/(authed)/mockups/page.tsx`
  - Server Component. Loads active stores, validates `storeId`, skips mockup queries when no valid store.
- Modify `src/app/(authed)/mockups/MockupsClient.tsx`
  - Client Component. Store-first UI: selector, search/grid scoped to store, upload button links to `/mockups/upload?storeId=`.
- Create `src/app/(authed)/mockups/upload/page.tsx`
  - Server Component. Reads `searchParams`, validates `storeId`, passes `initialStoreId`.
- Create `src/app/(authed)/mockups/upload/MockupUploadClient.tsx`
  - Client Component. Store selector, batch upload with `storeId` in FormData, back link to store library.
- Modify `src/components/mockup/TemplateMockupPicker.tsx`
  - Pass `storeId` to `GET /api/mockups` query and upload FormData.

---

## Task 1: Schema + Service + Data Cleanup

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/mockup/mockup-library-service.ts`

- [ ] **Step 1: Add `storeId` to MockupLibraryItem and Store relation**

In `prisma/schema.prisma`, add `storeId` field to `MockupLibraryItem` (after `tenantId`):

```prisma
model MockupLibraryItem {
  id                String                  @id @default(cuid())
  tenantId          String                  @map("tenant_id")
  storeId           String                  @map("store_id")
  // ... all other fields unchanged ...
  tenant        Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  store         Store                @relation(fields: [storeId], references: [id], onDelete: Cascade)
  uploadedBy    User?                @relation("MockupLibraryUploadedBy", fields: [uploadedById], references: [id], onDelete: SetNull)
  templateItems TemplateMockupItem[]

  @@index([tenantId, storeId, isActive, deletedAt])
  @@index([tenantId, name])
  @@map("mockup_library_items")
}
```

Add `mockupLibraryItems` to `Store` model (after existing relation fields):

```prisma
model Store {
  // ... existing fields unchanged ...
  mockupLibraryItems MockupLibraryItem[]
}
```

- [ ] **Step 2: Bump MAX_UPLOAD_BYTES and add storeId to service**

In `src/lib/mockup/mockup-library-service.ts`, change:

```ts
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
```

Update the error message on line 41:

```ts
if (input.file.size > MAX_UPLOAD_BYTES) throw new MockupLibraryValidationError("File must be 100MB or smaller");
```

Add `storeId` to the function signature, `input` type, and `prisma.mockupLibraryItem.create` data:

```ts
export async function createMockupLibraryItemFromUpload(input: {
  tenantId: string;
  storeId: string;
  uploadedById: string;
  file: File;
  name: string;
  view: unknown;
  sceneType: unknown;
  renderMode: unknown;
  compositeRegionPx: unknown;
}) {
  // ... validation unchanged ...

  return prisma.mockupLibraryItem.create({
    data: {
      id,
      tenantId: input.tenantId,
      storeId: input.storeId,
      name: input.name.trim() || "Untitled mockup",
      // ... all other fields unchanged ...
    },
  });
}
```

- [ ] **Step 3: Clear dependent data**

Run these in order before `prisma db push`:

```bash
npx prisma db execute --stdin <<'SQL'
DELETE FROM wizard_draft_mockup_library_picks;
DELETE FROM template_mockup_items;
DELETE FROM mockup_library_items;
SQL
```

- [ ] **Step 4: Push schema**

```bash
npx prisma db push
```

Expected: schema applied without migration, `store_id` column added to `mockup_library_items`.

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new type errors from these two files. (There may be pre-existing errors from other files not yet updated — that's expected.)

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/lib/mockup/mockup-library-service.ts
git commit -m "feat: add storeId to mockup library items, bump upload limit to 100MB"
```

---

## Task 2: Store-First Source Tests

**Files:**
- Modify: `src/app/api/mockups/mockups-route-source.test.ts`
- Modify: `src/app/api/stores/template-mockups-route-source.test.ts`

- [ ] **Step 1: Replace mockups-route-source.test.ts with store-first assertions**

Use this complete file:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function assertSelectedStoreQueryHasEmptyFallback(
  source: string,
  method: "findMany" | "count",
  emptyFallback: string,
) {
  const selectedStoreQuery = new RegExp(
    `selectedStore\\s*\\?[\\s\\S]{0,1200}prisma\\.mockupLibraryItem\\.${method}[\\s\\S]{0,1200}:\\s*${emptyFallback}`,
  );
  assert.match(source, selectedStoreQuery);
}

function assertInitialStoreIdComesFromValidatedStore(source: string) {
  const directValidatedInitialStoreId =
    /initialStoreId\s*=\s*stores\.find\([\s\S]{0,300}(store\.id\s*={2,3}\s*storeId|storeId\s*={2,3}\s*store\.id)[\s\S]{0,120}\)\?\.id\s*\?\?\s*null/;
  if (directValidatedInitialStoreId.test(source)) return;

  const validatedStore = source.match(
    /const\s+(\w+)\s*=\s*(?:storeId\s*\?\s*)?stores\.find\([\s\S]{0,300}(store\.id\s*={2,3}\s*storeId|storeId\s*={2,3}\s*store\.id)[\s\S]{0,120}\)(?:\s*:\s*null|\s*\?\?\s*null)?/,
  );
  assert.ok(validatedStore);

  const [, validatedStoreName] = validatedStore;
  assert.match(
    source,
    new RegExp(`initialStoreId\\s*=\\s*${validatedStoreName}\\?\\.id\\s*\\?\\?\\s*null`),
  );
}

test("global mockup routes require mockup_library permission", () => {
  assert.match(readFileSync("src/app/api/mockups/route.ts", "utf8"), /requireFeature\(["']mockup_library["']\)/);
  assert.match(readFileSync("src/app/api/mockups/[mockupId]/route.ts", "utf8"), /requireFeature\(["']mockup_library["']\)/);
});

test("mockup list API supports storeId filtering", () => {
  const source = readFileSync("src/app/api/mockups/route.ts", "utf8");
  assert.match(source, /searchParams\.get\("storeId"\)/);
  assert.match(source, /storeId/);
});

test("mockup upload API requires storeId and validates store ownership", () => {
  const source = readFileSync("src/app/api/mockups/route.ts", "utf8");
  assert.match(source, /fields\.storeId/);
  assert.match(source, /prisma\.store\.findFirst/);
  assert.match(source, /storeId:\s*store\.id/);
});

test("mockup upload is COMPOSITE-only and bumps limit to 100MB", () => {
  const serviceSource = readFileSync("src/lib/mockup/mockup-library-service.ts", "utf8");
  assert.match(serviceSource, /100\s*\*\s*1024\s*\*\s*1024/);
  assert.match(serviceSource, /100MB/);
  assert.match(serviceSource, /renderMode\s*!==?\s*"COMPOSITE"/);
  assert.match(serviceSource, /storeId/);
});

test("mockups page validates storeId and skips global mockup queries without a selected store", () => {
  const source = readFileSync("src/app/(authed)/mockups/page.tsx", "utf8");
  assert.match(source, /const\s+\{\s*storeId\s*\}\s*=\s*await\s+searchParams/);
  assert.match(source, /selectedStore\s*=\s*storeId/);
  assertSelectedStoreQueryHasEmptyFallback(source, "findMany", "\\[\\s*\\]");
  assertSelectedStoreQueryHasEmptyFallback(source, "count", "0");
});

test("mockups client renders store-first UI without global option", () => {
  const source = readFileSync("src/app/(authed)/mockups/MockupsClient.tsx", "utf8");
  assert.match(source, /invalidStoreSelected/);
  assert.match(source, /selectedStore/);
  assert.match(source, /Chọn store để xem mockup/);
  assert.match(source, /\/mockups\/upload\?storeId=/);
  assert.match(source, /\/mockups\?storeId=/);
  assert.doesNotMatch(source, /Global mockup library/);
});

test("mockup upload page preselects a valid storeId and returns to that store library", () => {
  const pageSource = readFileSync("src/app/(authed)/mockups/upload/page.tsx", "utf8");
  const clientSource = readFileSync("src/app/(authed)/mockups/upload/MockupUploadClient.tsx", "utf8");
  assert.match(pageSource, /searchParams/);
  assert.match(pageSource, /Promise/);
  assert.match(pageSource, /storeId\?:\s*string/);
  assert.match(pageSource, /await\s+searchParams/);
  assert.match(pageSource, /initialStoreId/);
  assertInitialStoreIdComesFromValidatedStore(pageSource);
  assert.match(clientSource, /initialStoreId/);
  assert.match(clientSource, /(store\.id\s*={2,3}\s*initialStoreId|initialStoreId\s*={2,3}\s*store\.id)/);
  assert.match(clientSource, /\/mockups\?storeId=/);
});
```

- [ ] **Step 2: Add cross-store attach rejection to template-mockups-route-source.test.ts**

Append to `src/app/api/stores/template-mockups-route-source.test.ts`:

```ts
test("template mockup attach rejects cross-store mockup", () => {
  const source = readFileSync("src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts", "utf8");
  assert.match(source, /mockup\.storeId\s*!==?\s*template\.storeId/);
  assert.match(source, /Mockup does not belong to this store/);
});
```

- [ ] **Step 3: Run tests to verify they fail before implementation**

```bash
./node_modules/.bin/tsx --test src/app/api/mockups/mockups-route-source.test.ts 2>&1
./node_modules/.bin/tsx --test src/app/api/stores/template-mockups-route-source.test.ts 2>&1
```

Expected: FAIL on new store-first and cross-store assertions.

- [ ] **Step 4: Commit failing tests**

```bash
git add src/app/api/mockups/mockups-route-source.test.ts src/app/api/stores/template-mockups-route-source.test.ts
git commit -m "test: specify store-first mockup library and cross-store attach guard"
```

---

## Task 3: Make `/api/mockups` Store-First

**Files:**
- Modify: `src/app/api/mockups/route.ts`

- [ ] **Step 1: Replace GET handler to support storeId**

Replace the GET function with:

```ts
export async function GET(request: Request) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const storeId = url.searchParams.get("storeId");
  const viewParam = url.searchParams.get("view");
  const sceneTypeParam = url.searchParams.get("sceneType");
  const view = viewParam ? normalizeMockupLibraryView(viewParam) : null;
  const sceneType = sceneTypeParam ? normalizeMockupLibraryScene(sceneTypeParam) : null;
  if (viewParam && !view) return NextResponse.json({ error: "view is invalid" }, { status: 400 });
  if (sceneTypeParam && !sceneType) return NextResponse.json({ error: "sceneType is invalid" }, { status: 400 });

  const items = await prisma.mockupLibraryItem.findMany({
    where: {
      tenantId: session.tenantId,
      isActive: true,
      deletedAt: null,
      ...(storeId ? { storeId } : {}),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      ...(view ? { view } : {}),
      ...(sceneType ? { sceneType } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: { _count: { select: { templateItems: true } } },
  });

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      imageUrl: storageUrl(item.storagePath),
      previewUrl: item.previewPath ? storageUrl(item.previewPath) : null,
      templateAttachmentCount: item._count.templateItems,
    })),
  });
}
```

- [ ] **Step 2: Replace POST handler to require storeId and validate store ownership**

Replace the POST function with:

```ts
export async function POST(request: Request) {
  const { session, response } = await requireFeature("mockup_library");
  if (response) return response;

  const form = await request.formData();
  const file = form.get("file");
  if (!isFileLike(file)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const storeId = String(form.get("storeId") ?? "");
  if (!storeId) {
    return NextResponse.json({ error: "storeId is required" }, { status: 400 });
  }

  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!store) {
    return NextResponse.json({ error: "Store not found or not active" }, { status: 400 });
  }

  try {
    const item = await createMockupLibraryItemFromUpload({
      tenantId: session.tenantId,
      storeId: store.id,
      uploadedById: session.id,
      file,
      name: String(form.get("name") ?? ""),
      view: String(form.get("view") ?? "front"),
      sceneType: String(form.get("sceneType") ?? "flat_lay"),
      renderMode: form.get("renderMode"),
      compositeRegionPx: parseMultipartJson(form.get("compositeRegionPx"), "compositeRegionPx"),
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof MockupLibraryValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
```

- [ ] **Step 3: Run focused test**

```bash
./node_modules/.bin/tsx --test src/app/api/mockups/mockups-route-source.test.ts 2>&1
```

Expected: API tests pass (tests 1-4). Page/client/upload tests still fail.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/mockups/route.ts
git commit -m "feat: require storeId for mockup uploads, support storeId in list"
```

---

## Task 4: Make `/mockups` Server Page Store-First

**Files:**
- Modify: `src/app/(authed)/mockups/page.tsx`

- [ ] **Step 1: Replace the server page**

Use this complete file:

```tsx
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { storageUrl } from "@/lib/mockup/custom-library";
import MockupsClient from "./MockupsClient";

export const metadata = {
  title: "Mockups - MockupAI",
};

/**
 * Mockups list — Server Component.
 * Store-first entry point: mockups are loaded only after a valid store is selected.
 */
export default async function MockupsPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await validateSession();
  if (!session) redirect("/login");
  const canUseMockups = await hasFeature(session.tenantId, session.role, "mockup_library");
  if (!canUseMockups) redirect("/dashboard");

  const { storeId } = await searchParams;
  const limit = 20;

  const stores = await prisma.store.findMany({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const selectedStore = storeId ? stores.find((store) => store.id === storeId) ?? null : null;
  const invalidStoreSelected = Boolean(storeId && !selectedStore);

  const mockups = selectedStore
    ? await prisma.mockupLibraryItem.findMany({
        where: { tenantId: session.tenantId, isActive: true, deletedAt: null, storeId: selectedStore.id },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: limit,
        include: { _count: { select: { templateItems: true } } },
      })
    : [];

  const total = selectedStore
    ? await prisma.mockupLibraryItem.count({
        where: { tenantId: session.tenantId, isActive: true, deletedAt: null, storeId: selectedStore.id },
      })
    : 0;

  const initialMockups = selectedStore
    ? mockups.map((m) => ({
        id: m.id,
        name: m.name,
        imageUrl: storageUrl(m.storagePath),
        width: m.width,
        height: m.height,
        view: m.view,
        sceneType: m.sceneType,
        compositeRegionPx: m.compositeRegionPx,
        templateAttachmentCount: m._count.templateItems,
      }))
    : [];
  const initialTotal = selectedStore ? total : 0;

  return (
    <MockupsClient
      initialMockups={initialMockups}
      stores={stores}
      initialStoreId={selectedStore?.id ?? null}
      invalidStoreSelected={invalidStoreSelected}
      initialTotal={initialTotal}
      initialTotalPages={Math.ceil(initialTotal / limit)}
    />
  );
}
```

- [ ] **Step 2: Run focused test**

```bash
./node_modules/.bin/tsx --test src/app/api/mockups/mockups-route-source.test.ts 2>&1
```

Expected: page test (test 5) passes. Client and upload tests still fail.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(authed)/mockups/page.tsx'
git commit -m "feat: load mockup library by selected store"
```

---

## Task 5: Make `MockupsClient` Store-First

**Files:**
- Modify: `src/app/(authed)/mockups/MockupsClient.tsx`

- [ ] **Step 1: Replace MockupsClient with store-first implementation**

Use this complete file:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GlobalMockupEditorModal, type GlobalMockupEditorValue } from "@/components/mockup/GlobalMockupEditorModal";

interface MockupItem extends GlobalMockupEditorValue {
  templateAttachmentCount: number;
}

interface StoreOption {
  id: string;
  name: string;
}

interface Props {
  initialMockups: MockupItem[];
  stores: StoreOption[];
  initialStoreId: string | null;
  invalidStoreSelected: boolean;
  initialTotal: number;
  initialTotalPages: number;
}

export default function MockupsClient({
  initialMockups,
  stores,
  initialStoreId,
  invalidStoreSelected,
  initialTotal,
  initialTotalPages,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState<MockupItem[]>(initialMockups);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeStoreId, setActiveStoreId] = useState<string | null>(initialStoreId);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<MockupItem | null>(null);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === activeStoreId) ?? null,
    [activeStoreId, stores],
  );
  const hasStores = stores.length > 0;
  const uploadHref = selectedStore ? `/mockups/upload?storeId=${selectedStore.id}` : "/mockups/upload";

  const fetchMockups = useCallback(async (q: string, p: number, storeId: string | null) => {
    if (!storeId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      params.set("storeId", storeId);
      params.set("page", String(p));
      params.set("limit", "20");

      const res = await fetch(`/api/mockups?${params}`);
      const data = await res.json();
      if (res.ok) {
        setItems((data.items ?? []).map((item: any) => ({
          id: item.id,
          name: item.name,
          imageUrl: item.imageUrl,
          width: item.width,
          height: item.height,
          view: item.view,
          sceneType: item.sceneType,
          compositeRegionPx: item.compositeRegionPx,
          templateAttachmentCount: item.templateAttachmentCount ?? 0,
        })));
        setTotal(data.total ?? data.items?.length ?? 0);
        setTotalPages(data.totalPages ?? Math.ceil((data.total ?? 0) / 20));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: if there's a selected store but no initial data, fetch
  useEffect(() => {
    if (activeStoreId && initialTotal === 0 && !invalidStoreSelected) {
      fetchMockups("", 1, activeStoreId);
    }
  }, []);

  // Handle "edit" query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (editId && items.length > 0) {
      setEditing(items.find((item) => item.id === editId) ?? null);
    }
  }, [items]);

  async function save(value: GlobalMockupEditorValue) {
    if (!value.id) return;
    const res = await fetch(`/api/mockups/${value.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: value.name,
        view: value.view,
        sceneType: value.sceneType,
        renderMode: "COMPOSITE",
        compositeRegionPx: value.compositeRegionPx,
      }),
    });
    if (!res.ok) throw new Error("Save failed");
    setEditing(null);
    fetchMockups(search, page, activeStoreId);
  }

  async function remove(item: MockupItem) {
    const res = await fetch(`/api/mockups/${item.id}`, { method: "DELETE" });
    if (res.status === 409) {
      toast.error("Mockup is attached to templates");
      return;
    }
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    fetchMockups(search, page, activeStoreId);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!activeStoreId) return;
    setPage(1);
    fetchMockups(search, 1, activeStoreId);
  }

  function handlePageChange(newPage: number) {
    if (!activeStoreId) return;
    setPage(newPage);
    fetchMockups(search, newPage, activeStoreId);
  }

  function handleStoreChange(storeId: string) {
    setActiveStoreId(storeId);
    setPage(1);
    setSearch("");
    router.replace(`/mockups?storeId=${storeId}`);
    fetchMockups("", 1, storeId);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Mockups</h1>
          <p className="page-subtitle">
            {selectedStore
              ? `${selectedStore.name} · ${total} mockup${total !== 1 ? "s" : ""}`
              : "Chọn store để xem mockup"}
          </p>
        </div>
        {selectedStore ? (
          <Link href={uploadHref} className="btn btn-primary">
            <ImagePlus size={16} />
            Upload
          </Link>
        ) : (
          <button type="button" className="btn btn-secondary" disabled>
            <ImagePlus size={16} />
            Upload
          </button>
        )}
      </div>

      <div className="flex gap-2" style={{ marginBottom: 18, flexWrap: "wrap" }}>
        {stores.map((store) => {
          const isActive = activeStoreId === store.id;
          return (
            <button
              key={store.id}
              type="button"
              className={isActive ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => handleStoreChange(store.id)}
            >
              {store.name}
            </button>
          );
        })}
      </div>

      {!hasStores && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Chưa có store active</h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: 0 }}>
            Kết nối hoặc kích hoạt store trước khi upload mockup.
          </p>
        </div>
      )}

      {hasStores && !selectedStore && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>
            {invalidStoreSelected ? "Store không hợp lệ hoặc không còn active" : "Chọn store để xem mockup"}
          </h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: 0 }}>
            Chọn một store phía trên để xem thư viện mockup của store đó.
          </p>
        </div>
      )}

      {selectedStore && (
        <form onSubmit={handleSearch} style={{ marginBottom: 24 }}>
          <div className="flex gap-3">
            <div style={{ position: "relative", flex: 1 }}>
              <Search
                size={16}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  opacity: 0.4,
                }}
              />
              <input
                type="text"
                className="input"
                placeholder="Tìm mockup theo tên..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 38 }}
              />
            </div>
          </div>
        </form>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center" style={{ padding: 48 }}>
          <Loader2 className="animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {selectedStore && !loading && items.length === 0 && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>
            {search ? "Không tìm thấy mockup" : `Chưa có mockup nào trong ${selectedStore.name}`}
          </h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: "0 0 24px" }}>
            {search
              ? `Không có kết quả cho "${search}" trong ${selectedStore.name}`
              : "Upload mockup đầu tiên cho store này để bắt đầu"}
          </p>
          {!search && (
            <Link href={uploadHref} className="btn btn-primary">
              <ImagePlus size={16} />
              Upload
            </Link>
          )}
        </div>
      )}

      {/* Grid */}
      {selectedStore && !loading && items.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {items.map((item) => (
            <article key={item.id} className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
              {item.imageUrl ? <img src={item.imageUrl} alt="" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "contain" }} /> : null}
              <strong>{item.name}</strong>
              <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>{item.width} x {item.height} · {item.view}</span>
              <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>{item.templateAttachmentCount} template attachments</span>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditing(item)}>Edit frame</button>
                <button className="btn btn-secondary btn-sm" type="button" disabled={item.templateAttachmentCount > 0} onClick={() => remove(item)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Pagination */}
      {selectedStore && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3" style={{ marginTop: 24 }}>
          <button
            className="btn btn-secondary"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            ←
          </button>
          <span style={{ fontSize: "0.85rem", opacity: 0.6 }}>
            Trang {page}/{totalPages}
          </span>
          <button
            className="btn btn-secondary"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            →
          </button>
        </div>
      )}

      <GlobalMockupEditorModal open={Boolean(editing)} value={editing} onClose={() => setEditing(null)} onSave={save} />
    </div>
  );
}
```

- [ ] **Step 2: Run focused test**

```bash
./node_modules/.bin/tsx --test src/app/api/mockups/mockups-route-source.test.ts 2>&1
```

Expected: tests 1-6 pass. Only upload test (test 7) still fails.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(authed)/mockups/MockupsClient.tsx'
git commit -m "feat: render mockup library by selected store"
```

---

## Task 6: Create `/mockups/upload` Page

**Files:**
- Create: `src/app/(authed)/mockups/upload/page.tsx`
- Create: `src/app/(authed)/mockups/upload/MockupUploadClient.tsx`

- [ ] **Step 1: Create upload server page**

Create `src/app/(authed)/mockups/upload/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import MockupUploadClient from "./MockupUploadClient";

export const metadata = {
  title: "Upload Mockups - MockupAI",
};

export default async function MockupUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await validateSession();
  if (!session) redirect("/login");
  const canUseMockups = await hasFeature(session.tenantId, session.role, "mockup_library");
  if (!canUseMockups) redirect("/dashboard");

  const { storeId } = await searchParams;

  const stores = await prisma.store.findMany({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const validatedStore = stores.find((store) => store.id === storeId) ?? null;
  const initialStoreId = validatedStore?.id ?? null;

  return <MockupUploadClient stores={stores} initialStoreId={initialStoreId} />;
}
```

- [ ] **Step 2: Create upload client**

Create `src/app/(authed)/mockups/upload/MockupUploadClient.tsx`:

```tsx
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";

const MAX_FILES = 80;
const MAX_CONCURRENT_UPLOADS = 5;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_RETRIES = 3;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface StoreOption {
  id: string;
  name: string;
}

interface UploadFileItem {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
  progress: number;
  status: "queued" | "uploading" | "success" | "error";
  attempts: number;
  error: string | null;
}

interface UploadedMockupResult {
  id: string;
  name: string;
  width: number;
  height: number;
  imageUrl: string;
}

interface Props {
  stores: StoreOption[];
  initialStoreId: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createFileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}

export default function MockupUploadClient({ stores, initialStoreId }: Props) {
  const initialSelectedStoreId =
    initialStoreId && stores.some((store) => store.id === initialStoreId)
      ? initialStoreId
      : stores[0]?.id ?? "";
  const [storeId, setStoreId] = useState(initialSelectedStoreId);
  const [files, setFiles] = useState<UploadFileItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const runningRef = useRef(0);
  const queueRef = useRef<UploadFileItem[]>([]);

  const completeCount = files.filter((file) => file.status === "success").length;
  const hasFiles = files.length > 0;
  const canUpload = hasFiles && Boolean(storeId) && !uploading;

  const selectedStoreName = useMemo(
    () => stores.find((store) => store.id === storeId)?.name ?? "",
    [storeId, stores],
  );

  const updateFile = useCallback((id: string, patch: Partial<UploadFileItem>) => {
    setFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setError("");
    const nextFiles = Array.from(incoming);
    const accepted: UploadFileItem[] = [];

    for (const file of nextFiles) {
      if (!ALLOWED_TYPES.has(file.type)) {
        setError("Chỉ chấp nhận PNG, JPG hoặc WebP");
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("File quá lớn (tối đa 100MB/file)");
        continue;
      }
      accepted.push({
        id: createFileId(file),
        file,
        name: file.name.replace(/\.[^.]+$/, ""),
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        status: "queued",
        attempts: 0,
        error: null,
      });
    }

    setFiles((current) => {
      const slots = Math.max(0, MAX_FILES - current.length);
      if (accepted.length > slots) {
        setError(`Chỉ upload tối đa ${MAX_FILES} files mỗi batch`);
      }
      return [...current, ...accepted.slice(0, slots)];
    });
  }, []);

  function removeFile(id: string) {
    setFiles((current) => {
      const removed = current.find((file) => file.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((file) => file.id !== id);
    });
  }

  function uploadOne(fileItem: UploadFileItem, selectedStoreId: string): Promise<UploadedMockupResult> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("file", fileItem.file);
      form.append("name", fileItem.name);
      form.append("storeId", selectedStoreId);
      form.append("view", "front");
      form.append("sceneType", "flat_lay");
      form.append("renderMode", "COMPOSITE");

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/mockups");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          updateFile(fileItem.id, {
            progress: Math.round((event.loaded / event.total) * 100),
          });
        }
      };
      xhr.onload = () => {
        let data: { error?: string } & Partial<UploadedMockupResult> = {};
        try {
          data = JSON.parse(xhr.responseText || "{}");
        } catch {
          data = { error: xhr.responseText || "Upload thất bại" };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as UploadedMockupResult);
        } else {
          reject(new Error(data.error || "Upload thất bại"));
        }
      };
      xhr.onerror = () => reject(new Error("Không thể kết nối server"));
      xhr.send(form);
    });
  }

  async function runFile(fileItem: UploadFileItem, selectedStoreId: string) {
    updateFile(fileItem.id, {
      status: "uploading",
      attempts: fileItem.attempts + 1,
      error: null,
    });

    try {
      await uploadOne(fileItem, selectedStoreId);
      updateFile(fileItem.id, { status: "success", progress: 100, error: null });
    } catch (err) {
      const nextAttempts = fileItem.attempts + 1;
      if (nextAttempts < MAX_RETRIES) {
        queueRef.current.push({ ...fileItem, attempts: nextAttempts });
      } else {
        updateFile(fileItem.id, {
          status: "error",
          progress: 0,
          attempts: nextAttempts,
          error: err instanceof Error ? err.message : "Upload thất bại",
        });
      }
    } finally {
      runningRef.current -= 1;
      drainQueue(selectedStoreId);
    }
  }

  function drainQueue(selectedStoreId: string) {
    while (runningRef.current < MAX_CONCURRENT_UPLOADS && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) break;
      runningRef.current += 1;
      void runFile(next, selectedStoreId);
    }

    if (runningRef.current === 0 && queueRef.current.length === 0) {
      setUploading(false);
    }
  }

  function handleUpload() {
    if (!storeId) {
      setError("Vui lòng chọn store trước khi upload");
      return;
    }
    const queued = files.filter((file) => file.status === "queued" || file.status === "error");
    if (queued.length === 0) return;
    setUploading(true);
    setError("");
    queueRef.current = queued.map((file) => ({ ...file, progress: 0, status: "queued" }));
    drainQueue(storeId);
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Upload Mockups</h1>
        <p className="page-subtitle">Chọn store rồi upload nhiều mockup cùng lúc</p>
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <label className="block mb-1.5 text-caption" style={{ fontWeight: 600 }}>
          Store
        </label>
        <select className="input" value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {stores.length === 0 ? <option value="">Chưa có store active</option> : null}
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </div>

      <div
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          addFiles(event.dataTransfer.files);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onClick={() => document.getElementById("mockup-files-input")?.click()}
        className="card"
        style={{
          padding: 36,
          textAlign: "center",
          cursor: "pointer",
          border: dragActive ? "2px dashed var(--color-wise-green)" : "2px dashed var(--border-default)",
          backgroundColor: dragActive ? "rgba(146, 198, 72, 0.05)" : "transparent",
        }}
      >
        <input
          id="mockup-files-input"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        <ImageIcon size={32} style={{ opacity: 0.35, marginBottom: 10 }} />
        <p style={{ fontWeight: 700, margin: "0 0 4px" }}>Kéo thả hoặc click để chọn files</p>
        <p style={{ opacity: 0.55, fontSize: "0.82rem", margin: 0 }}>
          PNG, JPG, WebP · tối đa {MAX_FILES} files · 100MB/file · 5 upload song song
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2" style={{ marginTop: 12, color: "var(--color-error)" }}>
          <AlertTriangle size={14} />
          <span style={{ fontSize: "0.85rem" }}>{error}</span>
        </div>
      )}

      {hasFiles && (
        <>
          <div className="flex items-center justify-between" style={{ marginTop: 18, marginBottom: 12 }}>
            <div>
              <strong>{files.length} files</strong>
              <span style={{ opacity: 0.55, marginLeft: 8 }}>
                {completeCount} done {selectedStoreName ? `· ${selectedStoreName}` : ""}
              </span>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-secondary" disabled={uploading} onClick={() => setFiles([])}>
                Clear
              </button>
              <button className="btn btn-primary" disabled={!canUpload} onClick={handleUpload}>
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Upload
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {files.map((file) => (
              <div key={file.id} className="card" style={{ padding: 10 }}>
                <div style={{ position: "relative", aspectRatio: "1 / 1", background: "var(--bg-tertiary)", overflow: "hidden" }}>
                  <img
                    src={file.previewUrl}
                    alt={file.name}
                    style={{ width: "100%", height: "100%", objectFit: "contain", padding: 8 }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    disabled={file.status === "uploading"}
                    onClick={() => removeFile(file.id)}
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      border: "none",
                      borderRadius: 999,
                      background: "rgba(0,0,0,0.55)",
                      color: "white",
                      padding: 4,
                      cursor: "pointer",
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
                <p style={{ fontWeight: 700, fontSize: "0.78rem", margin: "8px 0 2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {file.name}
                </p>
                <p style={{ opacity: 0.5, fontSize: "0.72rem", margin: 0 }}>{formatSize(file.file.size)}</p>
                <div style={{ height: 6, background: "var(--bg-tertiary)", marginTop: 8, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${file.progress}%`,
                      background: file.status === "error" ? "var(--color-danger)" : "var(--color-wise-green)",
                    }}
                  />
                </div>
                <div className="flex items-center gap-1" style={{ marginTop: 6, fontSize: "0.72rem", opacity: 0.7 }}>
                  {file.status === "success" ? <CheckCircle2 size={13} /> : null}
                  {file.status === "uploading" ? <Loader2 size={13} className="animate-spin" /> : null}
                  <span>{file.error ?? file.status}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 20 }}>
        <Link href={storeId ? `/mockups?storeId=${storeId}` : "/mockups"} className="btn btn-secondary">
          Xem thư viện
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create upload directory if needed and run focused test**

```bash
mkdir -p 'src/app/(authed)/mockups/upload'
```

```bash
./node_modules/.bin/tsx --test src/app/api/mockups/mockups-route-source.test.ts 2>&1
```

Expected: all 7 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/(authed)/mockups/upload/'
git commit -m "feat: add store-first mockup upload page"
```

---

## Task 7: Fix TemplateMockupPicker And Attach API

**Files:**
- Modify: `src/components/mockup/TemplateMockupPicker.tsx`
- Modify: `src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts`

- [ ] **Step 1: Scope TemplateMockupPicker library fetch to storeId**

In `src/components/mockup/TemplateMockupPicker.tsx`, change `openPicker` (line 175):

```tsx
async function openPicker(colorId: string) {
  setPickerColorId(colorId);
  setPickerOpen(true);
  setLibraryQuery("");
  setLibraryLoading(true);
  try {
    const res = await fetch(`/api/mockups?storeId=${storeId}`);
    const data = await res.json();
    setLibraryItems(data.items ?? []);
  } finally {
    setLibraryLoading(false);
  }
}
```

Change `uploadForColor` to add `storeId` to FormData (after `form.set("renderMode", "COMPOSITE")` on line 142):

```tsx
form.set("storeId", storeId);
```

- [ ] **Step 2: Add cross-store validation to template attach API**

In `src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts`, in the POST handler, replace the mockup lookup (lines 47-50) with:

```ts
const mockup = await prisma.mockupLibraryItem.findFirst({
  where: { id: mockupId, tenantId: session.tenantId, isActive: true, deletedAt: null },
  select: { id: true, storeId: true },
});
if (!mockup) return NextResponse.json({ error: "Mockup not found" }, { status: 404 });

if (mockup.storeId !== template.storeId) {
  return NextResponse.json({ error: "Mockup does not belong to this store" }, { status: 400 });
}
```

Also update `loadCustomTemplate` to include the template's storeId in the select so it's available for comparison. The `template.storeId` is already accessible because the template query filters on `storeId` — it's available via the template relation. But we need to explicitly select it. Add `storeId: true` to the template select in `loadCustomTemplate`:

In the `loadCustomTemplate` function, add to the `select` on `store`:

```ts
store: {
  select: { id: true, tenantId: true, colors: { select: { id: true } } },
},
```

Wait — actually, `template.storeId` is a field on `StoreMockupTemplate`, not on `store`. The template already has `storeId` as a where clause. Let me check... Looking at the query:

```ts
where: {
  id: templateId,
  storeId,
  defaultMockupSource: "CUSTOM",
  store: { tenantId, deletedAt: null },
},
```

The `storeId` field on `StoreMockupTemplate` is the foreign key. When the template is returned, `template.storeId` is available directly on the template object. So we can compare `mockup.storeId !== template.storeId` directly — no need to select anything extra from the `store` relation. The `template` object returned by `loadCustomTemplate` already has `storeId` because it's a field on `StoreMockupTemplate`.

- [ ] **Step 3: Run tests**

```bash
./node_modules/.bin/tsx --test src/app/api/mockups/mockups-route-source.test.ts 2>&1
./node_modules/.bin/tsx --test src/app/api/stores/template-mockups-route-source.test.ts 2>&1
```

Expected: both test files PASS all tests.

- [ ] **Step 4: Commit**

```bash
git add src/components/mockup/TemplateMockupPicker.tsx src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts
git commit -m "feat: scope mockup picker to store, validate cross-store attach"
```

---

## Task 8: Final Verification

**Files:**
- Verify only. No planned file modifications.

- [ ] **Step 1: Run all mockup source tests**

```bash
./node_modules/.bin/tsx --test src/app/api/mockups/mockups-route-source.test.ts 2>&1
./node_modules/.bin/tsx --test src/app/api/stores/template-mockups-route-source.test.ts 2>&1
```

Expected: all tests PASS (7 in mockups, 4 in template-mockups).

- [ ] **Step 2: Run Next build**

```bash
npm run build 2>&1
```

Expected: PASS. If TypeScript errors, fix the exact failing file and rerun.

- [ ] **Step 3: Inspect final diff**

```bash
git status --short
git diff --stat
```

Expected: no unstaged changes after task commits.

- [ ] **Step 4: Manual smoke check (if dev server available)**

```bash
npm run dev
```

Verify:
- `/mockups` without storeId: shows store list, "Chọn store để xem mockup", no grid.
- Selecting a store updates URL to `/mockups?storeId=<id>`.
- Upload button links to `/mockups/upload?storeId=<id>`.
- `/mockups/upload?storeId=<id>` preselects that store.
- "Xem thư viện" returns to `/mockups?storeId=<id>`.
- TemplateMockupPicker in wizard only shows that store's mockups.
- Attaching cross-store mockup to template is rejected.

Stop the dev server after verification.

---

## Self-Review Notes

- Spec coverage: all 9 requirements from the spec map to Tasks 1-7. Task 8 covers final verification.
- No schema migration — data cleanup + `prisma db push` in Task 1.
- TemplateMockupPicker changes use existing `storeId` prop (already passed by all callers).
- Attach API cross-store check uses `template.storeId` directly from the `StoreMockupTemplate` model.
- Upload size bump from 10MB→100MB matches design upload, applied in both service and UI constants.
- Source tests mirror the design library pattern (helper functions for `selectedStore` ternary assertions, `initialStoreId` validation).
