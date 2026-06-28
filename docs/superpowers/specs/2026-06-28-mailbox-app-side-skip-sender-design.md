# Mailbox App-Side Skip Sender Design

Date: 2026-06-28
Status: Draft for user review

## Goal

Make `Skip sender` work for Gmail App Password mailboxes.

`Skip sender` does two things:

1. Move the current conversation's Gmail thread to Spam, the same Gmail-side
   action as `Report spam`.
2. Store a mailbox-scoped app rule so future Inbox messages from the same
   sender are moved to Spam by the sync worker before they enter RT.

## Scope Decisions

1. Use the current RT + getmail6 + Gmail App Password/IMAP architecture.
2. Do not change the mailbox authentication model or add another provider
   flow.
3. Rules are scoped to one app mailbox. The same sender skipped in mailbox A
   is not skipped in mailbox B.
4. Sender matching is exact normalized email matching:
   `senderEmail.trim().toLowerCase()`.
5. `Skip sender` must reject missing sender emails and the mailbox's own email.
6. Skipped future messages must not create RT tickets, conversations,
   notifications, AI classification work, response metrics, or app Inbox rows.
7. If the Spam move for a future message fails, do not advance the cursor past
   that message.

## Current State

The existing `/api/mailbox-proxy/conversations/:ticketId/skip-sender` route
validates the sender, logs an unsupported action, and returns `501`.

The app already has the Gmail IMAP operation needed for the current-thread
part: `createGmailAdapter(...).reportThreadSpam(gmailThreadId)` adds `\Spam`
and removes `\Inbox`.

The mailbox sync path scans Gmail Inbox metadata before running getmail. That
is the right place to apply future sender rules, because it can prevent
getmail/rt-mailgate from creating RT tickets for skipped senders.

## Data Model

Add a small table:

```prisma
model MailboxSkippedSender {
  id            String   @id @default(cuid())
  mailboxId     String   @map("mailbox_id")
  senderEmail   String   @map("sender_email")
  createdById   String   @map("created_by_id")
  createdAt     DateTime @default(now()) @map("created_at")
  mailbox       Mailbox  @relation(fields: [mailboxId], references: [id], onDelete: Cascade)
  createdBy     User     @relation(fields: [createdById], references: [id], onDelete: Cascade)

  @@unique([mailboxId, senderEmail])
  @@index([createdById, createdAt])
  @@map("mailbox_skipped_senders")
}
```

The stored `senderEmail` is always normalized lowercase.

## API Contract

`POST /api/mailbox-proxy/conversations/:ticketId/skip-sender?storeId=...&mailboxId=...`

Behavior:

1. Authorize tenant, store, and mailbox exactly like other mailbox actions.
2. Load the local `MailboxConversation` by mailbox and RT ticket ID.
3. Validate `senderEmail`.
4. Upsert `MailboxSkippedSender(mailboxId, senderEmail)`.
5. Call `reportThreadSpam(gmailThreadId)` for the current conversation.
6. Remove Inbox labels from the local conversation and mark it unread false,
   matching `Report spam`.
7. Audit `mailbox.skip_sender`.
8. Return:

```json
{
  "ok": true,
  "senderEmail": "bad@example.com"
}
```

The endpoint is idempotent. Repeating it for the same sender and mailbox keeps
one rule and still makes the current thread Spam.

## Sync Flow

During `syncMailbox`:

1. Scan Gmail Inbox metadata.
2. Normalize each message `fromEmail`.
3. Load skipped sender rules for the active mailbox.
4. Split messages into skipped and allowed.
5. For skipped messages:
   - move the Gmail message/thread to Spam through IMAP;
   - record the Gmail message link as skipped, or at minimum leave no RT link;
   - advance cursor only after the Spam move succeeds.
6. Run getmail only for allowed messages.
7. Persist/reconcile allowed messages normally.

The lazy implementation can use a message/thread-level Gmail adapter method
that reuses the same label semantics as `reportThreadSpam`: add `\Spam`, remove
`\Inbox`, and do not change `\Seen`.

## Error Handling

- Missing sender email: return `422`.
- Sender equals mailbox email: return `422`.
- Gmail Spam move fails for current conversation: return the Gmail error and
  do not claim success.
- Gmail Spam move fails for future sync: leave the cursor before that UID so
  the worker retries later.
- Duplicate rule: treat as success.

## Testing

Focused tests should prove:

- `handleSkipSender` no longer returns the current unsupported `501`.
- `handleSkipSender` upserts the skipped sender and reuses current spam
  conversation behavior.
- The Gmail adapter can move a specific Inbox message/thread to Spam without
  marking it read.
- `syncMailbox` filters skipped sender messages before `runGetmail`.
- Failed Spam moves do not advance `lastCommittedUid`.
- Rules are mailbox-scoped.

## Acceptance Criteria

1. Clicking `Skip sender` moves the current conversation to Gmail Spam.
2. Clicking `Skip sender` stores one mailbox-scoped sender rule.
3. Future Inbox messages from that sender are moved to Gmail Spam before RT
   ingest.
4. Skipped future messages do not appear in the app mailbox list.
5. The implementation uses Gmail App Password/IMAP only.
