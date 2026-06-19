# Store-First Mockup Library

## Goal

Mirror the store-first design library pattern for mockups. Every mockup belongs to a store, and the UI requires store selection before showing mockups. No global mockup view.

## Decisions

- Add `storeId` to `MockupLibraryItem` and `Store.mockupLibraryItems` relation.
- No data migration — explicitly delete dependent rows before `prisma db push`.
- `/mockups` does not auto-select a store when opened without `storeId`.
- The UI does not show global/unfiltered mockups. The library page and the `TemplateMockupPicker` always pass `storeId`.
- Upload moves from inline to a separate `/mockups/upload` page, matching `/designs/upload`.
- The library passes the selected store through the URL as `/mockups/upload?storeId=<storeId>`.
- The upload page preselects the URL store and links back to `/mockups?storeId=<storeId>`.
- Upload remains COMPOSITE-only (existing `createMockupLibraryItemFromUpload` behavior).
- Bump mockup upload size limit from 10MB to 100MB to match design upload.
- `PATCH/DELETE /api/mockups/[mockupId]` and `GlobalMockupEditorModal` are unchanged.
- Sidebar `/mockups` link is unchanged.

## Current Context

- `MockupLibraryItem` has `tenantId` but no `storeId`.
- `GET /api/mockups` filters by tenant only, no `storeId` param.
- `POST /api/mockups` does not accept or require `storeId`.
- `/mockups` shows a "Global mockup library" with inline upload — no store selector.
- `TemplateMockupPicker` calls `GET /api/mockups` without `storeId` and uploads without `storeId`.
- `POST /api/stores/[id]/mockup-templates/[templateId]/mockups` (attach) validates mockup existence but not cross-store ownership.
- Mockup upload service enforces 10MB limit; design upload uses 100MB.
- `Design.storeId` already exists and the design library was just refactored to store-first.

## Schema Change

```prisma
model MockupLibraryItem {
  // ... existing fields ...
  storeId   String @map("store_id")
  store     Store  @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([tenantId, storeId, isActive, deletedAt])
}

model Store {
  // ... existing fields ...
  mockupLibraryItems MockupLibraryItem[]
}
```

### Data Cleanup (before `prisma db push`)

Delete dependent rows in order:
1. `wizard_draft_mockup_library_picks` — FK to `mockup_library_items`
2. `template_mockup_items` — FK to `mockup_library_items` (ON DELETE CASCADE, but explicit for clarity)
3. `mockup_library_items` — all existing rows

No migration file needed — direct `prisma db push` after schema change and data cleanup.

## API Changes

### `GET /api/mockups`

Add `storeId` query param:
- When present, filter by `storeId`.
- The `/mockups` page and `TemplateMockupPicker` always pass `storeId` — no global mockup view.
- Wizard/other internal consumers that call without `storeId` get all tenant mockups (backward compat).

### `POST /api/mockups`

Add `storeId` to form data:
- **Required** field. Reject if missing.
- Validate that the store is active and belongs to the current tenant: `prisma.store.findFirst({ where: { id: storeId, tenantId, status: "ACTIVE" } })`.
- Pass to `createMockupLibraryItemFromUpload`.
- Bump `MAX_UPLOAD_BYTES` in `mockup-library-service.ts` from 10MB to 100MB to match design upload.

### `POST /api/stores/[id]/mockup-templates/[templateId]/mockups` (attach)

Add cross-store validation:
- After finding the mockup, verify `mockup.storeId === template.storeId`.
- Reject with 400 if store mismatch: "Mockup does not belong to this store".

## Component And Routing Changes

### `src/app/(authed)/mockups/page.tsx`

- Accept `searchParams: Promise<{ storeId?: string }>`.
- Load active stores for the tenant.
- Validate optional `storeId` against the store list.
- Skip mockup queries when no valid store is selected (`initialDesigns = []`, `initialTotal = 0`).
- Pass `initialStoreId`, `invalidStoreSelected`, stores, and initial data to the client.

### `src/app/(authed)/mockups/MockupsClient.tsx`

- Accept `stores`, `initialStoreId`, `invalidStoreSelected`, initial mockup data, initial total, initial total pages.
- Render store selector buttons (no global/all option, no unassigned).
- Hide grid and search until a store is selected.
- Upload button links to `/mockups/upload?storeId=<selectedStoreId>` (disabled when no store).
- Search and pagination scoped to selected store.
- URL updates via `router.replace(`/mockups?storeId=${storeId}`)`.
- Always calls `GET /api/mockups?storeId=<activeStoreId>` — never fetches without `storeId`.

### `src/app/(authed)/mockups/upload/page.tsx` (new)

- Server Component. Accept `searchParams: Promise<{ storeId?: string }>`.
- Validate session, load active stores, validate optional `storeId`.
- Pass `stores` and `initialStoreId` to the upload client.

### `src/app/(authed)/mockups/upload/MockupUploadClient.tsx` (new)

- Client Component. Accept `stores`, `initialStoreId`.
- Store selector initialized from `initialStoreId`, falls back to first active store.
- Upload form sends `storeId` with every file in the FormData.
- "Xem thư viện" link back to `/mockups?storeId=<storeId>`.
- Upload constraints: PNG/JPG, max 100MB/file (matches bumped service limit), max 80 files, 5 concurrent, 3 retries.

### `src/components/mockup/TemplateMockupPicker.tsx`

- `openPicker`: change `fetch("/api/mockups")` → `fetch(`/api/mockups?storeId=${storeId}`)` (storeId already available as prop).
- `uploadForColor`: add `storeId` to the FormData: `form.set("storeId", storeId)`.
- Library picker modal only shows mockups from the current template's store.

## User Experience

### `/mockups` Without A Store

- Page title "Mockups".
- Subtitle: "Chọn store để xem mockup".
- Store list visible.
- Search hidden.
- Grid hidden.
- Upload button disabled.
- Empty state: "Chọn store để xem mockup" / "Chọn một store phía trên để xem thư viện mockup của store đó."

### `/mockups` With A Store

- Header/subtitle reflects store: `StoreName · N mockups`.
- Search visible.
- Grid filtered to store.
- Upload button links to `/mockups/upload?storeId=<id>`.
- Empty state names the store.

### No Active Stores / Invalid Store URL

Same pattern as designs: explain no active stores, or show invalid-store message. Do not fall back to another store.

### `/mockups/upload`

- Store selector with initial store preselected.
- Drag-and-drop upload zone (matching current mockup upload UI).
- Back link: "Xem thư viện" → `/mockups?storeId=<storeId>`.

### TemplateMockupPicker

- When opened from a template, library picker shows only that store's mockups.
- Upload from picker sends the template's `storeId`.

## Error Handling

- Upload without `storeId`: rejected by API with 400 validation error.
- Attach mockup to template in different store: rejected with 400 "Mockup does not belong to this store".
- Network failures: keep current page stable, stop loading.
- Invalid store URL: show invalid-store state, let user choose another store.
- All queries tenant-scoped — no cross-tenant data exposure.

## Testing

Source-level tests covering:
- `GET /api/mockups` supports `storeId` query param.
- `POST /api/mockups` requires `storeId` and validates store ownership.
- `/mockups` page skips mockup query without selected store (no global fallback).
- `MockupsClient` has no global/all option; upload link includes `storeId`.
- `/mockups/upload` page preselects valid `storeId` and links back to store library.
- `POST /api/stores/[id]/mockup-templates/[templateId]/mockups` rejects cross-store mockup attach.
