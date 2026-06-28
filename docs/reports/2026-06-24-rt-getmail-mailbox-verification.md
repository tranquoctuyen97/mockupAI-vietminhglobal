# RT + getmail6 Gmail mailbox verification

Date: 2026-06-25 (Asia/Ho_Chi_Minh)

This report is credential-safe. It does not include Gmail App Passwords, RT API tokens, RT root passwords, raw email bodies, SMTP transcripts, or mailbox addresses.

## Scope verified in this pass

| Area | Current result | Evidence |
|---|---:|---|
| Previous mailbox backend removal | PASS | Clean-break source guard passes and ad-hoc scan returns no active references to the replaced backend or deprecated per-user assignment surface outside the approved RT replacement plan/spec. |
| Prisma RT/Gmail mailbox schema | PASS | `npx prisma validate` passes; `npx prisma generate` passes; migration `20260624090000_rt_getmail_gmail_mailboxes` creates RT/Gmail mailbox tables/enums/indexes/FKs. |
| Migration script | PASS | `scripts/migrate-rt-gmail-mailboxes.sh` validates Prisma, deploys and verifies migration `20260624090000_rt_getmail_gmail_mailboxes`, regenerates the client, and creates protected runtime directories. `package.json` exposes it as `db:migrate:rt-gmail`. |
| Gmail label metadata/client contract | PASS | Focused tests pass for Inbox metadata scan, visible label catalog, user label CRUD, readback, and reply readback helpers. |
| Unread-safe sync design | PASS (unit/source) | `syncMailbox()` scans Gmail `INBOX`, persists UID cursor, never fetches source bodies in tests, and delegates Gmail mutations to label operations that read back flags/labels. |
| Verified delivery sync loop | PASS (unit/source) | Each mailbox job acquires an atomic DB lease, discovers that mailbox's Gmail label catalog, pre-indexes Inbox metadata, renders the current getmail config, runs getmail with a bounded timeout, reconciles verified RT ticket/transaction linkage and conversation labels, and advances the UID cursor only through fully linked messages. UIDVALIDITY changes reset the effective cursor before a bounded Inbox rescan. |
| Label CRUD in app | PASS (unit/build) | Proxy endpoints support label list/create/rename/delete and conversation replace-style labels by app mailbox ID; UI loads labels only after selected mailbox, exposes rename/delete with affected-conversation confirmation, polls pending catalog changes, and saves the complete desired conversation label set. |
| Gmail-style app reply | PASS (unit/build/live Gate C) | The reply route resolves the latest external customer email from RT history, uses the latest inbound Gmail Message-ID as `In-Reply-To`, builds the known reference chain, verifies Gmail Sent/thread readback, then records an RT internal comment. Revised live Gate C passed against the disposable Gmail + RT lab. |
| Per-store/per-mailbox label isolation | PASS (source/build) | UI clears mailbox/labels/conversations when store changes; API resolves labels under the selected app mailbox before building RT TicketSQL. |
| Email body and attachment rendering | PASS (unit/source/build) | RT transaction normalization keeps body/content type/attachments; mailbox UI renders plain and sanitized HTML email bodies, strips scripts/event handlers, and shows real attachments separately from body parts. |
| One-minute scheduling | PASS (unit/source) | Queue tests verify one repeat dispatcher with `MAILBOX_SYNC_POLL_INTERVAL_MS` default `60000`, plus deduped per-mailbox sync jobs. |
| RT provisioning | PASS (unit/source) | Provisioning tests verify deterministic RT queue creation/update, Gmail Labels custom field attach, rights grant, runtime config materialization, and DEGRADED compensation. |
| Production RT infra | PASS (source) | Infra source test verifies pinned RT image digest, RT `6.0.3` build check, PostgreSQL 17, health checks, internal network, localhost RT exposure, msmtp helper-based passwords, and no Docker socket mount. |
| Worker registration/shutdown | PASS | Worker source test passes; `start-worker.ts` dynamically starts and closes mailbox sync + Gmail label operation workers. |
| Health endpoint | PASS (source/build) | Health source test verifies aggregate mailbox/queue/RT fields without mailbox email/token output. |
| Disposable live matrix runner | PASS (source/preflight/template) | `scripts/verify-rt-gmail-live-matrix.ts` enumerates the complete acceptance/resilience matrix, exposes redacted `preflight`, `checklist`, and `template` commands via `npm run mailbox:matrix:*`, writes `docs/reports/2026-06-24-rt-gmail-live-matrix.md` as the credential-safe evidence artifact, and refuses to pretend destructive live cases passed without a disposable lab run. |
| Production build | PASS | `npm run build` passes. |
| Whitespace check | PASS | `git diff --check` passes. |

## Commands run

```bash
npx vitest run tests/rt-infra-source.test.ts tests/rt-provisioning.test.ts tests/mailbox-worker-health.test.ts tests/mailbox-runtime-config.test.ts tests/rt-client.test.ts tests/mailbox-queue.test.ts tests/mailbox-sync.test.ts tests/mailbox-label-operations.test.ts tests/rt-mailbox-clean-break-source.test.ts tests/gmail-client.test.ts tests/gmail-reply.test.ts tests/gmail-smtp.test.ts tests/gmail-label-contract.test.ts tests/mailbox-validation.test.ts tests/mailbox-credentials.test.ts tests/verified-rt-mailgate.test.ts
```

Result before the final UI/reply additions: PASS, 16 files, 50 tests.

```bash
npx vitest run src/app/'(authed)'/mailboxes/mailbox-label-ui-source.test.ts tests/mailbox-ui-contract.test.ts tests/mailbox-queue.test.ts tests/mailbox-label-operations.test.ts tests/mailbox-reply-context.test.ts tests/mailbox-proxy-source.test.ts
```

Result: PASS, 6 files, 11 tests.

Final mailbox-focused verification after delivery-loop, DB lease, UIDVALIDITY, detail-contract, reply-context, and UI additions:

```bash
npx vitest run tests/rt-mailbox-dependencies.test.ts tests/rt-infra-source.test.ts tests/rt-provisioning.test.ts tests/mailbox-worker-health.test.ts tests/mailbox-runtime-config.test.ts tests/rt-client.test.ts tests/rt-normalizers.test.ts tests/mailbox-queue.test.ts tests/mailbox-sync.test.ts tests/mailbox-sync-linkage-source.test.ts tests/mailbox-label-operations.test.ts tests/rt-mailbox-clean-break-source.test.ts tests/rt-mailbox-schema-source.test.ts tests/rt-gmail-migration-script-source.test.ts tests/rt-gmail-gate-script-source.test.ts tests/rt-gmail-live-matrix-script-source.test.ts tests/gmail-client.test.ts tests/gmail-gate-context.test.ts tests/gmail-reply.test.ts tests/gmail-smtp.test.ts tests/gmail-label-contract.test.ts tests/mailbox-validation.test.ts tests/mailbox-credentials.test.ts tests/verified-rt-mailgate.test.ts tests/mailbox-reply-context.test.ts tests/mailbox-proxy-source.test.ts tests/email-body-renderer.test.ts tests/mailbox-identity.test.ts src/app/'(authed)'/mailboxes/mailbox-label-ui-source.test.ts tests/mailbox-ui-contract.test.ts
```

Result: PASS, 30 files, 109 tests.

Disposable PostgreSQL 17 migration verification:

- all 32 repository migrations applied successfully to an empty disposable database;
- rerunning `scripts/migrate-rt-gmail-mailboxes.sh` reported no pending migrations and exited `0`;
- `_prisma_migrations` contained a finished, non-rolled-back `20260624090000_rt_getmail_gmail_mailboxes` record;
- all seven RT/Gmail mailbox tables existed;
- the disposable schema contained 12 mailbox/Gmail/conversation foreign keys;
- runtime directory permissions were `700` for root/secrets and `755` for configs/state;
- the disposable container and runtime directory were removed after verification.

```bash
npx vitest run tests/rt-infra-source.test.ts tests/rt-provisioning.test.ts tests/mailbox-worker-health.test.ts tests/mailbox-runtime-config.test.ts tests/rt-client.test.ts tests/mailbox-queue.test.ts tests/mailbox-sync.test.ts tests/mailbox-label-operations.test.ts tests/rt-mailbox-clean-break-source.test.ts
```

Result: PASS, 9 files, 27 tests.

```bash
npx prisma validate
npx prisma generate
npm run build
git diff --check
```

Result: PASS.

```bash
npx tsc --noEmit --pretty false
```

Result: FAIL, not used as completion evidence for mailbox runtime because this project-level command currently type-checks legacy test files and stale generated `.next/dev` types. Observed failures include:

- `.next/dev/types/validator.ts` references a deleted generated admin mailbox assignment route;
- unrelated legacy test type failures in design/wizard/mockup/printify/publish test files, outside RT/Gmail mailbox runtime paths.

`npm run build` passes after the route deletion, which is the authoritative production app type/build check used here.

## Live gate status

The previous live report already passed:

- Gate A Gmail label create/assign/rename/unassign/delete while preserving Unread;
- Gate B verified `rt-mailgate` identity and duplicate retry;
- Gate D permission-denied delivery failure and restored success.

Gate C revised app-owned Gmail reply live rerun: PASS.

Current local secret file `/tmp/mockupai-gmail-gate.env` contains:

- `GMAIL_TEST_USER`;
- `GMAIL_TEST_APP_PASSWORD`.

The revised Gate C script now requires only:

- Gmail account email and App Password;
- `RT_URL`;
- `RT_API_TOKEN`.

It scans Gmail Inbox metadata without marking messages read, derives the customer address, subject, Gmail thread ID, and RFC Message-ID, then resolves the matching RT ticket/transaction/queue by exact Message-ID. Manual ticket and Gmail thread inputs are no longer required.

The verifier uses only Gmail email/App Password plus a disposable RT URL/token. It no longer needs manually copied Gmail thread or RT ticket IDs.

Observed sanitized Gate C result:

```json
{
  "gate": "C",
  "status": "PASS",
  "mode": "app-owned-gmail-reply",
  "gmailThreadId": "1868962415021337219",
  "rtCommentStatus": 201
}
```

## Known remaining verification work

Run the live matrix preflight/checklist with:

```bash
npm run mailbox:matrix:preflight
npm run mailbox:matrix:checklist
npm run mailbox:matrix:template
```

Current preflight in this shell returns `MISSING_ENV` for `GMAIL_TEST_USER`, `GMAIL_TEST_APP_PASSWORD`, `RT_URL`, and `RT_API_TOKEN`; values are redacted and not printed. The template command wrote `docs/reports/2026-06-24-rt-gmail-live-matrix.md` with PENDING sections for every acceptance/resilience case. The matrix runner is intentionally not marked PASS for destructive live cases until a disposable Gmail/RT lab is active.

| Item | Current source/unit/build evidence | Live status |
|---|---|---:|
| Revised Gate C same-thread Gmail Sent readback + RT comment | `sendGmailThreadReply()` readback-polls generated Message-ID in Gmail Sent, verifies same Gmail thread, and the proxy writes an RT internal comment after Gmail verification. | PASS |
| Age window | `scanInbox()` searches `INBOX` by `initialSyncAfter` when there is no committed UID; runtime getmail config is rendered from the same `initialSyncAfter`. | PENDING MATRIX |
| Spam/trash/all-mail exclusion | Normal sync locks/scans only `INBOX`; All Mail is used only for known-thread/message-ID metadata lookup after a known conversation/reply, not as an ingestion source. | PENDING MATRIX |
| Repeated poll / duplicate scheduler | Sync uses `MailboxSyncCursor` DB lease and advances only through verified RT-linked messages; queue tests verify one repeat dispatcher plus deduped per-mailbox sync jobs. | PENDING MATRIX |
| Cross-mailbox isolation | Store/mailbox guards require app mailbox ID under the selected store; label operations and idempotency keys are mailbox-scoped. | PENDING MATRIX |
| Reply inheritance | Sync enqueues inherit-label operations for new inbound messages in an existing Gmail thread/conversation; reply context uses latest inbound Message-ID and reference chain. | PENDING MATRIX |
| Archived/closed ticket mutability | UI/API expose status update to `closed`/RT `resolved` and label APIs resolve tickets by selected mailbox queue; source/build covers the route shape but not a live resolved-ticket mutation. | PENDING MATRIX |
| Attachments/body rendering | RT normalizer and UI body renderer tests cover content type, sanitized HTML/plain text, and attachment mapping. | PENDING MATRIX |
| RT down / Gmail IMAP down / Gmail SMTP down / revoked App Password | RT client maps timeout/network errors to safe codes; sync marks permanent Gmail auth/config errors as `DEGRADED`; SMTP/IMAP verification has focused tests. | PENDING MATRIX |
| Worker kill windows / duplicate scheduler / concurrent label+sync | DB lease, operation idempotency, retry/dead-letter states, and pending-operation protection are covered by source/unit tests. | PENDING MATRIX |
| UIDVALIDITY mismatch | Unit test verifies cursor reset to `0` and bounded Inbox rescan. | PENDING MATRIX |
| High-fanout label rename/delete | Durable label operations and UI confirmation count are covered by unit/source tests; high-fanout live timing remains unmeasured. | PENDING MATRIX |

## Deployment readiness note

The source/build/unit state is ready for a disposable environment run. Do not use production mailboxes for the pending live matrix. Run migrations with:

```bash
npm run db:migrate:rt-gmail
```

Then provision disposable Gmail + RT mailbox rows through the admin UI/API and rerun the live gate scripts.
