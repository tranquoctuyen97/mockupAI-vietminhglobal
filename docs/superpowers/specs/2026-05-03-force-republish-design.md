# Force Re-publish After External Deletion

**Date:** 2026-05-03

## Problem

When a draft is ACTIVE in DB but the product was manually deleted on Shopify/Printify, re-publishing is blocked with "Draft này đã được publish rồi." The user has no way to re-publish without manual DB intervention.

## Solution

Add a "Publish lại" button in the `alreadyPublished` UI state. Requires explicit confirmation warning that the old listing will be deleted permanently.

## Backend

**New endpoint:** `POST /api/listings/[id]/force-republish`

1. Verify listing belongs to the requesting tenant
2. Verify listing's `wizardDraftId` is set (safety check)
3. Delete listing record (cascades to variants, publishJobs)
4. Reset `wizardDraft.status` to `"READY"`
5. Return `{ ok: true }`

Frontend then calls the normal publish API (`POST /api/wizard/drafts/:draftId/publish`).

## Frontend — step-5/page.tsx

### New state
```
const [showRepublishConfirm, setShowRepublishConfirm] = useState(false)
const [republishing, setRepublishing] = useState(false)
```

### alreadyPublished UI (replaces current single "Xem sản phẩm" button)

When `alreadyPublished && status === "ACTIVE"`:
- Message: "Draft này đã được publish trước đó."
- Button: "Xem Listing →" → `/listings/${listingId}`
- Button: "Publish lại ↺" (secondary) → sets `showRepublishConfirm = true`

### Confirmation dialog (inline, not modal)

Rendered when `showRepublishConfirm === true`:
- Warning text: "Hành động này sẽ XÓA listing cũ và tạo sản phẩm mới trên Shopify & Printify. Listing cũ sẽ không thể khôi phục."
- "Hủy" button → `showRepublishConfirm = false`
- "Xóa & Publish lại" button (danger color) → calls `handleForceRepublish()`

### handleForceRepublish()

1. Call `POST /api/listings/${listingId}/force-republish`
2. On success: reset `publishStatus = "IDLE"`, `publishLogs = []`, `alreadyPublished = false`
3. Call `handlePublish()` immediately to trigger normal publish flow

## Constraints

- 2 files: new API route + step-5/page.tsx
- No schema changes (cascade delete uses existing relations)
- Confirmation is inline card, not a browser `confirm()` dialog
