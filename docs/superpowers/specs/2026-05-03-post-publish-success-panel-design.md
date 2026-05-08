# Post-Publish Success Panel

**Date:** 2026-05-03
**File:** `src/app/(authed)/wizard/[draftId]/step-5/page.tsx`

## Problem

After a successful publish, the "Xem sản phẩm" button links to `/products` which does not exist → 404. The success state is also minimal and provides no useful next actions.

## Solution

Replace the current `publishStatus === "SUCCESS"` render block with an inline success panel. No redirect, no new routes, no API changes.

## Data Fix

Capture `listingId` from the SSE `publish.complete` success event:

```
SSE: { type: "publish.complete", data: { status: "ACTIVE", listingId: "..." } }
→ setSuccessListingId(data.data.listingId)
```

Add `const [successListingId, setSuccessListingId] = useState<string | null>(null)`.

## Success Panel

Renders when `publishStatus === "SUCCESS"`. Replaces the publish button entirely.

```
[CheckCircle2 icon, green, 40px]
"Đã publish thành công!"           bold 1rem
[thumbnail 80×80]  [aiContent.title]
[Xem Listing →]    [+ Tạo wizard mới]
 /listings/:id      /wizard
 btn-primary        btn-secondary
```

- Thumbnail: `allMockups[0]` compositeUrl or sourceUrl (already available)
- Title: `aiContent?.title ?? "Sản phẩm của bạn"`
- "Xem Listing" hidden if `successListingId` is null
- "Tạo wizard mới" always visible

## Constraints

- One file only: `step-5/page.tsx`
- No new components, no API changes
- `successListingId` state scoped to this page
