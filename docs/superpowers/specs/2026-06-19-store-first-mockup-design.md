# Store-First Mockup Library

## Goal

Mirror the store-first design library pattern for mockups. Every mockup belongs to a store, and the UI requires store selection before showing mockups.

## Decisions

- Add `storeId` to `MockupLibraryItem`. No migration — drop and recreate existing data.
- `/mockups` does not auto-select a store when opened without `storeId`.
- The UI does not show global/unfiltered mockups.
- Upload moves from inline to a separate `/mockups/upload` page, matching `/designs/upload`.
- The library passes the selected store through the URL as `/mockups/upload?storeId=<storeId>`.
- The upload page preselects the URL store and links back to `/mockups?storeId=<storeId>`.
- Upload remains COMPOSITE-only (existing `createMockupLibraryItemFromUpload` behavior).
- `PATCH/DELETE /api/mockups/[mockupId]`, `GlobalMockupEditorModal`, and template attachment logic are unchanged.
- Sidebar `/mockups` link is unchanged.

## Current Context

- `MockupLibraryItem` has `tenantId` but no `storeId`.
- `GET /api/mockups` filters by tenant only, no store param.
- `POST /api/mockups` does not accept or require `storeId`.
- `/mockups` shows a "Global mockup library" with inline upload — no store selector.
- `Design.storeId` already exists and the design library was just refactored to store-first.

## Schema Change

```prisma
model MockupLibraryItem {
  // ... existing fields ...
  storeId   String @map("store_id")
  store     Store  @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([tenantId, storeId, isActive, deletedAt])
}
```

Drop all existing `MockupLibraryItem` rows (no data to preserve). No migration — `prisma db push` after schema change.

## API Changes

### `GET /api/mockups`

Add `storeId` query param. When present, filter by `storeId`. No breaking change — omitting `storeId` returns all tenant mockups (for backward compat with wizard/stores API consumers).

### `POST /api/mockups`

Add `storeId` to form data:
- Required field
- Validate that the store is active and belongs to the current tenant (same pattern as `POST /api/designs/upload`)
- Pass to `createMockupLibraryItemFromUpload`

## Component And Routing Changes

### `src/app/(authed)/mockups/page.tsx`

- Accept `searchParams: Promise<{ storeId?: string }>`.
- Load active stores for the tenant.
- Validate optional `storeId` against the store list.
- Skip mockup queries when no valid store is selected.
- Pass `initialStoreId`, `invalidStoreSelected`, stores, and initial data to the client.

### `src/app/(authed)/mockups/MockupsClient.tsx`

- Accept `stores`, `initialStoreId`, `invalidStoreSelected`, initial mockup data.
- Render store selector buttons (no global/all option).
- Hide grid, search until a store is selected.
- Upload button links to `/mockups/upload?storeId=<selectedStoreId>` (disabled when no store).
- Search and pagination scoped to selected store.
- URL updates via `router.replace(`/mockups?storeId=${storeId}`)`.

### `src/app/(authed)/mockups/upload/page.tsx` (new)

- Server Component. Accept `searchParams: Promise<{ storeId?: string }>`.
- Validate session, load active stores, validate optional `storeId`.
- Pass `stores` and `initialStoreId` to the upload client.

### `src/app/(authed)/mockups/upload/MockupUploadClient.tsx` (new)

- Client Component. Accept `stores`, `initialStoreId`.
- Store selector initialized from `initialStoreId`, falls back to first active store.
- Upload form sends `storeId` with each file.
- "Xem thư viện" link back to `/mockups?storeId=<storeId>`.
- Keep existing upload constraints: PNG/JPG, max 100MB/file, max 80 files, 5 concurrent, 3 retries.

## User Experience

### `/mockups` Without A Store

- Page title "Mockups".
- Subtitle: "Chọn store để xem mockup".
- Store list visible.
- Search hidden.
- Grid hidden.
- Upload button disabled.
- Empty state: choose a store to view mockups.

### `/mockups` With A Store

- Header/subtitle reflects store: `StoreName · N mockups`.
- Search visible.
- Grid filtered to store.
- Upload button links to `/mockups/upload?storeId=<id>`.
- Empty state names the store.

### No Active Stores / Invalid Store URL

Same pattern as designs: explain no active stores, or show invalid-store message.

### `/mockups/upload`

- Store selector with initial store preselected.
- Drag-and-drop upload zone (matching current mockup upload UI).
- Back link: "Xem thư viện" → `/mockups?storeId=<storeId>`.

## Error Handling

- Upload without `storeId`: rejected by API with validation error.
- Network failures: keep current page stable, stop loading.
- Invalid store URL: show invalid-store state, let user choose another store.
- All queries tenant-scoped — no cross-tenant data exposure.

## Testing

Source-level tests covering:
- `GET /api/mockups` supports `storeId` query param.
- `POST /api/mockups` requires `storeId` and validates store ownership.
- `/mockups` page validates `storeId` and skips queries without selected store.
- `MockupsClient` renders store-first UI (no global option, upload link scoped to store).
- `/mockups/upload` page preselects valid `storeId` and links back to store library.
