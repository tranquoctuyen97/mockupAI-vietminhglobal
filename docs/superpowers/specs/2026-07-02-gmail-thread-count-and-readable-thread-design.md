# Gmail Thread Count and Readable Thread Design

Date: 2026-07-02
Status: Draft for user review

## Goal

Make the mailbox list feel closer to Gmail:

- Inbox/mailbox badges count unread Inbox conversations.
- Each conversation row shows total messages/replies in that Gmail thread.
- Opening a conversation shows readable email messages, not placeholder
  `Message-ID` rows.
- Existing conversations get correct message counts through a one-time backfill.

## Scope

Use Gmail thread identity as the source of truth. The live IMAP proof showed
that Gmail returns both inbound and app-sent replies from `[Gmail]/All Mail`
when queried by `X-GM-THRID`.

Keep list pagination DB-backed. Do not fetch Gmail bodies or count every row
from IMAP during normal list rendering.

## Data Contract

`MailboxConversation.articleCount` is the list-row total message count for the
Gmail thread.

The list API keeps returning `articleCount` in
`GET /api/mailbox-proxy/conversations`. The UI shows that value as the thread
message/reply count on each row.

Mailbox unread badges continue to count unread conversations that still have
the active Inbox label. This stays conversation-level, not per-message.

## Backfill Existing Conversations

Add one script:

`scripts/backfill-gmail-thread-counts.ts`

Arguments:

- `--mailbox-id <id>`: required, run one mailbox at a time.
- `--limit <n>`: optional batch limit.
- `--dry-run`: optional, print changes without writing.

Behavior:

1. Load the mailbox and decrypt its Gmail App Password.
2. Read conversations with a `gmailThreadId`.
3. For each thread, fetch `[Gmail]/All Mail` by Gmail thread ID.
4. Count returned messages.
5. Update `MailboxConversation.articleCount` only when the count differs.
6. Log `checked`, `updated`, `unchanged`, `skipped`, and `failed`.

The script does not store old email bodies. It only fixes counts.

## Conversation Detail

For Gmail-only conversations, replace placeholder thread rows with real Gmail
messages fetched from `[Gmail]/All Mail` by `gmailThreadId`.

Returned thread items should include:

- from
- to
- subject
- date
- text or HTML body
- content type
- direction/display type

After fetching detail, if the Gmail message count differs from
`articleCount`, update the conversation snapshot. This makes old or externally
changed conversations self-heal when opened.

RT-backed conversations can keep using the existing RT transaction detail path,
with Gmail lookup added only where the current detail view cannot show readable
Gmail content.

## Sync and Reply Updates

Inbound sync keeps updating the conversation snapshot as it does today. When a
new Gmail message lands in an existing thread, `articleCount` should reflect
the known thread size. If exact thread size is not available in that sync pass,
the count can stay conservative and be corrected by detail fetch or backfill.

App-sent replies increment `articleCount` immediately after Gmail confirms the
reply belongs to the same `gmailThreadId`.

## UI

Conversation rows show:

- unread state using the existing unread styling
- subject/sender/date as today
- a compact message count badge when `articleCount > 1`

No new mailbox navigation model is needed.

## Error Handling

- If Gmail detail fetch fails, return a clear upstream error instead of showing
  placeholder `Message-ID` bodies.
- If one backfill thread fails, log it and continue with the next thread.
- If a Gmail thread returns zero messages, skip updating that conversation.
- If Gmail returns a different thread ID than requested, fail that thread and
  log `gmail_thread_mismatch`.

## Testing

Add focused checks for:

- list normalization still returns `articleCount`
- mailbox unread count remains Inbox unread conversation count
- detail fetch maps Gmail messages into readable thread rows
- detail fetch repairs stale `articleCount`
- backfill script supports `--dry-run`, `--limit`, and per-thread failure
  continuation

## Acceptance Criteria

1. Inbox/mailbox badge shows unread Inbox conversation count.
2. Each conversation row can show total Gmail thread message/reply count.
3. Existing conversations can be corrected by running one backfill script.
4. Opening a Gmail-only conversation shows readable message bodies.
5. List pagination remains DB-backed and does not IMAP-fetch every row.
6. No bulk storage of historical Gmail bodies is introduced.
