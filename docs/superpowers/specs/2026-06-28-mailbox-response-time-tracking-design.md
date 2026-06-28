# Mailbox Response Time Tracking Design

Date: 2026-06-28
Status: Draft for user review

## Goal

Track how long customer email conversations take to receive the latest admin
reply, then surface slow or overdue conversations and monthly response-time
summary metrics.

The business metric is conversation-level response duration:

- start from the first customer email in a conversation;
- update the duration every time an admin reply is successfully sent from the
  app;
- do not reset the start time when the customer and admin continue replying;
- show pending age while no admin reply exists; and
- bucket monthly reports by the month of the first customer email; and
- attribute completed response duration to the admin/operator who sent the
  latest successful app reply.

Example:

1. Customer emails at 10:00.
2. Admin replies at 11:00. Current response duration is 1 hour.
3. Customer replies again at 12:00.
4. Admin replies again at 13:00. Current response duration is 3 hours, measured
   from 10:00 to 13:00 and attributed to that 13:00 replying user.

## Definitions

`responseStartedAt`
: The timestamp of the first customer email that belongs to a mailbox
conversation. This timestamp is immutable after it is set.

`latestAdminReplyAt`
: The timestamp of the latest successful app-sent admin reply for the
conversation. This is updated on every successful admin reply.

`latestAdminReplyActorUserId`
: The app user ID of the admin/operator who sent `latestAdminReplyAt`. This is
updated together with `latestAdminReplyAt` and is the owner of the completed
response-duration metric for performance reporting.

`responseDurationMs`
: `latestAdminReplyAt - responseStartedAt`. It is null until the first
successful admin reply exists.

`currentPendingAgeMs`
: `now - responseStartedAt` when no admin reply exists. This is computed at
read time and is not stored as a durable value.

`reportMonth`
: The month derived from `responseStartedAt`, in UTC month boundaries unless a
future product decision introduces tenant-specific reporting time zones.

`overdue`
: A conversation whose completed duration or current pending age is greater
than 24 hours. The 24-hour threshold is a dashboard and reporting threshold,
not the only value stored by the system.

## Scope Decisions

1. Use the active RT + getmail6 Gmail mailbox architecture. Do not introduce
   Zammad compatibility or migration behavior.
2. Track metrics per `MailboxConversation`, not per individual email message.
3. `responseStartedAt` comes from the first inbound customer Gmail message
   linked to the conversation.
4. `latestAdminReplyAt` comes only from successful replies sent through the app
   reply path after Gmail Sent read-back confirms the reply.
5. Failed admin replies do not update response metrics.
6. Customer follow-up emails do not reset `responseStartedAt`.
7. Admin follow-up replies update `latestAdminReplyAt`.
8. Admin/operator performance attribution belongs to the latest successful
   replying user. If user A replies at 11:00 and user B replies at 13:00, the
   current 3-hour metric is attributed to user B.
9. Monthly reports count a conversation in the month of `responseStartedAt`,
   even when admin replies happen in a later month.
10. The MVP uses the latest admin reply at report time. It does not snapshot
   month-end values.
11. The dashboard can flag conversations over 24 hours, but stored metrics must
    preserve exact timestamps and durations so thresholds can change later.

## Non-Goals

- No first-response-only KPI.
- No per-message SLA tracking.
- No explicit "resolved" or "closed" workflow requirement.
- No immutable month-end snapshots in the MVP.
- No new mailbox ownership model.
- No ingestion changes outside the metric hooks needed for existing inbound
  sync.
- No client-trusted timestamps.

## Data Model

Add a dedicated response metric record keyed one-to-one to
`MailboxConversation`.

Recommended Prisma model:

```prisma
model MailboxResponseMetric {
  conversationId      String   @id @map("conversation_id")
  mailboxId           String   @map("mailbox_id")
  tenantId            String   @map("tenant_id")
  storeId             String   @map("store_id")
  responseStartedAt   DateTime @map("response_started_at")
  latestAdminReplyAt  DateTime? @map("latest_admin_reply_at")
  latestAdminReplyActorUserId String? @map("latest_admin_reply_actor_user_id")
  responseDurationMs  BigInt?  @map("response_duration_ms")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  conversation MailboxConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  mailbox      Mailbox             @relation(fields: [mailboxId], references: [id], onDelete: Cascade)
  tenant       Tenant              @relation(fields: [tenantId], references: [id])
  store        Store               @relation(fields: [storeId], references: [id], onDelete: Cascade)
  latestAdminReplyActor User?      @relation(fields: [latestAdminReplyActorUserId], references: [id], onDelete: SetNull)

  @@index([tenantId, storeId, responseStartedAt])
  @@index([mailboxId, responseStartedAt])
  @@index([latestAdminReplyAt])
  @@index([latestAdminReplyActorUserId, responseStartedAt])
  @@map("mailbox_response_metrics")
}
```

`MailboxConversation` also needs the inverse optional relation, for example:

```prisma
responseMetric MailboxResponseMetric?
```

The model denormalizes `tenantId`, `storeId`, and `mailboxId` for efficient
dashboard and monthly reporting. These values are copied from the owning
mailbox/conversation at creation time and do not grant authorization by
themselves; API routes still authorize through the selected tenant, store, and
mailbox.

If the existing schema makes a one-to-one relation on `MailboxConversation`
awkward, the implementation may store the same fields directly on
`MailboxConversation`. The dedicated model is preferred because the metric can
evolve without crowding conversation display state.

## Service Boundary

Add a focused metric service, for example
`src/lib/mailboxes/response-metrics.ts`, with these operations:

```ts
recordCustomerMessage(input: {
  tenantId: string;
  storeId: string;
  mailboxId: string;
  conversationId: string;
  messageAt: Date;
}): Promise<void>

recordAdminReply(input: {
  conversationId: string;
  actorUserId: string;
  repliedAt: Date;
}): Promise<void>
```

`recordCustomerMessage` creates the metric only if it does not already exist.
If it already exists, it leaves `responseStartedAt` unchanged.

`recordAdminReply` updates `latestAdminReplyAt` to the sent reply timestamp and
updates `latestAdminReplyActorUserId` to the replying admin/operator. It also
recomputes `responseDurationMs` from the stored `responseStartedAt`. If
multiple app replies succeed, the latest successful reply and latest replying
actor win.

The service owns all duration math. Sync code and route handlers should call
the service instead of duplicating timestamp logic.

## Data Flow

### Inbound Sync

The existing inbound sync path persists Gmail message links as `INBOUND` in
`src/lib/mailboxes/sync.ts`. When a message is linked to an existing
conversation or becomes associated with one after RT confirmation, the sync
path calls `recordCustomerMessage(...)` with the Gmail message `internalDate`.

Only inbound customer messages should create the metric. The current Gmail
metadata includes sender email and the mailbox email is available through the
mailbox record, so implementation should ignore messages from the mailbox's
own email address and delivery-system senders in the same spirit as the reply
gate logic.

Existing conversations should be covered by the rebuild path described below,
not by ad hoc manual SQL.

### Admin Reply

The app reply path in `src/app/api/mailbox-proxy/[...path]/route.ts` sends
through Gmail SMTP, performs Gmail Sent read-back, creates an `OUTBOUND`
`GmailMessageLink`, records the RT comment marker, and writes the audit log.

The metric update happens only after Gmail Sent read-back succeeds and the
outbound link is persisted. Use the reply timestamp returned by Gmail metadata
when available, because it reflects the message accepted into Gmail. If that
metadata is unavailable in a future fallback path, use the server timestamp at
the point the reply is confirmed. The actor comes from the authenticated app
session user that initiated the reply request.

### Dashboard And Reports

Dashboard queries read the metric table and compute:

- pending age for rows with `latestAdminReplyAt = null`;
- completed duration for rows with `responseDurationMs != null`; and
- overdue state using the 24-hour threshold.

Monthly reports group by the month of `responseStartedAt`.

Minimum summary fields:

- total conversations started in the period;
- replied conversations;
- unreplied conversations;
- overdue conversations;
- average completed response duration;
- maximum completed response duration; and
- current oldest pending conversation age.
- actor breakdown for completed responses, grouped by
  `latestAdminReplyActorUserId`.

Filters should match mailbox conventions already used by the app:

- tenant;
- store;
- mailbox;
- admin/operator actor;
- month range; and
- overdue only.

## API Surface

Add server-side report endpoints under the existing authenticated mailbox API
surface. Exact route names can follow local conventions during implementation,
but the contract should provide:

- monthly summary by store/mailbox;
- monthly summary by latest replying actor;
- overdue conversation list; and
- optional conversation detail fields for UI badges.

Responses should expose ISO timestamps and integer millisecond durations. They
should not expose Gmail credentials, raw RT auth details, or untrusted client
timestamps.

## UI Scope

The first UI should be operational rather than decorative:

- an overdue count visible near mailbox/dashboard navigation;
- an overdue conversation list with customer, mailbox, started time, current
  age, and last admin reply if present; and
- a monthly summary table or compact dashboard section with totals and average
  duration.

The detailed visual layout can be handled in the implementation plan. This spec
only requires that the UI make conversations over 24 hours easy to find.

## Error Handling

- If inbound sync cannot create a metric after linking a message, fail the sync
  transaction or surface a sync error rather than silently losing tracking.
- If an admin reply succeeds but metric update fails, the reply must not be
  sent twice. The route should persist enough outbound link data for a rebuild
  job to repair the metric and should return a clear server error only if the
  local transaction cannot complete.
- Duration math must clamp negative durations to an error path instead of
  storing negative values. Negative durations indicate bad timestamps or a bug.
- Report endpoints should return empty summaries for periods with no data, not
  500 errors.

## Backfill And Repair

Add a safe rebuild script or service function as part of the initial rollout:

1. Find conversations with inbound links but no metric.
2. Set `responseStartedAt` to the earliest inbound Gmail message timestamp.
3. Set `latestAdminReplyAt` to the latest outbound Gmail message timestamp when
   present.
4. Recompute `responseDurationMs`.
5. Leave conversations without inbound timestamps untouched and report them as
   skipped.

The rebuild must be idempotent and should support a dry-run mode before it
writes changes.

## Testing

Unit and contract tests should cover:

- `recordCustomerMessage` creates the metric once and does not reset
  `responseStartedAt` on later customer replies;
- `recordAdminReply` updates `latestAdminReplyAt` and recomputes duration on
  every successful admin reply;
- `recordAdminReply` updates `latestAdminReplyActorUserId` to the latest
  replying admin/operator;
- the 10:00 -> 11:00 -> 12:00 -> 13:00 scenario produces a 3-hour response
  duration attributed to the 13:00 replying user;
- failed Gmail replies do not update response metrics;
- monthly grouping uses `responseStartedAt`, including conversations replied in
  a later month;
- overdue classification for unreplied and completed conversations;
- report filtering by tenant, store, and mailbox; and
- report grouping/filtering by latest replying actor; and
- backfill derives metric values from inbound and outbound message links
  idempotently.

Focused verification should include Prisma validation and the mailbox tests
that exercise sync, reply, and report helpers. Broader build verification can
follow the repo's existing mailbox validation pattern.

## Acceptance Criteria

1. Existing and new customer conversations get a durable response metric.
2. Customer follow-up emails never reset the metric start timestamp.
3. Every successful app-sent admin reply updates the latest admin reply
   timestamp, latest replying user, and response duration.
4. The example flow from 10:00 to 13:00 reports 3 hours for the user who sent
   the 13:00 reply.
5. Conversations over 24 hours can be listed for dashboard attention.
6. Monthly summaries count conversations by the month of the first customer
   email.
7. Failed replies do not change metric state.
8. Metrics can be rebuilt from existing Gmail message links without creating
   duplicates.
