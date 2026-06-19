# Store-First Design Library

## Goal

Change the Design Library from a global filter view into a store-first workflow.
Users must choose a store before seeing designs, and uploads launched from the library must upload into the selected store.

## Decisions

- `/designs` does not auto-select a store when opened without `storeId`.
- The UI does not show `All` or `Unassigned`.
- Upload stays on the existing `/designs/upload` page.
- The library passes the selected store through the URL as `/designs/upload?storeId=<storeId>`.
- The upload page preselects the URL store and links back to `/designs?storeId=<storeId>`.
- No database schema change is required.
- Pairing, mockup, wizard, and publish behavior are out of scope.

## Current Context

The app already has the required data shape:

- `Design.storeId` exists and is indexed with tenant/status.
- `GET /api/designs` supports `storeId`.
- `POST /api/designs/upload` requires `storeId` and validates that the store is active and belongs to the current tenant.
- `/designs/upload` already has a store selector, but it currently defaults to the first active store instead of honoring a selected library context.

The current library UI still presents store selection like filter tabs:

- `All`
- `Unassigned`
- one tab per store

That does not match the customer expectation that store selection is the primary entry point.

## User Experience

### `/designs` Without A Store

When the user opens `/designs` without a `storeId` query parameter:

- Show the page title `Design Library`.
- Show subtitle text telling the user to choose a store.
- Show the active store list.
- Do not show search.
- Do not show the design grid.
- Do not show a usable upload action.
- Show an empty state that says the user must choose a store to view designs.

The page must not silently select the first store.

### Store List

The store list is the primary control on the page.

- It contains only active stores for the current tenant.
- It does not include `All`.
- It does not include `Unassigned`.
- Selecting a store updates the URL to `/designs?storeId=<storeId>`.
- Selecting a store fetches designs for that store.

### `/designs` With A Store

When a valid active store is selected:

- Header/subtitle reflects the selected store, for example `ThreadsMuse · 12 designs`.
- Search becomes visible.
- The existing design grid is shown for that store.
- The top upload button links to `/designs/upload?storeId=<selectedStoreId>`.
- The empty state for zero designs names the selected store and includes an upload button for that store.
- Search empty state remains scoped to the selected store.
- Pagination remains scoped to the selected store.

### No Active Stores

If the tenant has no active stores:

- Show the page title.
- Show an empty state explaining that there is no active store.
- Hide or disable upload actions because uploads require a store.
- Do not attempt to query designs.

### Invalid Store URL

If `/designs?storeId=<id>` points to a missing, inactive, or cross-tenant store:

- Do not fall back to another store.
- Show the store list.
- Show a clear state that the selected store is invalid or inactive.
- Let the user choose another store.
- Do not query or show global designs.

## Upload Flow

`/designs/upload` accepts an optional `storeId` query parameter.

Server behavior:

- Validate the current session.
- Load active stores for the tenant.
- If `storeId` is provided, verify it belongs to one of those stores.
- Pass a valid `initialStoreId` to the client.
- If the query store is invalid, do not preselect it.

Client behavior:

- Initialize the store selector from `initialStoreId`.
- If no `initialStoreId` is present, keep the current first-store default for direct visits to `/designs/upload`.
- Continue sending `storeId` in the existing upload form data.
- Update the `Xem thư viện` link to point back to `/designs?storeId=<currentStoreId>` when a store is selected.
- Keep the current batch upload limits, retry behavior, progress UI, and file validation unchanged.

The upload API contract does not change.

## Component And Routing Changes

### `src/app/(authed)/designs/page.tsx`

- Read `searchParams.storeId`.
- Fetch active stores first.
- If no `storeId`, skip initial design/count queries and pass an empty initial design list.
- If `storeId` is present and valid, fetch the first page of designs for that store.
- If `storeId` is invalid, pass enough state for the client to show the invalid-store message.

### `src/app/(authed)/designs/DesignsClient.tsx`

- Replace filter tabs with a store-first selector.
- Remove `All` and `Unassigned` from the visible UI.
- Keep `activeStoreId` nullable.
- Use Next navigation to keep `?storeId=` in sync when selecting stores.
- Scope search and pagination to the selected store.
- Disable or hide upload until a store is selected.
- Generate upload links with the selected store ID.

### `src/app/(authed)/designs/upload/page.tsx`

- Accept `searchParams`.
- Validate optional `storeId` against the active store list.
- Pass `initialStoreId` to `UploadDesignClient`.

### `src/app/(authed)/designs/upload/UploadDesignClient.tsx`

- Accept `initialStoreId`.
- Initialize the selector from it when valid.
- Link back to `/designs?storeId=<storeId>` after upload.

## Error Handling

- Network failures while fetching designs keep the current page stable and stop loading.
- Invalid store URLs never expose another tenant's data because all server and API queries remain tenant-scoped.
- Upload without `storeId` remains rejected by `POST /api/designs/upload`.
- Direct upload page visits remain usable by defaulting to the first active store when no query store is supplied.

## Testing

Focused verification should cover:

- `/designs` with no `storeId` does not show global designs.
- `/designs` store selector does not include `All` or `Unassigned`.
- Selecting a store scopes fetches to `storeId`.
- Upload links from the library include the selected `storeId`.
- `/designs/upload?storeId=<id>` preselects the store.
- Upload page back link returns to `/designs?storeId=<id>`.
- Invalid store URL shows an invalid-store state instead of falling back to another store.

Run targeted tests around the designs page/upload page and existing API design-store tests. Run `npm run build` if the TSX changes touch routing or server/client props broadly.
