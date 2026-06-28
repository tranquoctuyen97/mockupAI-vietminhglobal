# Mailbox List DB Snapshot Design

Date: 2026-06-28
Status: Draft for user review

## Goal

Make mailbox conversation pagination fast and predictable. Clicking `Prev` or
`Next` should not wait on RT list/search calls for every page load.

The list view should render from app database snapshots. RT remains the
upstream ticket/thread system, but it should not be on the hot path for
paginated list rows.

## Current Problem

The current `/api/mailbox-proxy/conversations` path does this:

- Inbox/label pages query DB for conversation IDs, then call RT
  `listTicketsByIds(...)` to hydrate subject/status/requestor/article count.
- Non-label pages call RT `searchTickets(...)` directly.
- The client does not cache page responses. Returning from page 2 to page 1
  fetches again.

That means page navigation is gated by RT latency even though the app already
stores most conversation state locally.

## Scope Decisions

1. The app database becomes the source for mailbox list rows.
2. RT is still used for conversation detail, attachments, send reply, status
   mutation, and background repair/reconcile.
3. `/api/mailbox-proxy/conversations` must not call RT for normal list
   pagination.
4. The list API should support the same mailbox filters as today: selected
   store, selected mailbox, label, status, page, and page size.
5. The client may add an in-memory page cache for instant back/forward within
   one session, but correctness comes from the DB-backed API.
6. Snapshot data can be eventually consistent with RT. The app is the primary
   mailbox UI, so app-driven changes must update the snapshot immediately.

## Data Model

Extend `MailboxConversation` with list snapshot fields:

- `subject`
- `articleCount`
- `rtStatus`
- `rtCreatedAt`
- `rtLastUpdatedAt`

Existing useful fields remain:

- `senderName`
- `senderEmail`
- `status`
- `isUnread`
- `lastActivityAt`
- labels through `ConversationLabel`

Indexes should support fast list queries:

- `[mailboxId, status, lastActivityAt]` already exists.
- Keep or add label join indexes through `ConversationLabel`.
- If needed, add `[mailboxId, rtLastUpdatedAt]` for repair/reconcile scans.

## Data Flow

### Inbound Mail

When `verified-rt-mailgate` resolves a new RT ticket/transaction and creates or
updates `MailboxConversation`, it should save list snapshot fields known at
that point:

- `rtTicketId`
- `gmailThreadId`
- `subject` from MIME subject or RT ticket fallback
- `senderName` / `senderEmail` from Gmail metadata when available
- `lastActivityAt` from Gmail internal date
- `articleCount` at least `1`

If exact RT `TransactionCount` is not available in that flow, store a safe
minimum and let reconcile repair it later.

### Sync/Reconcile

`src/lib/mailboxes/sync.ts` already observes inbound Gmail metadata. When it
touches an existing conversation, it should update sender, unread, and
`lastActivityAt` as today, plus preserve or improve the subject snapshot when
the Gmail subject is available.

### App Actions

App-owned operations update snapshots immediately:

- Reply success increments or refreshes `articleCount`, sets
  `rtLastUpdatedAt`/`lastActivityAt`, and keeps the subject.
- Status update writes `status` and `rtStatus`.
- Mark read/unread updates `isUnread`.
- Label changes already update local label joins.
- Spam/report removes Inbox label and updates unread state.

### Background Repair

Add a repair/rebuild script or helper that loads RT tickets for existing
conversations and fills missing snapshot fields. This is for historical data
and drift repair, not for every page click.

## API Contract

`GET /api/mailbox-proxy/conversations` should:

1. Authorize tenant/store/mailbox as it does today.
2. Query `MailboxConversation` from DB using the requested filters.
3. Include labels from local `ConversationLabel`/`GmailLabel`.
4. Return the same response shape the client expects:
   `id`, `mailboxId`, `number`, `subject`, `status`, `updatedAt`, `createdAt`,
   `articleCount`, `fromName`, `fromEmail`, `labels`, and `unread`.
5. Avoid `searchTickets(...)` and `listTicketsByIds(...)` in the list path.

Conversation detail still calls RT history and attachments when the user opens
one row.

## Client Cache

Add a small in-memory cache in `MailboxesClient` keyed by:

`storeId:mailboxId:labelId:page:pageSize`

Behavior:

- If the cache has the requested page, render it immediately.
- Still allow manual refresh and polling to update the cache.
- Clear cache when store, mailbox, label, status, or any write action changes.
- Keep cache local to the page session; no persistence is needed.

## Error Handling

- If DB query fails, return a normal 500/502 style API error.
- If RT is down, list pagination should still work from DB snapshots.
- If a snapshot is missing optional fields, use safe fallbacks:
  - subject: `"(no subject)"`
  - articleCount: `0`
  - updatedAt: `lastActivityAt ?? updatedAt`
  - sender: existing sender fields or unknown sender fallback

## Testing

Tests should prove:

- List API source no longer calls `searchTickets` or `listTicketsByIds`.
- DB rows are normalized into the same conversation shape used by the UI.
- Label/status pagination is DB-only.
- Page 1 -> page 2 -> page 1 can use client cache.
- Reply/status/read/label actions invalidate or refresh relevant cache.
- Backfill/repair can populate missing snapshot fields for old conversations.

## Acceptance Criteria

1. Clicking `Prev`/`Next` does not call RT for list rows.
2. Page navigation is backed by DB indexes and returns quickly.
3. Returning to a recently viewed page is instant from client cache.
4. RT outage does not block mailbox list pagination.
5. Opening a conversation can still call RT for thread/detail.
6. Existing conversations can be repaired/backfilled with list snapshot fields.
