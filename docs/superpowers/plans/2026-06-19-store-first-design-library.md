# Store-First Design Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `/designs` into a store-first workflow where users choose a store before seeing designs, and upload links carry the selected store into `/designs/upload`.

**Architecture:** Keep the current App Router pages and API contracts. The server pages validate tenant-scoped stores and pass serializable store-selection state into client components; the client components render store-first UI and keep selected store URLs explicit with `?storeId=`.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Prisma, Node `node:test` source tests, local Next docs for async `searchParams`.

---

## File Structure

- Modify `src/app/api/designs/designs-store-source.test.ts`
  - Source-level regression tests for the store-first page, upload preselection, and existing upload API `storeId` guard.
- Modify `src/app/(authed)/designs/page.tsx`
  - Server Component. Loads active stores, validates optional `storeId`, skips design queries when no valid store is selected, and passes invalid-store state to the client.
- Modify `src/app/(authed)/designs/DesignsClient.tsx`
  - Client Component. Replaces `All`/`Unassigned` filter tabs with store-first selection, hides search/grid before selection, scopes upload/search/page actions to selected store.
- Modify `src/app/(authed)/designs/upload/page.tsx`
  - Server Component. Reads async `searchParams`, validates optional `storeId`, and passes `initialStoreId` into the upload client.
- Modify `src/app/(authed)/designs/upload/UploadDesignClient.tsx`
  - Client Component. Initializes selected store from `initialStoreId` and links back to the selected store's design library.

No schema, migration, API upload contract, wizard, mockup, pairing, or publish files change.

## Task 1: Add Store-First Source Tests

**Files:**
- Modify: `src/app/api/designs/designs-store-source.test.ts`

- [ ] **Step 1: Replace the source test file with store-first assertions**

Use this complete file:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("design list API still supports store filtering and returns store labels", () => {
  const source = readFileSync("src/app/api/designs/route.ts", "utf8");
  assert.match(source, /searchParams\.get\("storeId"\)/);
  assert.match(source, /store:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/s);
});

test("upload API requires storeId and validates store ownership", () => {
  const source = readFileSync("src/app/api/designs/upload/route.ts", "utf8");
  assert.match(source, /fields\.storeId/);
  assert.match(source, /prisma\.store\.findFirst/);
  assert.match(source, /storeId:\s*store\.id/);
});

test("designs page validates storeId and skips global design queries without a selected store", () => {
  const source = readFileSync("src/app/(authed)/designs/page.tsx", "utf8");
  assert.match(source, /const\s+\{\s*storeId\s*\}\s*=\s*await\s+searchParams/);
  assert.match(source, /selectedStore\s*=\s*storeId/);
  assert.match(source, /initialDesigns\s*=\s*selectedStore/);
  assert.match(source, /initialTotal\s*=\s*selectedStore/);
  assert.doesNotMatch(source, /storeId\s*===\s*"unassigned"/);
});

test("designs client renders store-first UI without all or unassigned controls", () => {
  const source = readFileSync("src/app/(authed)/designs/DesignsClient.tsx", "utf8");
  assert.match(source, /invalidStoreSelected/);
  assert.match(source, /selectedStore/);
  assert.match(source, /Chọn store để xem design/);
  assert.match(source, /\/designs\/upload\?storeId=/);
  assert.match(source, /router\.replace\(`\/designs\?storeId=/);
  assert.doesNotMatch(source, /label:\s*"All"/);
  assert.doesNotMatch(source, /label:\s*"Unassigned"/);
  assert.doesNotMatch(source, /id:\s*"unassigned"/);
});

test("upload page preselects a valid storeId and returns to that store library", () => {
  const pageSource = readFileSync("src/app/(authed)/designs/upload/page.tsx", "utf8");
  const clientSource = readFileSync("src/app/(authed)/designs/upload/UploadDesignClient.tsx", "utf8");
  assert.match(pageSource, /searchParams:\s*Promise<\{\s*storeId\?:\s*string\s*\}>/);
  assert.match(pageSource, /initialStoreId/);
  assert.match(pageSource, /stores\.some\(\(store\)\s*=>\s*store\.id\s*===\s*storeId\)/);
  assert.match(clientSource, /initialStoreId/);
  assert.match(clientSource, /stores\.some\(\(store\)\s*=>\s*store\.id\s*===\s*initialStoreId\)/);
  assert.match(clientSource, /`\/designs\?storeId=\$\{storeId\}`/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails before implementation**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/designs/designs-store-source.test.ts
```

Expected: FAIL on new assertions for `invalidStoreSelected`, `router.replace`, upload `initialStoreId`, and no `unassigned` branch.

- [ ] **Step 3: Commit failing tests**

```bash
git add src/app/api/designs/designs-store-source.test.ts
git commit -m "test: specify store-first design library"
```

## Task 2: Make `/designs` Server Data Store-First

**Files:**
- Modify: `src/app/(authed)/designs/page.tsx`

- [ ] **Step 1: Replace the server page implementation**

Use this complete file:

```tsx
import { redirect } from "next/navigation";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";
import DesignsClient from "./DesignsClient";

export const metadata = {
  title: "Designs — MockupAI",
  description: "Thư viện thiết kế POD",
};

/**
 * Designs list — Server Component.
 * Store-first entry point: designs are loaded only after a valid store is selected.
 */
export default async function DesignsPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await validateSession();
  if (!session) redirect("/login");

  const { storeId } = await searchParams;
  const limit = 20;

  const stores = await prisma.store.findMany({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const selectedStore = storeId ? stores.find((store) => store.id === storeId) ?? null : null;
  const invalidStoreSelected = Boolean(storeId && !selectedStore);

  const [designs, total] = selectedStore
    ? await Promise.all([
        prisma.design.findMany({
          where: { tenantId: session.tenantId, status: "ACTIVE", storeId: selectedStore.id },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: {
            id: true,
            name: true,
            storeId: true,
            store: { select: { id: true, name: true } },
            previewPath: true,
            width: true,
            height: true,
            dpi: true,
            fileSizeBytes: true,
            mimeType: true,
            createdAt: true,
          },
        }),
        prisma.design.count({
          where: { tenantId: session.tenantId, status: "ACTIVE", storeId: selectedStore.id },
        }),
      ])
    : [[], 0];

  const storage = getStorage();
  const initialDesigns = selectedStore
    ? designs.map((design) => ({
        ...design,
        createdAt: design.createdAt.toISOString(),
        previewUrl: design.previewPath ? storage.getPublicUrl(design.previewPath) : null,
      }))
    : [];
  const initialTotal = selectedStore ? total : 0;

  return (
    <DesignsClient
      initialDesigns={initialDesigns}
      stores={stores}
      initialStoreId={selectedStore?.id ?? null}
      invalidStoreSelected={invalidStoreSelected}
      initialTotal={initialTotal}
      initialTotalPages={Math.ceil(initialTotal / limit)}
    />
  );
}
```

- [ ] **Step 2: Run the focused source test**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/designs/designs-store-source.test.ts
```

Expected: still FAIL because `DesignsClient` and upload files are not implemented yet.

- [ ] **Step 3: Commit server-page implementation**

```bash
git add 'src/app/(authed)/designs/page.tsx'
git commit -m "feat: load design library by selected store"
```

## Task 3: Make `DesignsClient` Store-First

**Files:**
- Modify: `src/app/(authed)/designs/DesignsClient.tsx`

- [ ] **Step 1: Update imports and props**

Replace the import block and `Props` interface with:

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
```

```ts
interface Props {
  initialDesigns: Design[];
  stores: StoreOption[];
  initialStoreId: string | null;
  invalidStoreSelected: boolean;
  initialTotal: number;
  initialTotalPages: number;
}
```

- [ ] **Step 2: Update component state and derived values**

Inside `DesignsClient`, include `invalidStoreSelected` in destructuring, initialize router, and add derived state:

```tsx
export default function DesignsClient({
  initialDesigns,
  stores,
  initialStoreId,
  invalidStoreSelected,
  initialTotal,
  initialTotalPages,
}: Props) {
  const router = useRouter();
  const [designs, setDesigns] = useState<Design[]>(initialDesigns);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeStoreId, setActiveStoreId] = useState<string | null>(initialStoreId);
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === activeStoreId) ?? null,
    [activeStoreId, stores],
  );
  const hasStores = stores.length > 0;
  const uploadHref = selectedStore ? `/designs/upload?storeId=${selectedStore.id}` : "/designs/upload";
```

- [ ] **Step 3: Guard fetch/search/page actions against missing stores**

Replace `handleSearch`, `handlePageChange`, and `handleStoreChange` with:

```tsx
  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!activeStoreId) return;
    setPage(1);
    fetchDesigns(search, 1, activeStoreId);
  }

  function handlePageChange(newPage: number) {
    if (!activeStoreId) return;
    setPage(newPage);
    fetchDesigns(search, newPage, activeStoreId);
  }

  function handleStoreChange(storeId: string) {
    setActiveStoreId(storeId);
    setPage(1);
    setSearch("");
    router.replace(`/designs?storeId=${storeId}`);
    fetchDesigns("", 1, storeId);
  }
```

- [ ] **Step 4: Replace the header, store selector, search, and empty-state rendering**

In the returned JSX, replace everything from the header comment through the empty-state block with:

```tsx
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Design Library</h1>
          <p className="page-subtitle">
            {selectedStore
              ? `${selectedStore.name} · ${total} design${total !== 1 ? "s" : ""}`
              : "Chọn store để xem design"}
          </p>
        </div>
        {selectedStore ? (
          <Link href={uploadHref} className="btn btn-primary">
            <Plus size={16} />
            Upload Design
          </Link>
        ) : (
          <button type="button" className="btn btn-secondary" disabled>
            <Plus size={16} />
            Upload Design
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
            Kết nối hoặc kích hoạt store trước khi upload design.
          </p>
        </div>
      )}

      {hasStores && !selectedStore && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <ImageIcon size={32} style={{ opacity: 0.3, marginBottom: 14 }} />
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>
            {invalidStoreSelected ? "Store không hợp lệ hoặc không còn active" : "Chọn store để xem design"}
          </h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: 0 }}>
            Chọn một store phía trên để xem thư viện design của store đó.
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
                placeholder="Tìm design theo tên..."
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
        <div
          className="flex items-center justify-center"
          style={{ padding: 64, opacity: 0.5 }}
        >
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {selectedStore && !loading && designs.length === 0 && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              backgroundColor: "var(--bg-tertiary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <ImageIcon size={32} style={{ opacity: 0.3 }} />
          </div>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>
            {search ? "Không tìm thấy design" : `Chưa có design nào trong ${selectedStore.name}`}
          </h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: "0 0 24px" }}>
            {search
              ? `Không có kết quả cho "${search}" trong ${selectedStore.name}`
              : "Upload design đầu tiên cho store này để bắt đầu"}
          </p>
          {!search && (
            <Link href={uploadHref} className="btn btn-primary">
              <Plus size={16} />
              Upload Design
            </Link>
          )}
        </div>
      )}
```

- [ ] **Step 5: Scope grid and pagination rendering to the selected store**

Change the grid condition from:

```tsx
{!loading && designs.length > 0 && (
```

to:

```tsx
{selectedStore && !loading && designs.length > 0 && (
```

Leave the existing card grid, delete confirmation, and pagination markup unchanged after this condition. The design card store label may remain, but it will always reflect the selected store.

- [ ] **Step 6: Run the focused source test**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/designs/designs-store-source.test.ts
```

Expected: still FAIL only on upload-page/upload-client assertions.

- [ ] **Step 7: Commit client library implementation**

```bash
git add 'src/app/(authed)/designs/DesignsClient.tsx'
git commit -m "feat: render design library by selected store"
```

## Task 4: Preselect Upload Store And Return To Library Store

**Files:**
- Modify: `src/app/(authed)/designs/upload/page.tsx`
- Modify: `src/app/(authed)/designs/upload/UploadDesignClient.tsx`

- [ ] **Step 1: Replace upload server page**

Use this complete file:

```tsx
import { redirect } from "next/navigation";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import UploadDesignClient from "./UploadDesignClient";

export const metadata = {
  title: "Upload Designs - MockupAI",
};

export default async function UploadDesignPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await validateSession();
  if (!session) redirect("/login");

  const { storeId } = await searchParams;

  const stores = await prisma.store.findMany({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const initialStoreId = storeId && stores.some((store) => store.id === storeId) ? storeId : null;

  return <UploadDesignClient stores={stores} initialStoreId={initialStoreId} />;
}
```

- [ ] **Step 2: Update upload client props and initial state**

In `UploadDesignClient.tsx`, replace the props interface and component signature with:

```ts
interface Props {
  stores: StoreOption[];
  initialStoreId: string | null;
}
```

```tsx
export default function UploadDesignClient({ stores, initialStoreId }: Props) {
  const initialSelectedStoreId =
    initialStoreId && stores.some((store) => store.id === initialStoreId)
      ? initialStoreId
      : stores[0]?.id ?? "";
  const [storeId, setStoreId] = useState(initialSelectedStoreId);
```

Remove the old line:

```tsx
const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
```

- [ ] **Step 3: Update the library back link**

At the bottom of `UploadDesignClient.tsx`, replace the static link:

```tsx
<Link href="/designs" className="btn btn-secondary">
  Xem thư viện
</Link>
```

with:

```tsx
<Link href={storeId ? `/designs?storeId=${storeId}` : "/designs"} className="btn btn-secondary">
  Xem thư viện
</Link>
```

- [ ] **Step 4: Run the focused source test**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/designs/designs-store-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit upload preselection**

```bash
git add 'src/app/(authed)/designs/upload/page.tsx' 'src/app/(authed)/designs/upload/UploadDesignClient.tsx'
git commit -m "feat: preselect store for design uploads"
```

## Task 5: Final Verification

**Files:**
- Verify only. No planned file modifications.

- [ ] **Step 1: Run focused test**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/designs/designs-store-source.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Next build**

Run:

```bash
npm run build
```

Expected: PASS. If it fails on TypeScript or Next App Router errors, fix the exact failing file and rerun this command.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: no unstaged changes after the task commits. If there are unstaged implementation changes, inspect them and either commit the intended changes or remove only files generated by verification commands.

- [ ] **Step 4: Manual browser smoke check if a dev server is available**

Run:

```bash
npm run dev
```

Open `/designs` and verify:

- No store selected by default.
- `All` and `Unassigned` are not visible.
- Search and grid are hidden until a store is selected.
- Selecting a store updates the URL to `/designs?storeId=<storeId>`.
- Upload links to `/designs/upload?storeId=<storeId>`.
- `/designs/upload?storeId=<storeId>` preselects that store.
- `Xem thư viện` returns to `/designs?storeId=<storeId>`.

Stop the dev server after verification.

## Self-Review Notes

- Spec coverage: all decisions from `docs/superpowers/specs/2026-06-19-store-first-design-library-design.md` map to Tasks 2-4; verification maps to Task 5.
- No schema, publish, pairing, wizard, or upload API contract changes are included.
- Next.js 16 async `searchParams` is used in both Server Components.
- URL query updates use `useRouter` from `next/navigation`, consistent with local Next docs.
- Source tests intentionally remove the old assertion for `storeId === "unassigned"` because the visible workflow no longer exposes `Unassigned`.
