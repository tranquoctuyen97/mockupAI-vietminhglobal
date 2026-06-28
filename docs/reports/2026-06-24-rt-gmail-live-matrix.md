# RT + Gmail disposable live matrix

Generated: 2026-06-25 (Asia/Ho_Chi_Minh), incremental disposable lab run

This file is a credential-safe template for Task 16's full disposable Gmail/RT acceptance and resilience matrix.

Do not paste Gmail App Passwords, RT API tokens, RT root passwords, raw email bodies, SMTP transcripts, or production mailbox addresses into this file.

Allowed evidence:

- sanitized Gmail message IDs, Gmail thread IDs, IMAP UIDs, RT ticket IDs, RT transaction IDs, queue IDs, timestamps, and PASS/FAIL summaries;
- command names and redacted preflight output;
- short paraphrased body/attachment observations without raw customer content.

Recommended commands:

```bash
npm run mailbox:matrix:preflight
npm run mailbox:matrix:checklist
tsx scripts/verify-rt-gmail-gates.ts labels
tsx scripts/verify-rt-gmail-gates.ts reply-thread
```

## Acceptance matrix



### age-window — Initial import respects the configured Inbox bootstrap window

Status: PENDING

Evidence required:
- [ ] one five-month-old Inbox message imported
- [ ] one seven-month-old Inbox message excluded
- [ ] cursor advances only after verified RT linkage

Notes: Requires disposable Inbox seed messages around the initialSyncAfter boundary.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### excluded-mailboxes — Spam, Trash, Sent, and unrelated All Mail are never ingested

Status: PENDING

Evidence required:
- [ ] Spam seed not linked to RT
- [ ] Trash seed not linked to RT
- [ ] Sent seed not linked to RT
- [ ] All Mail archived-only seed not linked to RT

Notes: Normal ingestion must lock/scan INBOX only.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### unread-preserved — Gmail Unread is preserved across import, retry, labels, and waiting

Status: PENDING

Evidence required:
- [ ] baseline message starts unread
- [ ] message remains unread after import
- [ ] message remains unread after retry
- [ ] message remains unread after label mutations
- [ ] message remains unread after five minutes

Notes: Use IMAP metadata/flags readback only; never fetch message source as a side effect.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### duplicate-poll — Repeated or overlapping poll creates no duplicate ticket

Status: PENDING

Evidence required:
- [ ] two overlapping sync attempts observed
- [ ] one RT ticket for the Gmail message
- [ ] one Gmail message link for the Gmail message

Notes: Exercises DB lease plus verified-link cursor advancement.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### label-crud — Create, rename, delete, assign, and unassign Gmail labels from the app

Status: PASS

Evidence required:
- [x] create readback
- [x] assign readback
- [x] rename readback
- [x] unassign readback
- [x] delete readback
- [x] Unread flag remains false for Seen throughout

Notes: Equivalent to Gate A plus app operation outbox state verification.

Sanitized evidence:

```text
Command: npx tsx scripts/verify-rt-gmail-gates.ts labels
Result: PASS
Sanitized Gmail message ID: 1868846369917845320
Sanitized Gmail thread ID: 1868846369917845320
UID: 151
Seen remained false before, create, assign, rename, unassign, and delete.
```

### cross-mailbox-isolation — Mailbox A labels never appear under mailbox B

Status: PASS

Evidence required:
- [x] mailbox A user label visible only under mailbox A
- [x] mailbox B catalog excludes mailbox A label
- [x] label filter resolves only against selected app mailbox ID

Notes: Second disposable mailbox is preferred; source guard can prove route scoping but live run should use two accounts when available.

Sanitized evidence:

```text
Disposable two-account catalog test: PASS.
A temporary user label was created in mailbox A.
Mailbox A readback: visible.
Mailbox B readback: absent.
The temporary label was deleted after verification.
App mailbox-ID scoping remains covered by focused source/unit tests.
```

### reply-inheritance — Conversation labels propagate to a new customer reply

Status: PENDING

Evidence required:
- [ ] conversation has confirmed label before customer reply
- [ ] new inbound Gmail message shares Gmail thread ID
- [ ] new inbound UID receives inherited label operation
- [ ] RT custom field reflects final labels

Notes: Customer reply must land in INBOX and keep the same Gmail thread.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### closed-ticket-label-mutation — Closed/archived imported ticket remains readable and label-mutable

Status: PENDING

Evidence required:
- [ ] ticket status changed to app closed / RT resolved
- [ ] detail endpoint still reads the conversation
- [ ] label assignment succeeds after close
- [ ] RT custom field mirrors label after close

Notes: Confirms the app can manage Gmail labels without reopening the ticket.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### gmail-sent-thread-reply — App reply appears in Gmail Sent with the same Gmail thread ID

Status: PASS

Evidence required:
- [x] generated RFC Message-ID found by Gmail readback
- [x] readback message has Gmail Sent semantics
- [x] readback Gmail thread ID equals inbound thread ID
- [x] RT receives internal comment after Gmail verification

Notes: Equivalent to revised Gate C using email/App Password plus RT URL/token only.

Sanitized evidence:

```text
Command: npx tsx scripts/verify-rt-gmail-gates.ts reply-thread
Result: PASS
RT ticket ID: 1
RT inbound transaction ID: 45
RT queue ID: 1
Gmail thread ID: 1868981941126309547
Outbound Gmail message ID: 1868982206226977952
Outbound UID: 194
RT comment status: 201
The inbound source was fetched with IMAP PEEK; Unread remained preserved.
```

### body-attachment-readable — Sender, body, HTML, plain text, and attachments remain readable

Status: PENDING

Evidence required:
- [ ] sender normalized
- [ ] plain text body rendered
- [ ] HTML body sanitized and rendered
- [ ] attachment metadata returned
- [ ] body-part attachments are not shown as downloadable files

Notes: Requires a disposable message with plain/html alternatives and a real attachment.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

## Resilience matrix



### rt-down — RT down

Status: PENDING

Evidence required:
- [ ] sync reports retryable RT/network failure
- [ ] no false success
- [ ] recovery succeeds after RT restoration

Notes: Stop or firewall disposable RT only.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### gmail-imap-down — Gmail IMAP down

Status: PENDING

Evidence required:
- [ ] IMAP failure recorded with safe code
- [ ] mailbox not falsely advanced
- [ ] recovery succeeds

Notes: Use invalid host/network override in disposable runner, not a production account.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### gmail-smtp-down — Gmail SMTP down

Status: PENDING

Evidence required:
- [ ] reply send fails before RT comment
- [ ] no Gmail Message-ID comment recorded
- [ ] retry succeeds after restoration

Notes: App-owned Gmail reply must not create RT correspondence before Gmail verification.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### revoked-app-password — Revoked App Password

Status: PENDING

Evidence required:
- [ ] safe degraded state
- [ ] no credential leakage
- [ ] rotation restores provisioning/sync

Notes: Use disposable Gmail App Password only.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### worker-kill-before-gmail-mutation — Worker killed before Gmail label mutation

Status: PENDING

Evidence required:
- [ ] operation remains retryable
- [ ] Gmail label not partially applied
- [ ] retry succeeds once

Notes: Exercises label outbox before side effects.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### worker-kill-after-gmail-mutation — Worker killed after Gmail label mutation

Status: PENDING

Evidence required:
- [ ] operation retry is idempotent
- [ ] Gmail readback converges
- [ ] DB/RT final state has one label set

Notes: Exercises readback plus idempotency key behavior.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### mailgate-wrapper-kill-after-rt-accept — Mailgate wrapper killed after RT accept

Status: PENDING

Evidence required:
- [ ] RT identity can be reconciled
- [ ] retry creates no duplicate ticket
- [ ] cursor advances after verified linkage

Notes: Use disposable wrapper fault injection.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### duplicate-scheduler — Duplicate scheduler

Status: PENDING

Evidence required:
- [ ] two dispatchers observed
- [ ] DB lease allows one active sync
- [ ] no duplicate ticket/link

Notes: Exercises multi-worker deployment safety.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### concurrent-label-and-sync — Concurrent label operation and mailbox sync

Status: PENDING

Evidence required:
- [ ] pending label protected from catalog overwrite
- [ ] conversation final labels correct
- [ ] RT custom field correct

Notes: Exercises in-flight CRUD protection during label catalog refresh.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### uidvalidity-mismatch — UIDVALIDITY mismatch

Status: PENDING

Evidence required:
- [ ] cursor reset to zero
- [ ] bounded Inbox rescan
- [ ] no duplicate linked ticket

Notes: Can be simulated in unit tests; live mailbox run should record observed handling if Gmail changes UIDVALIDITY.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```

### high-fanout-label-rename-delete — High-fanout label rename/delete

Status: PENDING

Evidence required:
- [ ] many conversations updated
- [ ] operation does not leak credentials
- [ ] failed item state is retryable/dead-lettered safely

Notes: Use disposable data volume; record timing and final catalog state.

Sanitized evidence:

```text
TODO: paste sanitized command output, IDs, and timestamps here.
```
