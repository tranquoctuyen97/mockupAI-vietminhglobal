# RT + getmail6 Gmail Mailbox Replacement Design

Date: 2026-06-24
Status: Approved
Replaces: Zammad mailbox integration

## Goal

Replace the non-production Zammad mailbox backend with Request Tracker 6.0.3,
getmail6 6.20.0, and a Gmail Label Controller.

The resulting mailbox feature must:

- import only messages in Gmail Inbox;
- preserve Gmail Unread state;
- import at most the latest six months on initial connection;
- poll for new mail every minute;
- support full Gmail user-label CRUD from the app;
- show and filter labels only within the selected Gmail mailbox;
- apply labels at the conversation/ticket level;
- send replies through the selected Gmail account so they appear in Sent and
  remain in the same Gmail thread; and
- remove every active Zammad dependency without migrating Zammad data.

## Evidence And Constraints

The design is grounded in the Gmail lab results recorded on 2026-06-24:

- RT 6.0.3 + getmail6 6.20.0 imported the test message into RT.
- `use_peek=true` and `delete=false` preserved the message's Unread state.
- A second getmail cycle skipped the message through its retrieval cache and
  did not create a duplicate ticket.
- Gmail IMAP `CREATE` and `UID STORE +X-GM-LABELS` created and assigned
  `Helpdesk/RT-Imported` while leaving the message Unread.

The following production behaviors are still mandatory verification gates:

- label rename and delete through Gmail IMAP;
- RT reply through Gmail SMTP appearing in Sent;
- Gmail threading for an RT reply and the following customer reply; and
- deterministic confirmation of the RT ticket and transaction created by the
  verified MDA wrapper.

Failure of any gate blocks rollout. It does not permit weakening the
requirements or silently falling back to Zammad.

## Scope Decisions

1. Zammad has not run in production. Perform a clean replacement and do not
   migrate tickets, users, groups, channels, or credentials from Zammad.
2. A mailbox is owned by one store. A store can own multiple mailboxes.
3. Gmail credentials remain email plus App Password. OAuth is out of scope.
4. Only Inbox messages are eligible for ingestion. Spam, Trash, Sent, and All
   Mail are never ingestion sources.
5. Metadata-only lookup of an already-known Gmail message in Sent or All Mail
   is allowed for threading and label reconciliation. It must not discover or
   ingest unrelated messages.
6. App users are the only intended writers of user-created labels. Gmail is
   still the authoritative external state: a mutation is confirmed only after
   Gmail accepts it and a read-back matches.
7. Labels belong to a Gmail mailbox, not a store-wide global catalog. Labels
   from one Gmail account must never appear while another mailbox is selected.
8. Labels are conversation-level in the app. The confirmed label set applies
   to all known messages in the Gmail thread and to future inbound messages in
   that conversation.
9. Imported tickets remain in RT and the app after their Gmail messages leave
   Inbox.
10. Inbound reconciliation polls every minute. Interactive label commands are
    dispatched immediately and do not wait for the next poll.

## Non-Goals

- No Zammad compatibility or dual-run mode.
- No Zammad ticket migration.
- No Gmail OAuth implementation.
- No ingestion from Gmail labels/folders other than Inbox.
- No app operations for read/unread, archive, spam, trash, or delete message.
- No cross-mailbox label catalog.
- No per-user mailbox assignment or new user-store ACL system.
- No exposure of RT's native UI to normal app users.

## Architecture

```text
Next.js app
  |-- App database
  |-- RT REST2 client
  |-- label mutation API -> durable label-operation outbox
  |
Gmail Label Controller / worker
  |-- one-minute mailbox scheduler and distributed lock
  |-- Gmail IMAP metadata and X-GM-LABELS adapter
  |-- getmail6 runner and runtime config renderer
  |-- immediate label-operation consumer
  |-- RT custom-field reconciler
  |
getmail6
  |-- Gmail INBOX, BODY.PEEK, delete=false
  |-- verified MDA wrapper
        |-- rt-mailgate -> one RT queue per Gmail mailbox
        |-- confirm RT ticket/transaction before exit 0
  |
RT -> SMTP router/msmtp -> smtp.gmail.com -> customer
```

### Next.js App

The app remains the only user-facing mailbox interface. It owns tenant/store
authorization, mailbox configuration, label CRUD commands, conversation
filters, replies, status updates, audit logging, and user-visible sync health.

All Gmail and RT calls remain server-side. Client requests reference app IDs;
they never supply trusted RT queue IDs, Gmail message IDs, or IMAP UIDs.

### Request Tracker

RT is the ticket and correspondence engine.

- Each Gmail mailbox maps to one RT queue.
- Queue `CorrespondAddress` matches the Gmail address.
- Ticket status, messages, attachments, and correspondence live in RT.
- A ticket custom field named `Gmail Labels` mirrors the confirmed
  conversation label set and supports server-side filtering.
- RT REST2 is used to list/search tickets, load history and attachments, update
  status, correspond, administer queues, and synchronize the custom field.

Labels do not create RT queues. A queue is a mailbox boundary; labels are
ticket metadata inside that boundary.

### getmail6

getmail6 remains the raw message retrieval engine because its tested PEEK,
non-delete, delivery cache, and external MDA behavior already meet the primary
Unread and duplicate requirements.

Each active mailbox has runtime configuration with:

- `SimpleIMAPSSLRetriever`;
- `mailboxes = ("INBOX",)`;
- `use_peek = true`;
- `delete = false`;
- a controller-rendered IMAP search: `SINCE <initialSyncAfter>` during the
  bootstrap cycle, then `UID <lastCommittedUid + 1>:*` during steady state; and
- `MDA_external` pointing to the verified wrapper.

The runtime config contains mailbox IDs and non-secret settings only. Its
`password_command` obtains the decrypted App Password through the secret
helper. A password must never be written into getmail configuration, process
arguments, logs, ticket content, or audit metadata.

### Verified MDA Wrapper

The wrapper receives one RFC822 message from getmail6, forwards it to
`rt-mailgate --action correspond --queue <queue>`, and confirms that RT created
or updated the expected ticket transaction.

The wrapper correlates the message through the pre-indexed RFC Message-ID and
Gmail identity. It exits zero only after the ticket/transaction link is saved.
If RT rejects the message, the required ACL is missing, the ticket cannot be
confirmed, or the identity link cannot be persisted, the wrapper exits
non-zero. This prevents getmail6 from recording a false successful delivery.

### Gmail Label Controller

The controller has two independent workloads:

1. A one-minute inbound/reconciliation cycle per active mailbox.
2. An immediate consumer for interactive label operations.

It uses Gmail's IMAP extension to read `X-GM-MSGID`, `X-GM-THRID`,
`X-GM-LABELS`, UID metadata, and flags without adding `\\Seen`. It implements
label `CREATE`, `RENAME`, `DELETE`, `+X-GM-LABELS`, and `-X-GM-LABELS` behind a
small adapter with explicit quoting and read-back verification.

### SMTP Router

RT correspondence is handed to a local SMTP router such as msmtp. The router
selects the Gmail SMTP account from the envelope/from address associated with
the RT queue. It retrieves the App Password through the same secret helper and
relays through `smtp.gmail.com:587` with TLS.

The reply path must preserve `Message-ID`, `In-Reply-To`, and `References` so
Gmail places the reply in Sent and the existing thread. This is an acceptance
gate, not a best-effort enhancement.

## Data Model

Names below describe the target responsibilities. Exact Prisma field names may
follow existing repository conventions during planning.

### Mailbox

Retain store ownership and replace Zammad identifiers with RT/sync fields:

- `tenantId`, `storeId`, `name`, `email`, `provider`, `isActive`;
- `rtQueueId` as a globally unique external queue identifier;
- encrypted App Password envelope and key ID;
- `initialSyncAfter`, fixed at connection time to current time minus six
  months;
- `syncStatus`: `PROVISIONING`, `ACTIVE`, `DEGRADED`, or `DISABLED`;
- `lastSyncAt`, `lastSyncErrorCode`, and retry metadata; and
- RT and Gmail provisioning versions for idempotent repair.

### MailboxSyncCursor

Store controller reconciliation state separately from getmail's delivery
cache:

- `mailboxId`;
- Gmail `UIDVALIDITY`;
- last fully committed UID;
- last successful reconciliation timestamp; and
- lease/lock metadata where required by the selected worker mechanism.

### GmailLabel

- app `id` and `mailboxId`;
- exact Gmail label name, including hierarchy separators;
- normalized comparison key scoped to the mailbox;
- type: `USER`, `INBOX`, `IMPORTANT`, or `STARRED`;
- mutability flag;
- lifecycle state: `ACTIVE`, `PENDING_CREATE`, `PENDING_RENAME`,
  `PENDING_DELETE`, or `FAILED`; and
- last Gmail confirmation timestamp.

`INBOX` is fixed. `IMPORTANT` and `STARRED` may be exposed as read-only
filters. Spam, Trash, Sent, and All Mail are not added to the visible catalog.

### MailboxConversation

- `mailboxId` and `rtTicketId`;
- Gmail thread ID as a string, unique within the mailbox;
- current confirmed status and last activity timestamps; and
- synchronization health needed for targeted repair.

### GmailMessageLink

- `mailboxId` and conversation ID;
- Gmail message ID and Gmail thread ID as strings;
- RFC Message-ID;
- IMAP UID plus UIDVALIDITY;
- RT ticket and transaction IDs; and
- direction: inbound or outbound.

Unique constraints on mailbox plus Gmail message ID and mailbox plus RT
transaction ID provide the primary duplicate barriers. IMAP UID alone is never
treated as a permanent identity.

### ConversationLabel

This join contains the confirmed conversation-level label set. It is updated
only after Gmail read-back succeeds. The same set is mirrored to RT's `Gmail
Labels` ticket custom field.

### GmailLabelOperation

The durable outbox stores:

- mailbox, optional conversation, label, and actor IDs;
- operation type: create, rename, delete, assign, or unassign;
- desired payload and idempotency key;
- state: pending, running, succeeded, failed, or dead-letter;
- attempt count, next attempt time, safe error code, and timestamps.

Credentials, raw emails, and RT/Gmail tokens are prohibited from this table.

## Provisioning Flow

1. Validate tenant, active store, mailbox address, and App Password input.
2. Test Gmail IMAP with `X-GM-EXT-1` capability.
3. Test Gmail SMTP without logging or persisting plaintext credentials.
4. Create the RT queue, set its correspondence address, apply required ACLs,
   and attach the `Gmail Labels` custom field.
5. Persist the encrypted credential and mailbox row.
6. Set `initialSyncAfter` to exactly six months before provisioning time.
7. Render non-secret runtime getmail/msmtp configuration.
8. Run a no-message connectivity and ACL probe.
9. Mark the mailbox `ACTIVE` only after all resources are confirmed.

Provisioning is compensating and idempotent. A failure after RT queue creation
disables or removes the partial queue and leaves an actionable mailbox error.
Retrying the request must repair or reuse matching resources rather than create
duplicate queues.

## Inbound And Reconciliation Flow

For each active mailbox, every minute:

1. Acquire a distributed mailbox lock. Skip if a non-expired lease exists.
2. Connect to Gmail and select Inbox read-only for metadata inspection.
3. On bootstrap, search only messages at or after the fixed initial-sync date.
   On later cycles, search only UIDs after the last fully committed UID.
4. Fetch flags, labels, Gmail message/thread identity, and safe headers using
   PEEK.
5. Pre-index identity and label metadata without creating a conversation.
6. Run getmail6 for the mailbox.
7. The verified wrapper delivers each raw message and persists the RT link.
8. Reconcile the ticket's conversation label set and RT custom field.
9. For an inbound message on an existing conversation, apply the conversation's
   confirmed label set to that message and verify it remains Unread.
10. Commit controller cursors and health only after the cycle succeeds.

Messages older than the bootstrap cutoff, messages outside Inbox, and unknown
messages found through metadata-only Sent/All Mail lookups are not delivered.

## Label Semantics

### Visible Scope

The label sidebar is loaded after both store and mailbox selection. Queries are
always constrained by `tenantId + storeId + mailboxId`. No aggregate store-wide
label list exists.

### Full CRUD

- Create makes a Gmail user label and then activates its app catalog row.
- Rename renames the Gmail label, verifies the new name, updates confirmed
  conversation joins, and refreshes the RT custom field.
- Delete removes the Gmail label globally for that mailbox, removes confirmed
  conversation joins, and refreshes affected RT tickets. It never deletes a
  ticket or email.
- Assign applies the label to all known Gmail messages in the conversation.
- Unassign removes it from all known Gmail messages in the conversation.

Create, rename, and delete apply only to mutable user labels. Inbox and exposed
system filters cannot be mutated.

### Conversation Inheritance

The confirmed conversation label set is the desired set for future messages in
that ticket. When a new inbound or known outbound message is linked to the
conversation, the controller applies that set to the message and verifies the
result. A failure leaves the operation retryable and the UI shows the sync
problem instead of claiming success.

### Archived Messages

Archiving does not remove the RT ticket or Gmail identity link. For a known
thread, the controller may search Gmail metadata by stored Gmail thread/message
identity in All Mail or Sent and mutate only those known messages. It does not
enumerate or ingest unrelated messages.

## App API

Existing store-first admin and operator behavior remains, but Zammad internals
are replaced.

### Admin Mailbox Routes

- `GET /api/admin/mailboxes?storeId=...`
- `POST /api/admin/mailboxes`
- `GET /api/admin/mailboxes/:id`
- `PUT /api/admin/mailboxes/:id`
- `POST /api/admin/mailboxes/:id/status`
- connection/probe routes required by the create and edit flows

The create route provisions RT, controller, and SMTP resources. Moving an
existing mailbox to another store remains unsupported.

### Operator Routes

- `GET /api/mailbox-proxy/mailboxes?storeId=...`
- `GET /api/mailbox-proxy/conversations?storeId=...&mailboxId=...&status=...&labelId=...`
- `GET /api/mailbox-proxy/conversations/:id?storeId=...`
- `POST /api/mailbox-proxy/conversations/:id/threads?storeId=...`
- `PUT /api/mailbox-proxy/conversations/:id?storeId=...`
- `GET /api/mailbox-proxy/labels?storeId=...&mailboxId=...`
- `POST /api/mailbox-proxy/labels`
- `PATCH /api/mailbox-proxy/labels/:labelId`
- `DELETE /api/mailbox-proxy/labels/:labelId`
- `PUT /api/mailbox-proxy/conversations/:id/labels`

The conversation-label route accepts the complete desired user-label set. A
replace-style contract avoids concurrent add/remove races. The server computes
operations against the confirmed set.

Interactive mutations write the operation and dispatch a worker job in the same
request transaction boundary. A quickly confirmed operation may return success;
otherwise the route returns `202` with an operation ID. The UI renders pending
state and refreshes until success or failure.

## UI Behavior

The inbox remains store-first and does not auto-select a store.

1. Select a store.
2. Select one Gmail mailbox owned by that store.
3. Show that mailbox's Inbox, conversations, sync health, and labels only.

The label area contains:

- fixed Inbox;
- optional read-only Important and Starred filters when present; and
- full CRUD controls for user-created labels.

Pending mutations display an explicit pending state. Failed mutations display a
safe reason and retry action. Deleting a label requires confirmation and shows
the number of affected conversations. Deleting a label never implies deleting
mail or tickets.

Conversation rows show confirmed label badges. Selecting a label filters the RT
ticket list through the mirrored custom field and remains constrained to the
selected mailbox queue.

## Reply And Threading Flow

1. Validate tenant, store, mailbox, ticket, feature access, and reply body.
2. Confirm the RT ticket belongs to the selected mailbox queue.
3. Post correspondence through RT REST2.
4. RT generates the reply headers using the original email transaction.
5. The SMTP router selects the mailbox's Gmail credentials from the queue's
   correspondence address and relays through Gmail SMTP.
6. Verify in integration tests that the message appears in Gmail Sent and the
   same Gmail thread.
7. During reconciliation, link the known outbound Gmail message to the RT
   transaction and apply the conversation label set.

Reply failure returns a safe upstream error. It must not record a successful
audit event or UI state unless RT and the SMTP path accept the correspondence.

## Authorization And Security

- Mailbox administration continues to require the existing mailbox-admin guard.
- Operator access remains tenant/feature based and store scoped.
- Every mailbox, conversation, and label operation validates tenant, store, and
  mailbox ownership before any external call.
- App Passwords use the repository's envelope encryption with key IDs and are
  decrypted only inside the secret helper/controller process.
- Secret helpers accept opaque mailbox IDs, not email/password arguments.
- Logs and audit records must redact passwords, tokens, raw channel settings,
  raw email bodies, and sensitive headers.
- RT uses a server-only API token with least privileges required for queue and
  ticket operations.
- getmail, wrapper, controller, RT, and msmtp run as non-root users with
  least-privilege file permissions.
- Runtime secret/config directories use restrictive ownership and permissions.
- Errors returned to clients contain safe codes and actionable descriptions,
  never upstream credentials or raw responses.

## Failure Handling And Recovery

### RT Or mailgate Failure

The wrapper exits non-zero. getmail6 does not commit successful delivery. The
next cycle retries. Unique Gmail identity constraints prevent a retry from
creating a second app link or ticket after an ambiguous partial success.

### Gmail Or Credential Failure

Transient network/IMAP errors use exponential backoff. Authentication failure
marks the mailbox `DEGRADED`, stops destructive label operations, and prompts
an administrator to reconnect. The last confirmed ticket and label data remain
readable.

### Worker Crash

Operations remain in the durable outbox. Expired running leases are reclaimed.
Every command is idempotent and includes read-back, so retrying after a crash is
safe.

### Overlapping Polls

A distributed per-mailbox lock prevents overlapping one-minute cycles. Locks
expire and are renewable so a crashed worker cannot block the mailbox forever.

### UIDVALIDITY Change

The controller discards UID-based cursor assumptions and performs a bounded
metadata rescan. It rebuilds links using Gmail message/thread identity and RFC
Message-ID. It does not redeliver already-linked Gmail message IDs.

### Label Partial Failure

The operation remains pending/failed until Gmail read-back matches. RT custom
fields and confirmed joins are repaired from Gmail state. After the configured
retry limit, the operation moves to dead-letter and exposes a manual retry.

## Zammad Clean Removal

The implementation must remove, replace, or rename all active Zammad artifacts,
including:

- `src/lib/zammad/**`;
- Zammad-specific admin and mailbox-proxy implementations;
- `infra/zammad/**`;
- `docs/zammad-setup.md`;
- `scripts/seed-zammad-user.ts`;
- Zammad-specific tests and source guards;
- `ZAMMAD_URL` and `ZAMMAD_ADMIN_TOKEN`;
- `ZammadUser` and `UserMailboxAccess`;
- `zammadGroupId` and `zammadChannelId`;
- Zammad comments, UI copy, type names, fixtures, and package/config entries.

Because Zammad was never production, mailbox migration history is rebuilt as a
clean RT mailbox migration rather than retaining a Zammad compatibility chain.
Local/dev databases that applied the old mailbox migrations must be reset or
rebuilt. No production data migration procedure is required.

Completion requires a repository source guard showing no remaining operational
`zammad`, `ZAMMAD_*`, Zammad infrastructure, Zammad schema identifier, or
Zammad setup documentation. This replacement spec, its implementation plan,
and Git history are the only allowed historical references.

## Deployment Shape

The self-hosted stack contains:

- the existing Next.js app and app PostgreSQL/Redis services;
- RT 6.0.3 with a supported production SQL database;
- getmail6 6.20.0 runner;
- Gmail Label Controller/worker;
- verified MDA wrapper;
- local SMTP router/msmtp; and
- reverse proxy and persistent volumes required by RT.

SQLite is prohibited for production RT. Secrets are injected at runtime and
are not baked into images. Health checks cover app DB/Redis, RT REST2, the RT
mailgate path, worker liveness, and per-mailbox last successful sync.

## Testing Strategy

### Unit And Contract Tests

- RT REST2 authentication, pagination, TicketSQL status/label filters, status
  mapping, article normalization, reply payloads, and redaction.
- Gmail label quoting, hierarchy, mutable-system-label rules, operation
  idempotency, and read-back comparisons.
- Message/thread identity correlation and UIDVALIDITY recovery.
- Full desired-label-set diffing.
- Tenant/store/mailbox authorization and cross-mailbox rejection.
- Credential helper output and log redaction.
- MDA wrapper exit behavior for success, RT rejection, missing ACL, timeout,
  ambiguous partial success, and persistence failure.

### Disposable Gmail + RT Integration Tests

- Import a unique Unread Inbox message into the correct RT queue.
- Verify Unread immediately, after five minutes, and after a retry cycle.
- Verify the second poll creates no duplicate.
- Verify the six-month boundary and Inbox-only ingestion.
- Verify Spam, Trash, Sent, and All Mail are not ingestion sources.
- Create, rename, delete, assign, and unassign a user label.
- Verify every mutation preserves Unread.
- Verify labels from mailbox A never appear in mailbox B.
- Assign a conversation label, receive a customer reply, and verify inheritance.
- Archive a known message, retain the RT ticket, and mutate its labels through
  targeted metadata lookup.
- Reply from the app, verify Gmail Sent, Gmail thread identity, From/Reply-To,
  body, and attachment behavior.

### Resilience Tests

- RT unavailable during delivery.
- Gmail IMAP unavailable.
- Gmail SMTP unavailable.
- Invalid/revoked App Password.
- Controller crash before and after Gmail mutation.
- Wrapper crash after RT accepts mail but before the app link commits.
- Concurrent poll and label mutation.
- Duplicate scheduler execution.
- UIDVALIDITY reset.
- Label rename/delete affecting many conversations.

### Repository Verification

- Focused Vitest/source-contract suites.
- Prisma schema validation and clean-database migration.
- Production build.
- Container configuration validation and service health checks.
- Source guard proving complete active Zammad removal.

## Acceptance Criteria

1. A store can own multiple Gmail mailboxes; no mailbox exists outside a store.
2. Only the selected mailbox's labels and conversations appear in the UI.
3. Initial import includes only Inbox messages from the latest six months.
4. Subsequent inbound synchronization runs every minute.
5. Fetch, retry, label CRUD, and reconciliation do not mark Gmail messages read.
6. Spam, Trash, Sent, and All Mail are never ingestion sources.
7. New mail is not duplicated across repeated or overlapping cycles.
8. User labels support create, rename, delete, assign, and unassign from the app.
9. Label operations affect only the selected Gmail mailbox.
10. Labels filter conversations and apply to every message in the conversation,
    including future inbound replies.
11. Archived imported mail remains available as an RT/app conversation.
12. App replies appear in Gmail Sent and the correct Gmail thread.
13. Credentials and tokens never appear in client payloads, logs, tickets,
    process arguments, config files, screenshots, or audit metadata.
14. Temporary Gmail, RT, or worker failures retry safely without losing or
    duplicating tickets or label operations.
15. The active checkout contains no Zammad runtime, integration code, schema,
    environment variables, infrastructure, setup documentation, tests, or UI
    copy. This replacement spec and its implementation plan are the only
    allowed documentation references.
