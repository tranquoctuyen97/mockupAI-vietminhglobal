# RT + getmail6 Gmail Mailbox Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unused Zammad mailbox stack with RT 6.0.3, getmail6 6.20.0, Gmail Inbox-only synchronization, and full conversation-level Gmail label CRUD without changing Gmail Unread state.

**Architecture:** Keep the Next.js app as the only user interface and store/tenant authorization boundary. A BullMQ mailbox worker uses ImapFlow for Gmail metadata and label operations, invokes getmail6 for raw Inbox delivery through a verified `rt-mailgate` wrapper, mirrors confirmed labels into an RT ticket custom field, and sends app replies directly through the selected Gmail SMTP account with Gmail-thread-preserving headers before recording the correspondence back into RT.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, BullMQ/Redis, ImapFlow 1.4.2, Nodemailer 9.0.1, Request Tracker 6.0.3 REST2 and `rt-mailgate`, getmail6 6.20.0, msmtp 1.8.x, Docker Compose, Vitest, disposable Gmail App Password test account.

**Approved spec:** `docs/superpowers/specs/2026-06-24-rt-getmail-gmail-labels-design.md`

**Commit policy:** Do not run `git add` or `git commit`. This repository's owner stages and commits changes manually. Each task ends with a verification checkpoint instead of a commit step.

**Implementation status as of 2026-06-25:** Core implementation, migration script, clean-break removal, mandatory live Gates A/B/C/D, focused mailbox tests, Prisma validation, production build, and whitespace checks have current PASS evidence in `docs/reports/2026-06-24-rt-getmail-mailbox-verification.md` and `docs/reports/2026-06-24-rt-gmail-production-gates.md`. A credential-safe live matrix runner now exists at `scripts/verify-rt-gmail-live-matrix.ts` and is exposed through `npm run mailbox:matrix:preflight`, `npm run mailbox:matrix:checklist`, and `npm run mailbox:matrix:template`; the template command writes `docs/reports/2026-06-24-rt-gmail-live-matrix.md` for sanitized PASS/FAIL evidence. The goal is **not yet complete** because Task 16's full disposable Gmail acceptance/resilience matrix still needs a dedicated live run; the verification report maps each pending matrix item to existing source/unit evidence and the remaining live status.

---

## Scope And Execution Rules

- Work in the existing `app/` checkout and preserve every unrelated dirty-worktree change.
- Never edit or discard unrelated wizard, mockup, publishing, template, or Prisma work already present.
- Use top-level static imports in application code. Dynamic imports remain only in `start-worker.ts`, where the standalone worker deliberately loads environment variables before application modules.
- Run focused tests after each task. Do not wait for the full build to discover local contract failures.
- Use the disposable Gmail account from the research lab for all IMAP/SMTP tests. Never use a production mailbox.
- Never print, store in Git, pass as a command argument, or include in an audit event: Gmail App Passwords, `RT_API_TOKEN`, RT root password, raw email bodies, or SMTP authentication exchanges.
- Stop before Tasks 7-16 if any mandatory live gate in Task 6 fails. Record the exact failure; do not weaken the spec or reintroduce Zammad.

## Target File Map

### New application modules

- `src/lib/rt/types.ts` — raw REST2 types and normalized mailbox UI contracts.
- `src/lib/rt/client.ts` — server-only REST2 request, ticket, queue, custom-field, and reply operations.
- `src/lib/rt/normalizers.ts` — RT status, ticket, transaction, sender, and attachment normalization.
- `src/lib/rt/provisioning.ts` — idempotent queue/custom-field provisioning and compensation.
- `src/lib/mailboxes/types.ts` — Gmail scan, label command, sync job, and runtime-config types.
- `src/lib/mailboxes/validation.ts` — strict mailbox, reply, status, and label schemas.
- `src/lib/mailboxes/auth.ts` — tenant/store/mailbox guards using app mailbox IDs, never RT IDs from the client.
- `src/lib/mailboxes/credentials.ts` — encrypt, decrypt, mask, and materialize runtime Gmail credentials.
- `src/lib/mailboxes/gmail-client.ts` — ImapFlow connection, Inbox metadata scan, known-thread lookup, and label CRUD.
- `src/lib/mailboxes/gmail-smtp.ts` — Gmail SMTP/App Password verification without sending a message.
- `src/lib/mailboxes/gmail-reply.ts` — app-owned Gmail SMTP reply sender that preserves `Message-ID`, `In-Reply-To`, `References`, and verifies Gmail Sent/thread identity before RT recording.
- `src/lib/mailboxes/runtime-config.ts` — deterministic getmail6 and msmtp config rendering without embedded secrets.
- `src/lib/mailboxes/sync.ts` — one-mailbox reconciliation transaction and UID cursor rules.
- `src/lib/mailboxes/labels.ts` — durable label-operation execution and RT custom-field reconciliation.
- `src/lib/mailboxes/queue.ts` — BullMQ mailbox sync/label queues and one-minute repeat scheduling.
- `src/lib/mailboxes/proxy/mailboxes.ts` — operator mailbox listing handler.
- `src/lib/mailboxes/proxy/conversations.ts` — RT conversation list/detail/reply/status handlers.
- `src/lib/mailboxes/proxy/labels.ts` — label catalog CRUD and conversation label-set handlers.
- `src/lib/jobs/workers/mailbox-sync-worker.ts` — BullMQ processors for sync and interactive label jobs.
- `scripts/mailbox-secret-helper.ts` — stdout-only password helper keyed by opaque mailbox ID.
- `scripts/verified-rt-mailgate.ts` — stdin-preserving MDA wrapper that rejects RT `not ok` responses.

### New infrastructure

- `infra/rt/docker-compose.yml` — RT 6.0.3, RT PostgreSQL, and shared runtime mounts.
- `infra/rt/Dockerfile` — pinned production-capable RT image with repository RT config and msmtp.
- `infra/rt/Dockerfile.mailbox-worker` — Node mailbox worker with getmail6 6.20.0 and the RT 6.0.3 mailgate client.
- `.dockerignore` — prevent credentials, build output, scratch files, and local archives from entering worker/RT build contexts.
- `infra/rt/RT_SiteConfig.pm` — REST2, sendmailpipe/msmtp, correspondence, and security configuration.
- `infra/rt/msmtprc` — shared defaults plus generated per-mailbox includes; no passwords.
- `infra/rt/bin/mailbox-secret-helper` — restricted helper reading runtime secrets by mailbox ID.
- `infra/rt/README.md` — bootstrap, token, health, backup, and recovery commands.
- `infra/rt/.env.example` — non-secret variable names only.

### Existing surfaces to modify

- `package.json`, `package-lock.json`, and `pnpm-lock.yaml` — add ImapFlow consistently to both lockfiles.
- `prisma/schema.prisma` and mailbox migrations — replace Zammad tables/columns with RT/Gmail sync models.
- `.env.example` — replace `ZAMMAD_*` with RT and mailbox runtime variables.
- `src/lib/queue/queue.ts`, `start-worker.ts`, `src/app/api/health/route.ts`, `ecosystem.config.js` — register worker queues, scheduling, shutdown, and health.
- `src/app/api/admin/mailboxes/**` — Gmail probe and RT provisioning.
- `src/app/api/mailbox-proxy/[...path]/route.ts` — thin authenticated dispatcher to focused RT/Gmail handlers.
- `src/app/(authed)/admin/mailboxes/**` — Gmail-only App Password setup and sync state.
- `src/app/(authed)/mailboxes/MailboxesClient.tsx` — mailbox-scoped labels, filters, pending state, and label badges.

### Zammad artifacts to delete

- `src/lib/zammad/**`
- `scripts/seed-zammad-user.ts`
- `src/app/api/admin/mailboxes/[id]/assignments/route.ts`
- `src/app/(authed)/admin/mailboxes/AssignUsersModal.tsx`
- all `tests/zammad-*.test.ts`
- `infra/zammad/**`
- `docs/zammad-setup.md`
- old Zammad mailbox plans/specs listed in Task 15
- `prisma/migrations/20260529173034_add_zammad_and_mailbox/`
- `prisma/migrations/20260620090000_store_scoped_mailboxes/`

---

### Task 1: Lock Dependencies And Establish Red Contract Tests

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `pnpm-lock.yaml`
- Create: `tests/rt-mailbox-dependencies.test.ts`
- Create: `tests/rt-mailbox-clean-break-source.test.ts`

- [ ] **Step 1: Write the dependency contract test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("RT Gmail mailbox dependencies", () => {
  it("pins Gmail IMAP and SMTP clients", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies.imapflow).toBe("1.4.2");
    expect(pkg.dependencies.nodemailer).toBe("9.0.1");
    expect(pkg.devDependencies["@types/nodemailer"]).toBe("8.0.1");
  });
});
```

- [ ] **Step 2: Write the final clean-break source guard in a deliberately red state**

The guard must recursively inspect application/runtime files while allowing only the approved replacement spec and this plan to mention the previous backend.

```ts
const allowedHistoricalDocs = new Set([
  "docs/superpowers/specs/2026-06-24-rt-getmail-gmail-labels-design.md",
  "docs/superpowers/plans/2026-06-24-rt-getmail-gmail-labels.md",
]);

expect(forbiddenMatches).toEqual([]);
expect(existsSync("src/lib/rt/client.ts")).toBe(true);
expect(existsSync("src/lib/mailboxes/gmail-client.ts")).toBe(true);
expect(existsSync("infra/rt/docker-compose.yml")).toBe(true);
```

Scan `.env.example`, `src`, `tests`, `scripts`, `infra`, `prisma`, and `docs`. Ignore `.next`, `node_modules`, lockfiles, the two allowed docs, and Git metadata. Match `zammad` case-insensitively and `ZAMMAD_` exactly.

Construct the forbidden strings inside the guard so the guard does not match its own source:

```ts
const forbiddenBackendName = ["zam", "mad"].join("");
const forbiddenEnvPrefix = ["ZAM", "MAD_"].join("");
```

- [ ] **Step 3: Run the red tests**

Run:

```bash
npx vitest run tests/rt-mailbox-dependencies.test.ts tests/rt-mailbox-clean-break-source.test.ts
```

Expected: FAIL because ImapFlow and the RT/Gmail files are absent and active Zammad artifacts still exist.

- [ ] **Step 4: Install the exact ImapFlow version and synchronize both lockfiles**

Run:

```bash
npm install --save-exact imapflow@1.4.2 nodemailer@9.0.1
npm install --save-dev --save-exact @types/nodemailer@8.0.1
pnpm install --lockfile-only
```

Expected: `package.json` contains `"imapflow": "1.4.2"`; both lockfiles resolve the same version.

- [ ] **Step 5: Verify only the dependency contract is green**

Run:

```bash
npx vitest run tests/rt-mailbox-dependencies.test.ts
```

Expected: PASS. Keep the clean-break guard red until Task 15.

---

### Task 2: Replace The Prisma Mailbox Schema And Migration History

**Files:**
- Modify: `prisma/schema.prisma`
- Delete: `prisma/migrations/20260529173034_add_zammad_and_mailbox/migration.sql`
- Delete: `prisma/migrations/20260620090000_store_scoped_mailboxes/migration.sql`
- Create: `prisma/migrations/20260624090000_rt_getmail_gmail_mailboxes/migration.sql`
- Create: `tests/rt-mailbox-schema-source.test.ts`

- [ ] **Step 1: Add a failing schema contract**

Assert that the schema contains the exact new enums/models and does not contain the old identifiers:

```ts
expect(schema).toMatch(/enum MailboxSyncStatus/);
expect(schema).toMatch(/model GmailLabelOperation/);
expect(schema).toMatch(/rtQueueId\s+Int\?/);
expect(schema).toMatch(/appPasswordEncrypted\s+Bytes/);
expect(schema).not.toMatch(/model ZammadUser|model UserMailboxAccess/);
expect(schema).not.toMatch(/zammadGroupId|zammadChannelId/);
```

Run:

```bash
npx vitest run tests/rt-mailbox-schema-source.test.ts
```

Expected: FAIL on the current schema.

- [ ] **Step 2: Replace the mailbox section with the exact target enums and relations**

Use these enums and model responsibilities:

```prisma
enum MailboxSyncStatus { PROVISIONING ACTIVE DEGRADED DISABLED }
enum GmailLabelType { USER INBOX IMPORTANT STARRED }
enum GmailLabelState { ACTIVE PENDING_CREATE PENDING_RENAME PENDING_DELETE FAILED }
enum GmailMessageDirection { INBOUND OUTBOUND }
enum GmailLabelOperationType { CREATE RENAME DELETE ASSIGN UNASSIGN }
enum GmailLabelOperationState { PENDING RUNNING SUCCEEDED FAILED DEAD_LETTER }

model Mailbox {
  id                       String            @id @default(cuid())
  tenantId                 String            @map("tenant_id")
  storeId                  String            @map("store_id")
  name                     String
  email                    String
  provider                 String            @default("gmail")
  rtQueueId                Int?              @unique @map("rt_queue_id")
  appPasswordEncrypted     Bytes             @map("app_password_encrypted")
  encryptionKeyId          String            @map("encryption_key_id")
  initialSyncAfter         DateTime          @map("initial_sync_after")
  syncStatus               MailboxSyncStatus @default(PROVISIONING) @map("sync_status")
  lastSyncAt               DateTime?         @map("last_sync_at")
  lastSyncErrorCode        String?           @map("last_sync_error_code")
  provisioningVersion      Int               @default(1) @map("provisioning_version")
  isActive                 Boolean           @default(true) @map("is_active")
  createdAt                DateTime          @default(now()) @map("created_at")
  updatedAt                DateTime          @updatedAt @map("updated_at")

  tenant       Tenant                @relation(fields: [tenantId], references: [id])
  store        Store                 @relation(fields: [storeId], references: [id], onDelete: Cascade)
  syncCursor   MailboxSyncCursor?
  labels       GmailLabel[]
  conversations MailboxConversation[]
  messageLinks GmailMessageLink[]
  operations   GmailLabelOperation[]

  @@unique([tenantId, email])
  @@index([tenantId, storeId, isActive])
  @@index([syncStatus, isActive])
  @@map("mailboxes")
}
```

Add the remaining models with these exact fields and constraints:

```prisma
model MailboxSyncCursor {
  mailboxId           String    @id @map("mailbox_id")
  uidValidity         BigInt?   @map("uid_validity")
  lastCommittedUid    BigInt    @default(0) @map("last_committed_uid")
  lastReconciledAt    DateTime? @map("last_reconciled_at")
  leaseOwner          String?   @map("lease_owner")
  leaseExpiresAt      DateTime? @map("lease_expires_at")
  mailbox             Mailbox   @relation(fields: [mailboxId], references: [id], onDelete: Cascade)

  @@map("mailbox_sync_cursors")
}

model GmailLabel {
  id             String          @id @default(cuid())
  mailboxId      String          @map("mailbox_id")
  name           String
  normalizedName String          @map("normalized_name")
  type           GmailLabelType
  isMutable      Boolean         @default(true) @map("is_mutable")
  state          GmailLabelState @default(ACTIVE)
  lastErrorCode  String?         @map("last_error_code")
  confirmedAt    DateTime?       @map("confirmed_at")
  createdAt      DateTime        @default(now()) @map("created_at")
  updatedAt      DateTime        @updatedAt @map("updated_at")
  mailbox        Mailbox         @relation(fields: [mailboxId], references: [id], onDelete: Cascade)
  conversations  ConversationLabel[]
  operations     GmailLabelOperation[]

  @@unique([mailboxId, normalizedName])
  @@index([mailboxId, state])
  @@map("gmail_labels")
}

model MailboxConversation {
  id             String    @id @default(cuid())
  mailboxId      String    @map("mailbox_id")
  rtTicketId     Int       @map("rt_ticket_id")
  gmailThreadId  String    @map("gmail_thread_id")
  status         String    @default("active")
  lastActivityAt DateTime? @map("last_activity_at")
  syncErrorCode  String?   @map("sync_error_code")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")
  mailbox        Mailbox   @relation(fields: [mailboxId], references: [id], onDelete: Cascade)
  messages       GmailMessageLink[]
  labels         ConversationLabel[]
  operations     GmailLabelOperation[]

  @@unique([mailboxId, rtTicketId])
  @@unique([mailboxId, gmailThreadId])
  @@index([mailboxId, status, lastActivityAt])
  @@map("mailbox_conversations")
}

model GmailMessageLink {
  id              String                @id @default(cuid())
  mailboxId       String                @map("mailbox_id")
  conversationId  String?               @map("conversation_id")
  gmailMessageId  String                @map("gmail_message_id")
  gmailThreadId   String                @map("gmail_thread_id")
  rfcMessageId    String?               @map("rfc_message_id")
  imapUid         BigInt                @map("imap_uid")
  uidValidity     BigInt                @map("uid_validity")
  rtTicketId      Int?                  @map("rt_ticket_id")
  rtTransactionId Int?                  @map("rt_transaction_id")
  direction       GmailMessageDirection
  createdAt       DateTime              @default(now()) @map("created_at")
  updatedAt       DateTime              @updatedAt @map("updated_at")
  mailbox         Mailbox               @relation(fields: [mailboxId], references: [id], onDelete: Cascade)
  conversation    MailboxConversation?  @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([mailboxId, gmailMessageId])
  @@unique([mailboxId, uidValidity, imapUid])
  @@unique([mailboxId, rtTransactionId])
  @@index([mailboxId, gmailThreadId])
  @@index([mailboxId, rfcMessageId])
  @@map("gmail_message_links")
}

model ConversationLabel {
  conversationId String              @map("conversation_id")
  labelId        String              @map("label_id")
  confirmedAt    DateTime            @default(now()) @map("confirmed_at")
  conversation   MailboxConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  label          GmailLabel          @relation(fields: [labelId], references: [id], onDelete: Cascade)

  @@id([conversationId, labelId])
  @@index([labelId, conversationId])
  @@map("conversation_labels")
}

model GmailLabelOperation {
  id             String                   @id @default(cuid())
  mailboxId      String                   @map("mailbox_id")
  conversationId String?                  @map("conversation_id")
  labelId        String?                  @map("label_id")
  actorUserId    String?                  @map("actor_user_id")
  type           GmailLabelOperationType
  desiredPayload Json                     @map("desired_payload")
  idempotencyKey String                   @unique @map("idempotency_key")
  state          GmailLabelOperationState @default(PENDING)
  attemptCount   Int                      @default(0) @map("attempt_count")
  nextAttemptAt  DateTime?                @map("next_attempt_at")
  errorCode      String?                  @map("error_code")
  startedAt      DateTime?                @map("started_at")
  completedAt    DateTime?                @map("completed_at")
  createdAt      DateTime                 @default(now()) @map("created_at")
  updatedAt      DateTime                 @updatedAt @map("updated_at")
  mailbox        Mailbox                  @relation(fields: [mailboxId], references: [id], onDelete: Cascade)
  conversation   MailboxConversation?     @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  label          GmailLabel?              @relation(fields: [labelId], references: [id], onDelete: SetNull)

  @@index([state, nextAttemptAt])
  @@index([mailboxId, createdAt])
  @@map("gmail_label_operations")
}
```

Use PostgreSQL `BIGINT` for UIDs and UIDVALIDITY, strings for Gmail message/thread IDs, and cascade deletes from `Mailbox`.

- [ ] **Step 3: Remove obsolete reverse relations from `User`**

Delete `zammadUser` and `mailboxAccess`. Do not change tenant/store mailbox relations.

- [ ] **Step 4: Replace the two unused Zammad migrations with one clean RT/Gmail migration**

The new SQL must:

- create the six enums;
- create `mailboxes`, `mailbox_sync_cursors`, `gmail_labels`, `mailbox_conversations`, `gmail_message_links`, `conversation_labels`, and `gmail_label_operations`;
- add all schema-declared indexes, unique constraints, and foreign keys; and
- contain no old backend names or columns.

Do not run `prisma migrate reset` against the owner's existing database.

- [ ] **Step 5: Validate against an isolated database**

Run:

```bash
docker exec mockupai-postgres createdb -U mockupai mockupai_rt_mailbox_test
DATABASE_URL='postgresql://mockupai:MockupAI_DB_2024!@localhost:5432/mockupai_rt_mailbox_test' npx prisma migrate deploy
DATABASE_URL='postgresql://mockupai:MockupAI_DB_2024!@localhost:5432/mockupai_rt_mailbox_test' npx prisma validate
docker exec mockupai-postgres dropdb -U mockupai mockupai_rt_mailbox_test
npx vitest run tests/rt-mailbox-schema-source.test.ts
```

Expected: migration, validation, and focused test PASS. If the local container is unavailable, start only the existing `postgres` service and repeat; do not point the command at a shared database.

---

### Task 3: Build The RT REST2 Client And Normalized Contracts

**Files:**
- Create: `src/lib/rt/types.ts`
- Create: `src/lib/rt/normalizers.ts`
- Create: `src/lib/rt/client.ts`
- Create: `src/lib/mailboxes/validation.ts`
- Create: `tests/rt-client.test.ts`
- Create: `tests/rt-normalizers.test.ts`
- Create: `tests/mailbox-validation.test.ts`

- [ ] **Step 1: Write failing REST2 authentication, timeout, pagination, and redaction tests**

Cover this request contract:

```ts
await rtRequest({ method: "GET", path: "/REST/2.0/tickets" });
expect(headers.Authorization).toBe("token rt-test-token");
expect(result.error).not.toContain("rt-test-token");
```

Add tests for `AbortError -> { ok: false, status: 502, error: "timeout" }`, network failure, `next_page`, `page`, `pages`, and `total`.

- [ ] **Step 2: Define stable normalized UI types**

```ts
export type AppStatus = "active" | "pending" | "closed";

export interface NormalizedMailbox {
  id: string;
  name: string;
  email: string;
  active: boolean;
  syncStatus: "PROVISIONING" | "ACTIVE" | "DEGRADED" | "DISABLED";
}

export interface NormalizedConversation {
  id: number;
  mailboxId: string;
  number: string;
  subject: string;
  status: AppStatus;
  updatedAt: string;
  createdAt: string;
  articleCount: number;
  fromName?: string;
  fromEmail?: string;
  labels: Array<{
    id: string;
    name: string;
    state: "ACTIVE" | "PENDING_CREATE" | "PENDING_RENAME" | "PENDING_DELETE" | "FAILED";
  }>;
}
```

Retain the current `NormalizedThread` and attachment shape so `EmailBodyRenderer` does not need a backend-specific rewrite.

- [ ] **Step 3: Implement RT status mappings with tests**

Use one explicit mapping:

```ts
export function rtStatusToAppStatus(status: string): AppStatus {
  if (status === "stalled") return "pending";
  if (["resolved", "rejected", "deleted"].includes(status)) return "closed";
  return "active";
}

export const APP_TO_RT_STATUS = {
  active: "open",
  pending: "stalled",
  closed: "resolved",
} as const;
```

- [ ] **Step 4: Implement the REST2 client**

Required exports:

```ts
rtRequest<T>()
searchTickets({ queueId, status, labelName, page, pageSize })
getTicket(ticketId)
getTicketTransactions(ticketId)
getTicketAttachments(ticketId)
correspond(ticketId, { content, contentType })
comment(ticketId, { content, contentType })
updateTicketStatus(ticketId, status)
listQueues()
createQueue({ name, description, correspondAddress })
updateQueue(queueId, input)
disableQueue(queueId)
findOrCreateGmailLabelsCustomField()
attachCustomFieldToQueue(customFieldId, queueId)
setTicketGmailLabels(ticketId, names)
```

Build TicketSQL with server-owned queue ID and resolved label name. Never concatenate raw client values. Encode query parameters with `URLSearchParams`.

`correspond()` remains available for inbound/administrative RT behavior, but the app reply path must not rely on RT-generated outbound mail. `comment()` records an already-sent Gmail reply in RT without triggering requestor email. The comment body must include a safe metadata line `Gmail-Message-ID: <generated-id>` plus the reply body so later normalization can link the RT transaction to the outbound `GmailMessageLink`.

- [ ] **Step 5: Replace validation semantics with Gmail-only strict schemas**

`createMailboxSchema` accepts exactly `storeId`, `name`, `email`, optional `fromName`, and `appPassword`. It rejects `provider`, custom IMAP/SMTP settings, assignments, import mode, and arbitrary history windows. `updateMailboxSchema` accepts name/fromName and optional replacement App Password; email and store cannot move in this phase.

Add strict schemas for:

```ts
createLabelSchema = { storeId, mailboxId, name }
renameLabelSchema = { storeId, mailboxId, name }
replaceConversationLabelsSchema = { storeId, mailboxId, labelIds: string[] }
replySchema = { text: string(1..50000) }
statusSchema = { status: "active" | "pending" | "closed" }
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run tests/rt-client.test.ts tests/rt-normalizers.test.ts tests/mailbox-validation.test.ts tests/mailbox-identity.test.ts tests/email-body-renderer.test.ts
```

Expected: PASS with no token in captured logs.

---

### Task 4: Implement The Gmail IMAP Metadata And Label Adapter

**Files:**
- Create: `src/lib/mailboxes/types.ts`
- Create: `src/lib/mailboxes/gmail-client.ts`
- Create: `src/lib/mailboxes/gmail-smtp.ts`
- Create: `src/lib/mailboxes/gmail-reply.ts`
- Create: `tests/gmail-client.test.ts`
- Create: `tests/gmail-smtp.test.ts`
- Create: `tests/gmail-reply.test.ts`
- Create: `tests/gmail-label-contract.test.ts`

- [ ] **Step 1: Write failing adapter tests around an injected ImapFlow factory**

Do not make unit tests connect to Gmail. Inject `createClient(credentials)` and mock these behaviors:

- capability includes `X-GM-EXT-1`;
- Inbox lock and fetch request includes `flags`, `labels`, `threadId`, `headers`, and `internalDate`;
- fetched `flags` never gain `\\Seen`;
- add/remove calls pass `{ uid: true, useLabels: true }`;
- create/rename/delete call mailbox management methods;
- Spam, Trash, Sent, All Mail are excluded from the visible catalog;
- Inbox, Important, and Starred are read-only;
- nested user label names remain exact and are normalized only for uniqueness.

- [ ] **Step 2: Define Gmail metadata contracts**

```ts
export interface GmailMessageMetadata {
  uid: bigint;
  uidValidity: bigint;
  gmailMessageId: string;
  gmailThreadId: string;
  rfcMessageId: string | null;
  internalDate: Date;
  flags: string[];
  labels: string[];
}

export interface GmailLabelDescriptor {
  name: string;
  normalizedName: string;
  type: "USER" | "INBOX" | "IMPORTANT" | "STARRED";
  mutable: boolean;
}
```

- [ ] **Step 3: Implement secure connection and probe**

Use `imap.gmail.com:993`, `secure: true`, email/App Password auth, logger disabled, and a bounded socket timeout. After connect, require `X-GM-EXT-1`; otherwise return `gmail_extension_missing`.

- [ ] **Step 4: Implement Inbox-only metadata scans**

Acquire `getMailboxLock("INBOX")`. Bootstrap search uses `{ since: initialSyncAfter }`; steady state fetches UID range `${lastCommittedUid + 1}:*`. Fetch metadata only—never request `source` here. Capture mailbox UIDVALIDITY and return messages sorted by UID.

- [ ] **Step 5: Implement visible label discovery and full CRUD**

Use ImapFlow mailbox list/create/rename/delete methods for user labels and `messageFlagsAdd`/`messageFlagsRemove` with `useLabels: true` for assignment. Read back labels and flags after every mutation and throw `gmail_readback_mismatch` if the result differs or `\\Seen` appears.

- [ ] **Step 6: Implement targeted known-thread lookup**

Select Gmail All Mail only after receiving a stored Gmail thread ID. Search by that exact thread ID, fetch only returned UIDs, and assert every result has the expected thread ID. This method returns metadata only and is not exposed as a general search.

- [ ] **Step 7: Implement Gmail SMTP verification**

Create a Nodemailer transport for `smtp.gmail.com:587`, `secure: false`, STARTTLS required, and email/App Password auth. Call `transport.verify()` only; do not send a probe email. Map authentication failure to `gmail_auth_failed`, TLS/connectivity failure to `gmail_smtp_unavailable`, and never include the upstream SMTP transcript in logs or responses.

- [ ] **Step 8: Write failing app-owned Gmail reply tests**

Create `tests/gmail-reply.test.ts` with mocked Nodemailer and Gmail metadata lookup. Cover:

```ts
expect(sent.messageId).toMatch(/^<mockupai-reply-/);
expect(sent.inReplyTo).toBe("<customer-last@example.test>");
expect(sent.references).toContain("<customer-first@example.test>");
expect(sent.references).toContain("<customer-last@example.test>");
expect(sent.subject).toBe("Re: Original customer subject");
expect(result.gmailThreadId).toBe("thread-1");
```

Also assert the function fails with `gmail_reply_thread_mismatch` when Gmail returns a different thread ID, fails with `gmail_reply_not_in_sent` when the read-back lacks `\\Sent`, and never logs or returns the App Password.

- [ ] **Step 9: Implement app-owned Gmail reply sender**

Create `sendGmailThreadReply(input)` in `src/lib/mailboxes/gmail-reply.ts`:

```ts
export interface GmailReplyInput {
  credentials: GmailCredentials;
  to: string;
  fromName?: string;
  subject: string;
  text: string;
  gmailThreadId: string;
  latestExternalMessageId: string;
  references: string[];
  lookupByMessageId(messageId: string): Promise<GmailMessageMetadata | null>;
}
```

The function generates a new RFC Message-ID, sends through Nodemailer with `messageId`, `inReplyTo`, and `references`, then calls `lookupByMessageId()` for the generated ID. It returns only safe metadata: generated Message-ID, Gmail message ID, Gmail thread ID, UID, UIDVALIDITY, and internal date. It throws `gmail_reply_thread_mismatch` unless the read-back thread equals `input.gmailThreadId`, and throws `gmail_reply_not_in_sent` unless read-back labels include `\\Sent`.

- [ ] **Step 10: Run focused tests**

Run:

```bash
npx vitest run tests/gmail-client.test.ts tests/gmail-smtp.test.ts tests/gmail-reply.test.ts tests/gmail-label-contract.test.ts
```

Expected: PASS; mocked messages remain Unread through every mutation.

---

### Task 5: Implement Credential Handling, Runtime Config, And Verified Mailgate

**Files:**
- Create: `src/lib/mailboxes/credentials.ts`
- Create: `src/lib/mailboxes/runtime-config.ts`
- Create: `scripts/mailbox-secret-helper.ts`
- Create: `scripts/verified-rt-mailgate.ts`
- Create: `infra/rt/Dockerfile.mailbox-worker`
- Create: `.dockerignore`
- Create: `tests/mailbox-credentials.test.ts`
- Create: `tests/mailbox-runtime-config.test.ts`
- Create: `tests/verified-rt-mailgate.test.ts`

- [ ] **Step 1: Write failing credential redaction and config tests**

Assertions must prove:

```ts
expect(renderedGetmail).not.toContain(appPassword);
expect(renderedMsmtp).not.toContain(appPassword);
expect(renderedGetmail).toContain('mailboxes = ("INBOX",)');
expect(renderedGetmail).toContain("use_peek = true");
expect(renderedGetmail).toContain("delete = false");
expect(renderedMsmtp).toContain("passwordeval");
```

Also test path traversal rejection for mailbox IDs and `0600` file modes.

- [ ] **Step 2: Implement mailbox credential functions**

```ts
saveEncryptedAppPassword(mailboxId, plaintext)
getDecryptedAppPassword(mailboxId)
maskMailboxCredential(mailboxId)
materializeRuntimeSecret(mailboxId, runtimeDir)
removeRuntimeSecret(mailboxId, runtimeDir)
```

Reuse `src/lib/crypto/envelope.ts`. `materializeRuntimeSecret` writes atomically to `join(runtimeDir, "secrets", mailboxId)` with `0600`, never logs plaintext, and refuses IDs outside `/^[a-z0-9_-]+$/i`.

- [ ] **Step 3: Implement deterministic getmail config rendering**

Bootstrap config uses:

```ini
[retriever]
type = SimpleIMAPSSLRetriever
server = imap.gmail.com
username = support@example.test
password_command = ("/app/node_modules/.bin/tsx", "/app/scripts/mailbox-secret-helper.ts", "mailbox_id")
mailboxes = ("INBOX",)
use_peek = true
imap_search = (SINCE 24-Dec-2025)

[destination]
type = MDA_external
path = /app/node_modules/.bin/tsx
arguments = ("/app/scripts/verified-rt-mailgate.ts", "--mailbox-id", "mailbox_id")

[options]
delete = false
read_all = true
verbose = 0
```

Steady-state config replaces the search line with `imap_search = (UID 101:*)`. Date and UID values are computed, not accepted from the client.

- [ ] **Step 4: Implement stdout-only secret helper**

The helper accepts exactly one opaque mailbox ID, loads the encrypted row, writes only the password plus newline to stdout, and sends safe errors to stderr with exit code 1. Tests must spy on stdout/stderr and prove no other field is printed.

- [ ] **Step 5: Implement verified `rt-mailgate` wrapper**

The wrapper must:

1. read stdin into a `Buffer` without altering MIME bytes;
2. extract the RFC Message-ID only from the header block;
3. load the pre-indexed `GmailMessageLink` and mailbox queue;
4. spawn `/opt/rt/bin/rt-mailgate --debug --queue ${mailbox.rtQueueId.toString()} --action correspond --url ${process.env.RT_URL}` without a shell;
5. pass the original buffer to child stdin;
6. before delivery, search REST2 attachments by the exact normalized RFC Message-ID and, when found, verify its transaction/ticket and persist the existing identity without invoking mailgate;
7. require exit code 0 and an exact `ok` line in combined stdout/stderr while explicitly rejecting any `not ok` line (RT 6.0.3 emits both outcomes on stderr and exits zero for permission denial);
8. after delivery, poll REST2 `/attachments` by exact Message-ID, follow `TransactionId` through `/transaction/:id`, and verify that the resulting ticket belongs to the mailbox queue;
9. persist `MailboxConversation` and `GmailMessageLink` linkage transactionally; and
10. exit `75` for retryable failures and `1` for malformed permanent input.

The test suite must simulate stderr `ok`, stderr `not ok - Permission Denied`, timeout, REST2 mismatch, crash-after-RT duplicate retry, and DB failure.

- [ ] **Step 6: Build the mailbox worker runtime used by the live gates**

Create `.dockerignore` with these rules before any image build:

```dockerignore
.git
.next
node_modules
Archive.zip
scratch
**/.env
**/.env.*
!**/.env.example
```

Create the multi-stage mailbox worker image now so Task 6 can run the wrapper with the exact RT 6.0.3 client:

```dockerfile
FROM firefart/requesttracker@sha256:61542e700818c1422ee476750fa33dfd5470a407329f2586df6fd00a6b8d67a8 AS rt
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip perl libwww-perl libhttp-message-perl ca-certificates \
 && pip3 install --break-system-packages getmail6==6.20.0 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=rt /opt/rt/bin/rt-mailgate /opt/rt/bin/rt-mailgate
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "worker"]
```

Run:

```bash
docker build -f infra/rt/Dockerfile.mailbox-worker -t mockupai-mailbox-worker:rt6.0.3 .
docker run --rm --entrypoint sh mockupai-mailbox-worker:rt6.0.3 -c 'getmail --version && /opt/rt/bin/rt-mailgate --help >/dev/null'
```

Expected: getmail reports 6.20.0 and mailgate exits without missing Perl modules.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest run tests/mailbox-credentials.test.ts tests/mailbox-runtime-config.test.ts tests/verified-rt-mailgate.test.ts
```

Expected: PASS; no captured output includes credential/token fixtures.

---

### Task 6: Execute The Four Mandatory Live Gates

**Files:**
- Create: `scripts/verify-rt-gmail-gates.ts`
- Create: `infra/rt/gate-compose.yml`
- Create: `docs/reports/2026-06-24-rt-gmail-production-gates.md`
- Modify: `infra/rt/.env.example` only if the lab reveals a missing non-secret variable

- [ ] **Step 1: Start the pinned RT 6.0.3 lab image**

Use the verified multi-architecture digest:

```bash
docker run --rm --entrypoint sh \
  firefart/requesttracker@sha256:61542e700818c1422ee476750fa33dfd5470a407329f2586df6fd00a6b8d67a8 \
  -c "perl -I/opt/rt/lib -MRT -e 'print \$RT::VERSION'"
```

Expected: exactly `6.0.3`.

Create `infra/rt/gate-compose.yml` with a localhost-only RT service using the already-tested lab image digest, a named disposable volume, and `RT_ROOT_PASSWORD: ${RT_GATE_ROOT_PASSWORD:?required}`. This gate stack is test-only; Task 14 uses PostgreSQL and the production-capable image.

Run:

```bash
export RT_GATE_ROOT_PASSWORD="$(openssl rand -hex 24)"
docker compose -f infra/rt/gate-compose.yml up -d
docker compose -f infra/rt/gate-compose.yml exec rt perl -I/opt/rt/lib -MRT -e 'print $RT::VERSION'
```

Expected: RT is healthy on `127.0.0.1:18082` and reports `6.0.3`. Keep the generated root password only in the current shell and remove the disposable gate volume after Task 6 evidence is captured.

- [ ] **Step 2: Gate A — Gmail label rename/delete**

Against a disposable user label, run create → assign → rename → unassign → delete. Before and after every operation fetch flags/labels and record that `\\Seen` is absent.

Expected: PASS for all five operations and final label absence.

- [ ] **Step 3: Gate B — verified mailgate identity**

Pipe one unique RFC822 message through `scripts/verified-rt-mailgate.ts`, then query REST2 attachments and transaction detail to confirm one ticket, one inbound transaction, exact Message-ID, and persisted app mapping. Repeat the same input, including one simulated retry before app persistence.

Expected: first delivery creates one ticket; retry creates no second ticket and returns the same mapping.

- [ ] **Step 4: Gate C — Gmail SMTP Sent and threading**

Reply through the app-owned Gmail SMTP sender using the selected Gmail mailbox. Generate the outbound Message-ID in the app, set `In-Reply-To` to the latest known external Gmail Message-ID, set `References` to the known Gmail reference chain, and preserve the original subject with a `Re:` prefix. Check Gmail Sent by exact generated Message-ID and verify the reply's Gmail thread ID equals the inbound thread ID. Then record the accepted reply in RT with `comment(ticketId, { content, contentType })`, including the safe `Gmail-Message-ID` metadata line, and verify RT does not send a duplicate outbound email. Send a customer reply using the app-sent Message-ID as `In-Reply-To`, deliver it through the verified wrapper, and verify RT adds it to the same ticket.

Expected: one Gmail thread and one RT ticket across inbound, app-sent agent reply, and customer reply; Gmail Sent contains the agent reply; RT stores exactly one internal app-reply comment and one inbound customer reply transaction; RT does not create a second outbound email for the app reply.

- [ ] **Step 5: Gate D — permission denial must fail delivery**

Remove `CreateTicket` from a test queue and run the wrapper.

Expected: wrapper detects RT `not ok`, exits non-zero, getmail does not record delivery, and restoring ACL allows the next cycle to deliver once.

- [ ] **Step 6: Write the bounded gate report**

Record versions, timestamps, test Message-IDs, sanitized commands, before/after flags, RT ticket IDs, and PASS/FAIL. Never include email credentials, RT token, SMTP transcript, or raw message bodies.

Expected: all four gates PASS before continuing. If any gate fails, stop execution here and return the report for design revision.

---

### Task 7: Implement Mailbox Sync, Cursor Safety, And BullMQ Scheduling

**Files:**
- Create: `src/lib/mailboxes/sync.ts`
- Create: `src/lib/mailboxes/queue.ts`
- Create: `src/lib/jobs/workers/mailbox-sync-worker.ts`
- Create: `tests/mailbox-sync.test.ts`
- Create: `tests/mailbox-queue.test.ts`
- Modify: `src/lib/queue/queue.ts`

- [ ] **Step 1: Write failing sync state-machine tests**

Cover bootstrap six-month search, steady UID search, no cursor advance on partial delivery, UIDVALIDITY change, duplicate scheduler execution, lock expiry, auth degradation, and successful health recovery.

- [ ] **Step 2: Define two queue payloads**

```ts
export type MailboxSyncJob = { mailboxId: string; reason: "schedule" | "manual" | "reconcile" };
export type GmailLabelJob = { operationId: string };
```

Use queue names `mailbox-sync` and `gmail-label-operations`. Job IDs are template literals ``sync:${mailboxId}`` and ``label:${operationId}`` for enqueue dedupe.

- [ ] **Step 3: Implement one-mailbox synchronization**

`syncMailbox(mailboxId)` must:

1. atomically acquire/renew a DB lease;
2. decrypt credentials only in memory;
3. scan Inbox metadata and pre-index identity rows;
4. render a config into the mailbox runtime directory;
5. spawn getmail6 with a timeout and sanitized logs;
6. reconcile linked conversations and labels;
7. advance `lastCommittedUid` only through the highest fully linked UID;
8. set `lastSyncAt`, clear safe error state, and release the lease; and
9. on failure, preserve cursor, set `DEGRADED` only for auth/permanent configuration errors, and rethrow retryable errors for BullMQ.

- [ ] **Step 4: Handle UIDVALIDITY changes safely**

On mismatch, clear only UID cursor assumptions, perform a six-month bounded metadata rescan, match existing rows by Gmail message ID, and never call getmail for already-linked Gmail message IDs.

- [ ] **Step 5: Schedule active mailboxes every minute**

Use one BullMQ repeat scheduler job that queries active mailboxes and enqueues per-mailbox jobs. Do not create one Redis repeat registration per mailbox; this avoids orphan schedules after disable/delete.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run tests/mailbox-sync.test.ts tests/mailbox-queue.test.ts
```

Expected: PASS, including no cursor advance when the third of three messages fails.

---

### Task 8: Implement Durable Full Label CRUD And Conversation Inheritance

**Files:**
- Create: `src/lib/mailboxes/labels.ts`
- Create: `tests/mailbox-label-operations.test.ts`
- Modify: `src/lib/jobs/workers/mailbox-sync-worker.ts`

- [ ] **Step 1: Write failing outbox/idempotency tests**

Cover create, rename, delete, assign, unassign, duplicate job execution, crash after Gmail mutation before DB confirmation, dead-letter after five attempts, mailbox isolation, system-label rejection, and RT custom-field repair.

- [ ] **Step 2: Implement operation creation helpers**

Each API mutation writes one `GmailLabelOperation` with a deterministic SHA-256 idempotency key derived from mailbox, conversation, operation type, label, desired name/set, and a client request ID. A duplicate request returns the existing operation.

- [ ] **Step 3: Implement create/rename/delete processors**

Use a per-mailbox lock. Mutate Gmail, read back the catalog, then transactionally update `GmailLabel`, affected `ConversationLabel` rows, and operation state. Delete must count affected conversations before Gmail deletion and remove only label joins, never conversations/messages.

- [ ] **Step 4: Implement replace-style conversation label sets**

Resolve all requested label IDs under the selected mailbox, diff against confirmed joins plus pending operations, create assign/unassign operations, apply to every known Gmail message ID in the conversation, and update RT only after all Gmail read-backs succeed.

- [ ] **Step 5: Apply confirmed labels to future messages**

During sync, when a new Gmail message links to an existing conversation, enqueue inheritance using the confirmed conversation label set. Use targeted Gmail thread lookup for archived/known messages without ingesting source bodies.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run tests/mailbox-label-operations.test.ts tests/gmail-client.test.ts tests/mailbox-sync.test.ts
```

Expected: PASS; cross-mailbox labels are rejected and every retry is idempotent.

---

### Task 9: Replace Admin Mailbox Provisioning With Gmail + RT

**Files:**
- Create: `src/lib/rt/provisioning.ts`
- Modify: `src/app/api/admin/mailboxes/route.ts`
- Modify: `src/app/api/admin/mailboxes/[id]/route.ts`
- Modify: `src/app/api/admin/mailboxes/[id]/status/route.ts`
- Modify: `src/app/api/admin/mailboxes/test-connection/route.ts`
- Delete: `src/app/api/admin/mailboxes/probe/route.ts`
- Delete: `src/app/api/admin/mailboxes/[id]/assignments/route.ts`
- Create: `tests/rt-mailbox-admin-routes.test.ts`
- Create: `tests/rt-provisioning.test.ts`

- [ ] **Step 1: Write failing route/provisioning tests**

Test store ownership, duplicate Gmail address, strict body rejection, encrypted credential persistence, fixed six-month cutoff, idempotent queue naming, RT compensation, status disable/enable, no credential response, and credential-safe audit events.

- [ ] **Step 2: Implement idempotent RT provisioning**

Create the local mailbox first in `PROVISIONING` with encrypted credentials and no queue ID. Use queue name ``vmg-mailbox-${mailbox.id}``, human description ``${store.name} / ${mailbox.name}``, and Gmail correspondence address. Find/create the `Gmail Labels` custom field, attach it, apply `CreateTicket`, `ReplyToTicket`, `SeeQueue`, `ShowTicket`, `ModifyTicket`, and correspondence rights to the service principal, then persist the queue ID and set `ACTIVE`.

- [ ] **Step 3: Implement compensation**

If Gmail probe, queue provisioning, runtime materialization, or ACL probe fails, disable any created RT queue, remove runtime secrets/configs, keep the local row `DEGRADED` with a safe code, and permit an idempotent retry. Do not log raw RT bodies or credentials.

- [ ] **Step 4: Replace create/update/test-connection routes**

Gmail test connection checks IMAP extension and SMTP authentication. Update keeps existing password when omitted; when supplied, probe first, encrypt, rotate runtime secret, and only then replace the stored cipher.

- [ ] **Step 5: Replace status semantics**

Disable stops scheduling, removes runtime secret material, and disables the RT queue. Enable reprobes credentials, repairs queue/custom field/config, and resumes scheduling. Hard delete remains unavailable.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run tests/rt-provisioning.test.ts tests/rt-mailbox-admin-routes.test.ts tests/mailbox-validation.test.ts
```

Expected: PASS with no Zammad imports in admin routes.

---

### Task 10: Replace The Operator Proxy With RT And App Mailbox IDs

**Files:**
- Create: `src/lib/mailboxes/auth.ts`
- Create: `src/lib/mailboxes/proxy/mailboxes.ts`
- Create: `src/lib/mailboxes/proxy/conversations.ts`
- Create: `src/lib/mailboxes/proxy/labels.ts`
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
- Create: `tests/rt-mailbox-proxy.test.ts`
- Modify: `tests/mailbox-proxy-source.test.ts`

- [ ] **Step 1: Write failing authorization and dispatch tests**

Cover missing feature, wrong tenant/store/mailbox, disabled/degraded mailbox behavior, unsupported path, app mailbox ID use, queue ownership verification, reply, status, label filter, pagination, and attachment normalization.

- [ ] **Step 2: Implement store-scoped auth without user mappings**

`MailboxAccessContext` contains `userId`, `role`, and `tenantId`. `requireActiveStoreMailbox(ctx, storeId, mailboxId)` loads the local mailbox and server-owned `rtQueueId`. There is no external-user mapping and no reply/status permission row.

- [ ] **Step 3: Convert mailbox listing to app IDs**

Return:

```json
{
  "mailboxes": [
    { "id": "mailbox_cuid", "name": "Support", "email": "support@example.test", "active": true, "syncStatus": "ACTIVE" }
  ]
}
```

Never expose RT queue IDs.

- [ ] **Step 4: Implement RT conversation handlers**

Resolve mailbox first, then call REST2 with its queue ID. Detail verifies returned ticket queue. Reply uses the app-owned Gmail reply sender: load the conversation's stored Gmail thread metadata, send through Gmail SMTP, verify Gmail Sent and matching thread ID, persist the outbound `GmailMessageLink`, then call RT REST2 `/ticket/:id/comment` with a `Gmail-Message-ID` metadata line to record the already-sent reply without triggering RT outbound mail. Status maps through the normalized contract; errors map 401/403/404/409/422/5xx to the current localized API behavior.

- [ ] **Step 5: Implement label handlers and filter**

Catalog queries are mailbox scoped. `labelId` resolves locally to a confirmed label name before TicketSQL is built. Mutation handlers enqueue outbox jobs and return `200` when confirmed within the request window or `202` with operation ID/state.

- [ ] **Step 6: Keep the catch-all route thin**

The route performs feature/session setup and dispatches exact allowlisted method/path combinations to the three focused handler modules. Reject every unrecognized route with 403 and an audit event.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest run tests/rt-mailbox-proxy.test.ts tests/mailbox-proxy-source.test.ts tests/mailbox-identity.test.ts tests/email-body-renderer.test.ts
```

Expected: PASS with no RT queue ID accepted from a client request.

---

### Task 11: Update The Admin Mailbox UI For Gmail-Only RT Provisioning

**Files:**
- Modify: `src/app/(authed)/admin/mailboxes/page.tsx`
- Modify: `src/app/(authed)/admin/mailboxes/CreateMailboxModal.tsx`
- Modify: `src/app/(authed)/admin/mailboxes/EditMailboxModal.tsx`
- Modify: `src/app/(authed)/admin/mailboxes/MailboxList.tsx`
- Delete: `src/app/(authed)/admin/mailboxes/AssignUsersModal.tsx`
- Create: `src/app/(authed)/admin/mailboxes/rt-mailbox-admin-source.test.ts`

- [ ] **Step 1: Write a failing UI source contract**

Assert no custom provider fields, assignment UI, old backend text/IDs, or password reflection. Require App Password input, six-month fixed policy copy, sync-status badge, reconnect action, selected-store requirement, and no automatic store selection.

- [ ] **Step 2: Simplify create flow**

Keep fields: mailbox name, optional sender name, Gmail email, App Password. Show fixed copy: “Imports Inbox email from the latest 6 months, then checks for new email every minute. Email remains unread in Gmail.”

- [ ] **Step 3: Update edit/status UI**

Allow name/sender-name changes and optional App Password rotation. Show `PROVISIONING`, `ACTIVE`, `DEGRADED`, and `DISABLED`, last successful sync, safe error text, test connection, reconnect, enable, and disable.

- [ ] **Step 4: Preserve store-first behavior**

No store selected means no mailbox list and disabled create action. One store may show multiple Gmail mailbox rows.

- [ ] **Step 5: Run focused UI contract and build typecheck**

Run:

```bash
npx vitest run src/app/'(authed)'/admin/mailboxes/rt-mailbox-admin-source.test.ts
npx tsc --noEmit --pretty false
```

Expected: focused test PASS and no mailbox-related TypeScript errors.

---

### Task 12: Add Mailbox-Scoped Label Management To The Inbox UI

**Files:**
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx`
- Create: `src/app/(authed)/mailboxes/mailbox-label-ui-source.test.ts`
- Create: `tests/mailbox-ui-contract.test.ts`

- [ ] **Step 1: Write failing UI contracts**

Require string mailbox IDs, explicit mailbox selector, label catalog scoped by selected mailbox, fixed Inbox, read-only Important/Starred, create/rename/delete controls for user labels, label filter query, conversation badges, replace-style label save, pending/failed states, and delete confirmation count.

- [ ] **Step 2: Stop auto-selecting the first mailbox**

After store selection, list mailboxes but require the operator to choose one. Changing store clears mailbox, label, conversation, page, and pending-operation state.

- [ ] **Step 3: Load labels only after mailbox selection**

Call `/api/mailbox-proxy/labels?storeId=...&mailboxId=...`. Abort/ignore stale responses when the selected mailbox changes. Never merge label lists from two mailboxes.

- [ ] **Step 4: Add label rail and catalog actions**

Inbox remains fixed. Important/Starred are filter-only. User label menu exposes rename/delete; create/rename/delete shows pending state from the operation response and refreshes until confirmed or failed.

- [ ] **Step 5: Add conversation label editor**

The detail panel edits a complete desired label set and sends one `PUT /conversations/:id/labels`. Disable repeat submission while pending. Show only confirmed badges in rows and a separate pending indicator in detail.

- [ ] **Step 6: Add label filtering**

Selecting a label resets page/detail and appends `labelId` to the conversation request. Status and label filters combine; mailbox/store remain mandatory.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest run src/app/'(authed)'/mailboxes/mailbox-label-ui-source.test.ts tests/mailbox-ui-contract.test.ts
npx tsc --noEmit --pretty false
```

Expected: PASS with no numeric mailbox ID assumptions.

---

### Task 13: Register Workers, One-Minute Scheduling, Health, And Shutdown

**Files:**
- Modify: `src/lib/queue/queue.ts`
- Modify: `start-worker.ts`
- Modify: `src/lib/queue/workers/start-worker-source.test.ts`
- Modify: `src/app/api/health/route.ts`
- Modify: `ecosystem.config.js`
- Create: `tests/mailbox-worker-health.test.ts`

- [ ] **Step 1: Extend source tests before startup changes**

Require lazy imports for mailbox worker modules, ready logging, close-on-shutdown, one scheduler instance, and required environment validation for `RT_URL`, `RT_API_TOKEN`, `MAILBOX_RUNTIME_DIR`, `DATABASE_URL`, and `REDIS_URL`.

- [ ] **Step 2: Register both BullMQ workers and scheduler**

Start sync and label processors from `start-worker.ts`. Keep all worker handles and close them during SIGINT/SIGTERM. Scheduler setup must be idempotent across PM2 restarts.

- [ ] **Step 3: Extend health response**

Report DB connectivity plus aggregate mailbox health: active count, degraded count, oldest `lastSyncAt`, queue availability, and RT REST2 reachability. Do not include mailbox emails, tokens, or safe error details that reveal account identity.

- [ ] **Step 4: Add PM2 runtime directory and environment contract**

The worker process creates `MAILBOX_RUNTIME_DIR` with `0700` before starting. Keep one worker process until lock/throughput tests prove higher concurrency safe.

- [ ] **Step 5: Run worker tests**

Run:

```bash
npx vitest run src/lib/queue/workers/start-worker-source.test.ts tests/mailbox-worker-health.test.ts tests/mailbox-queue.test.ts
```

Expected: PASS; shutdown closes every mailbox worker and scheduler.

---

### Task 14: Add Production RT 6.0.3 + PostgreSQL + msmtp Infrastructure

**Files:**
- Create: `infra/rt/docker-compose.yml`
- Create: `infra/rt/Dockerfile`
- Modify: `infra/rt/Dockerfile.mailbox-worker`
- Create: `infra/rt/RT_SiteConfig.pm`
- Create: `infra/rt/msmtprc`
- Create: `infra/rt/bin/mailbox-secret-helper`
- Create: `infra/rt/.env.example`
- Create: `infra/rt/README.md`
- Modify: `.env.example`
- Create: `tests/rt-infra-source.test.ts`

- [ ] **Step 1: Write a failing infrastructure source test**

Require:

- pinned image digest `sha256:61542e700818c1422ee476750fa33dfd5470a407329f2586df6fd00a6b8d67a8`;
- RT version check equal to `6.0.3`;
- PostgreSQL, not SQLite;
- persistent RT/PostgreSQL volumes;
- health checks;
- internal RT network exposure;
- msmtp `--read-envelope-from` account selection;
- `passwordeval` helper and no plaintext passwords;
- non-root service execution where the image supports it; and
- no Docker socket mount.

- [ ] **Step 2: Build the RT image**

Base it on:

```dockerfile
FROM firefart/requesttracker@sha256:61542e700818c1422ee476750fa33dfd5470a407329f2586df6fd00a6b8d67a8
COPY RT_SiteConfig.pm /opt/rt/etc/RT_SiteConfig.d/90-mockupai.pm
COPY msmtprc /etc/msmtprc
COPY bin/mailbox-secret-helper /usr/local/bin/mailbox-secret-helper
RUN chmod 0755 /usr/local/bin/mailbox-secret-helper \
 && chmod 0640 /etc/msmtprc /opt/rt/etc/RT_SiteConfig.d/90-mockupai.pm
```

At build time run `perl -I/opt/rt/lib -MRT -e 'die unless $RT::VERSION eq "6.0.3"'` and `perl -c` on the site config.

- [ ] **Step 3: Configure RT mail and REST2**

`RT_SiteConfig.pm` must set PostgreSQL connection variables from environment, `MailCommand` to `sendmailpipe`, sendmail path to `/usr/bin/msmtp --read-envelope-from`, queue correspondence behavior, canonical web URL, secure cookies behind HTTPS, and safe logging. Keep RT native UI internal/admin-only.

- [ ] **Step 4: Configure per-mailbox msmtp selection**

`msmtprc` contains shared Gmail TLS defaults and includes generated account blocks. Each rendered account has exact `from`, `user`, and ``passwordeval /usr/local/bin/mailbox-secret-helper ${mailbox.id}``. msmtp selects the first account matching RT's envelope-from. Disable debug logging because it can expose authentication material.

- [ ] **Step 5: Compose RT with a dedicated PostgreSQL database**

Use `postgres:17-alpine`, a dedicated `rt` database/user, named volumes, health-gated startup, and no public database port. Expose RT only to localhost or the existing reverse-proxy network. Mount `/run/mockupai-mailboxes` read-only into RT for generated config/secrets.

- [ ] **Step 6: Reuse and harden the dedicated mailbox worker image**

Keep the multi-stage image created in Task 5 so the worker receives the exact RT 6.0.3 mailgate client without mounting the Docker socket:

```dockerfile
FROM firefart/requesttracker@sha256:61542e700818c1422ee476750fa33dfd5470a407329f2586df6fd00a6b8d67a8 AS rt
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip perl libwww-perl libhttp-message-perl ca-certificates \
 && pip3 install --break-system-packages getmail6==6.20.0 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=rt /opt/rt/bin/rt-mailgate /opt/rt/bin/rt-mailgate
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "worker"]
```

Compose this service with app `DATABASE_URL`, `REDIS_URL`, `RT_URL`, `RT_API_TOKEN`, encryption key variables, and a read/write `/run/mockupai-mailboxes` mount. Assert `getmail --version` reports 6.20.0 and `rt-mailgate --help` runs without missing Perl modules.

- [ ] **Step 7: Document bootstrap and backup**

README commands must cover: generate secrets, start Postgres/RT, verify version, initialize DB, create the server-only REST2 token, verify `/REST/2.0/rt`, configure reverse proxy/TLS, validate msmtp account selection with `--pretend`, back up PostgreSQL/RT attachments, restore, rotate token, and inspect sanitized health.

- [ ] **Step 8: Replace environment contract**

Remove `ZAMMAD_URL` and `ZAMMAD_ADMIN_TOKEN`. Add:

```dotenv
RT_URL=http://127.0.0.1:8082
RT_API_TOKEN=
RT_GMAIL_LABELS_CUSTOM_FIELD=Gmail Labels
MAILBOX_RUNTIME_DIR=/run/mockupai-mailboxes
MAILBOX_SYNC_CRON="* * * * *"
MAILBOX_SYNC_TIMEOUT_MS=120000
```

- [ ] **Step 9: Validate infrastructure**

Run:

```bash
docker compose --env-file infra/rt/.env.example -f infra/rt/docker-compose.yml config
docker build -t mockupai-rt:6.0.3 infra/rt
docker build -f infra/rt/Dockerfile.mailbox-worker -t mockupai-mailbox-worker:rt6.0.3 .
npx vitest run tests/rt-infra-source.test.ts
```

Expected: config/build/test PASS and image reports RT 6.0.3.

---

### Task 15: Remove Every Active Zammad Artifact And Replace Old Tests/Docs

**Files:**
- Delete: `src/lib/zammad/admin-validation.ts`
- Delete: `src/lib/zammad/auth.ts`
- Delete: `src/lib/zammad/client.ts`
- Delete: `src/lib/zammad/types.ts`
- Delete: `src/lib/zammad/validation.ts`
- Delete: `scripts/seed-zammad-user.ts`
- Delete: `tests/zammad-admin-client.test.ts`
- Delete: `tests/zammad-admin-validation.test.ts`
- Delete: `tests/zammad-client.test.ts`
- Delete: `tests/zammad-mailbox-routes.test.ts`
- Delete: `tests/zammad-mailbox-store-source.test.ts`
- Delete: `tests/zammad-types.test.ts`
- Delete: `tests/zammad-validation.test.ts`
- Delete: `infra/zammad/`
- Delete: `docs/zammad-setup.md`
- Delete: `docs/superpowers/plans/2026-06-20-store-scoped-zammad-mailboxes.md`
- Delete: `docs/superpowers/plans/2026-06-21-mailbox-conversation-identity-email-viewer.md`
- Delete: `docs/superpowers/specs/2026-06-20-store-scoped-zammad-mailboxes-design.md`
- Delete: `docs/superpowers/specs/2026-06-21-mailbox-conversation-identity-design.md`
- Delete: `docs/superpowers/specs/zammad-mailbox-management.md`
- Modify: any runtime source reported by the guard, while preserving unrelated logic

- [ ] **Step 1: Delete the exact obsolete files/directories**

Use `apply_patch` for tracked text files. Remove `infra/zammad` only after `infra/rt` config and image tests pass.

- [ ] **Step 2: Resolve all old imports and names**

Run:

```bash
rg -n -i 'zammad|ZAMMAD_' . \
  --glob '!docs/superpowers/specs/2026-06-24-rt-getmail-gmail-labels-design.md' \
  --glob '!docs/superpowers/plans/2026-06-24-rt-getmail-gmail-labels.md' \
  --glob '!node_modules/**' --glob '!.next/**' --glob '!.git/**'
```

Expected: no output. Rename all backend-specific comments/types to RT/Gmail-neutral names; do not merely suppress the guard.

- [ ] **Step 3: Run the clean-break guard**

Run:

```bash
npx vitest run tests/rt-mailbox-clean-break-source.test.ts
```

Expected: PASS for the test first created in Task 1.

- [ ] **Step 4: Confirm unrelated dirty files were not touched**

Compare `git status --short` with the baseline captured before execution. Only mailbox/RT files, dependency lockfiles, the approved spec/plan, and intentional Prisma mailbox edits may be newly changed by this plan.

---

### Task 16: Final Focused, Build, Live, And Resilience Verification

**Files:**
- Modify: `docs/reports/2026-06-24-rt-gmail-production-gates.md`
- Create: `docs/reports/2026-06-24-rt-getmail-mailbox-verification.md`

- [ ] **Step 1: Run all focused mailbox tests**

Run:

```bash
npx vitest run \
  tests/rt-mailbox-dependencies.test.ts \
  tests/rt-mailbox-clean-break-source.test.ts \
  tests/rt-mailbox-schema-source.test.ts \
  tests/rt-client.test.ts \
  tests/rt-normalizers.test.ts \
  tests/mailbox-validation.test.ts \
  tests/gmail-client.test.ts \
  tests/gmail-label-contract.test.ts \
  tests/mailbox-credentials.test.ts \
  tests/mailbox-runtime-config.test.ts \
  tests/verified-rt-mailgate.test.ts \
  tests/mailbox-sync.test.ts \
  tests/mailbox-queue.test.ts \
  tests/mailbox-label-operations.test.ts \
  tests/rt-provisioning.test.ts \
  tests/rt-mailbox-admin-routes.test.ts \
  tests/rt-mailbox-proxy.test.ts \
  tests/mailbox-proxy-source.test.ts \
  tests/mailbox-worker-health.test.ts \
  tests/rt-infra-source.test.ts \
  tests/mailbox-ui-contract.test.ts \
  tests/mailbox-identity.test.ts \
  tests/email-body-renderer.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Validate schema, typecheck, and production build**

Run:

```bash
npx prisma validate
npx prisma generate
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

Expected: all PASS. If an existing unrelated dirty-worktree failure appears, record the exact file/error and prove it is outside mailbox/RT paths before continuing.

- [ ] **Step 3: Run the complete disposable Gmail acceptance matrix**

Verify:

- initial import includes one five-month-old Inbox message and excludes one seven-month-old message;
- Spam, Trash, Sent, and unrelated All Mail messages are not ingested;
- messages remain Unread after import, retry, every label mutation, and five minutes;
- repeated/overlapping poll creates no duplicate;
- create/rename/delete/assign/unassign works;
- mailbox A labels never appear under mailbox B;
- conversation labels propagate to a new customer reply;
- archived known ticket remains readable and label-mutable;
- app reply appears in Gmail Sent with the same Gmail thread ID; and
- sender, body, HTML, plain text, and attachments remain readable.

- [ ] **Step 4: Run resilience matrix**

Test RT down, Gmail IMAP down, Gmail SMTP down, revoked App Password, worker kill before/after Gmail mutation, wrapper kill after RT accept, duplicate scheduler, concurrent label+sync, UIDVALIDITY mismatch, and high-fanout label rename/delete.

Expected: no lost/duplicate ticket, no false success, safe retry/dead-letter state, no leaked secret, and recovery after dependency restoration.

- [ ] **Step 5: Write the final verification report**

Include exact versions, commands, PASS/FAIL table, sanitized ticket/message identities, known non-mailbox failures, source-guard result, build result, and deployment readiness. Do not include credentials, raw emails, or tokens.

- [ ] **Step 6: Stop for owner review**

Do not stage or commit. Present the changed-file summary, verification evidence, remaining operational steps, and both report links to the owner.

---

## Plan Review Checklist

- [ ] Every approved spec requirement maps to at least one task and one verification step.
- [ ] The four unverified production behaviors are hard gates before route/UI replacement.
- [ ] Gmail Inbox is the only ingestion source; known Sent/All Mail access is metadata-only.
- [ ] App mailbox IDs are the only mailbox IDs accepted from clients.
- [ ] Labels are mailbox-scoped and conversation-level.
- [ ] Interactive label operations are immediate BullMQ jobs, not one-minute polling actions.
- [ ] Cursor advancement occurs only after verified RT linkage.
- [ ] RT `not ok` is treated as failure despite upstream mailgate exit behavior.
- [ ] App Passwords and RT tokens never enter Git, logs, command arguments, tickets, or audits.
- [ ] Zammad code, schema, infrastructure, tests, setup docs, and legacy design artifacts are removed.
- [ ] No task stages or commits files.

## Spec Coverage Matrix

| Acceptance criterion | Implemented by | Verified by |
|---|---|---|
| Store-owned, multi-mailbox model | Tasks 2, 9, 10 | Tasks 9, 16 |
| Selected-mailbox label/conversation isolation | Tasks 8, 10, 12 | Tasks 8, 10, 16 |
| Inbox-only six-month bootstrap | Tasks 4, 5, 7 | Tasks 6, 7, 16 |
| One-minute incremental sync | Tasks 7, 13 | Tasks 7, 13, 16 |
| Preserve Gmail Unread | Tasks 4, 5, 7, 8 | Tasks 4, 6, 16 |
| Never ingest Spam/Trash/Sent/All Mail | Tasks 4, 5, 7 | Tasks 4, 6, 16 |
| No duplicate tickets | Tasks 2, 5, 7 | Tasks 5, 6, 7, 16 |
| Full user-label CRUD | Tasks 4, 8, 10, 12 | Tasks 4, 6, 8, 16 |
| Label operations isolated by Gmail mailbox | Tasks 2, 8, 10 | Tasks 8, 10, 16 |
| Conversation label filtering/inheritance | Tasks 3, 8, 10, 12 | Tasks 8, 10, 12, 16 |
| Retain archived imported conversations | Tasks 2, 4, 8 | Tasks 6, 8, 16 |
| Gmail Sent and same-thread replies | Tasks 3, 4, 5, 10, 14 | Tasks 6, 16 |
| No credential/token leakage | Tasks 3, 4, 5, 9, 14 | Tasks 3, 5, 9, 14, 16 |
| Safe retry/recovery | Tasks 5, 7, 8, 13 | Tasks 5, 7, 8, 16 |
| Complete active Zammad removal | Tasks 1, 2, 15 | Tasks 1, 15, 16 |
