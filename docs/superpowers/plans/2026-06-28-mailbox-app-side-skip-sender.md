# Mailbox App-Side Skip Sender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Skip sender` move the current Gmail thread to Spam and block future Inbox messages from that sender before RT ingest.

**Architecture:** Add one mailbox-scoped skipped-sender table, replace the current unsupported `skip-sender` endpoint with an app-side rule upsert plus existing Spam behavior, and add one sync guard before `runGetmail(...)`. Reuse the existing Gmail IMAP label mutation path; do not add providers or new dependencies.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/Postgres, Gmail IMAP via `imapflow`, getmail6, RT mailgate, Vitest.

---

## Constraints

- Do not add another provider/auth flow.
- Do not change the mailbox auth model away from Gmail App Password/IMAP.
- Keep rules scoped to `mailboxId`.
- Do not add `git add` or commit steps. The repo owner handles staging and commits.
- Keep the implementation small: schema, endpoint, Gmail helper if needed, sync guard, focused tests.

## File Map

- Modify: `prisma/schema.prisma`
  - Add `MailboxSkippedSender` and `Mailbox.skippedSenders`.
- Create: `prisma/migrations/20260628165000_mailbox_skipped_senders/migration.sql`
  - Create the skipped sender table and unique index.
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
  - Replace unsupported skip sender behavior with rule upsert plus current-thread Spam.
- Modify: `src/lib/mailboxes/gmail-client.ts`
  - Add the smallest reusable helper needed to move scanned Inbox messages to Spam by UID/thread without marking them read.
- Modify: `src/lib/mailboxes/sync.ts`
  - Load skipped sender rules and filter/move skipped messages before getmail.
- Modify: `tests/mailbox-proxy-source.test.ts`
  - Update skip sender source expectations.
- Modify: `tests/gmail-client.test.ts`
  - Cover the new app-side Spam helper.
- Modify: `tests/mailbox-sync.test.ts`
  - Cover filtering before getmail and cursor behavior on failed Spam moves.
- Create: `tests/mailbox-skipped-sender-schema-source.test.ts`
  - Guard schema/migration shape.

## Task 1: Add Skipped Sender Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260628165000_mailbox_skipped_senders/migration.sql`
- Create: `tests/mailbox-skipped-sender-schema-source.test.ts`

- [ ] **Step 1: Write schema source test**

Create `tests/mailbox-skipped-sender-schema-source.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox skipped sender schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260628165000_mailbox_skipped_senders/migration.sql",
    "utf8",
  );

  it("adds a mailbox-scoped skipped sender model", () => {
    expect(schema).toContain("model MailboxSkippedSender");
    expect(schema).toContain("skippedSenders MailboxSkippedSender[]");
    expect(schema).toContain("@@unique([mailboxId, senderEmail])");
    expect(schema).toContain('@@map("mailbox_skipped_senders")');
  });

  it("creates the DB table and unique mailbox sender constraint", () => {
    expect(migration).toContain('CREATE TABLE "mailbox_skipped_senders"');
    expect(migration).toContain('"mailbox_id" TEXT NOT NULL');
    expect(migration).toContain('"sender_email" TEXT NOT NULL');
    expect(migration).toContain('"created_by_id" TEXT NOT NULL');
    expect(migration).toContain('"mailbox_skipped_senders_mailbox_id_sender_email_key"');
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run tests/mailbox-skipped-sender-schema-source.test.ts
```

Expected: FAIL because the model and migration do not exist.

- [ ] **Step 3: Add Prisma model**

In `model Mailbox`, add:

```prisma
  skippedSenders MailboxSkippedSender[]
```

Near the mailbox models, add:

```prisma
model MailboxSkippedSender {
  id          String   @id @default(cuid())
  mailboxId   String   @map("mailbox_id")
  senderEmail String   @map("sender_email")
  createdById String   @map("created_by_id")
  createdAt   DateTime @default(now()) @map("created_at")
  mailbox     Mailbox  @relation(fields: [mailboxId], references: [id], onDelete: Cascade)
  createdBy   User     @relation(fields: [createdById], references: [id], onDelete: Cascade)

  @@unique([mailboxId, senderEmail])
  @@index([createdById, createdAt])
  @@map("mailbox_skipped_senders")
}
```

- [ ] **Step 4: Add SQL migration**

Create `prisma/migrations/20260628165000_mailbox_skipped_senders/migration.sql`:

```sql
CREATE TABLE "mailbox_skipped_senders" (
  "id" TEXT NOT NULL,
  "mailbox_id" TEXT NOT NULL,
  "sender_email" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mailbox_skipped_senders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mailbox_skipped_senders_mailbox_id_sender_email_key"
  ON "mailbox_skipped_senders"("mailbox_id", "sender_email");

CREATE INDEX "mailbox_skipped_senders_created_by_id_created_at_idx"
  ON "mailbox_skipped_senders"("created_by_id", "created_at");

ALTER TABLE "mailbox_skipped_senders"
  ADD CONSTRAINT "mailbox_skipped_senders_mailbox_id_fkey"
  FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_skipped_senders"
  ADD CONSTRAINT "mailbox_skipped_senders_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Verify schema**

Run:

```bash
npx vitest run tests/mailbox-skipped-sender-schema-source.test.ts
npx prisma validate
```

Expected: both pass.

## Task 2: Replace Skip Sender Endpoint Behavior

**Files:**
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
- Modify: `tests/mailbox-proxy-source.test.ts`

- [ ] **Step 1: Update source test**

In `tests/mailbox-proxy-source.test.ts`, replace the unsupported skip-sender test with:

```ts
it("implements skip sender as an app-side rule plus current thread spam", () => {
  const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");
  const body = functionBody(source, "handleSkipSender");

  expect(source).toContain("/skip-sender");
  expect(body).toContain("mailboxSkippedSender.upsert");
  expect(body).toContain("reportThreadSpam");
  expect(body).toContain("mailbox.skip_sender");
  expect(body).toContain("senderEmail");
  expect(body).not.toContain("Skip sender requires Gmail");
  expect(body).not.toContain("gmail_filter_requires_oauth");
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run tests/mailbox-proxy-source.test.ts
```

Expected: FAIL because the endpoint still returns the unsupported `501`.

- [ ] **Step 3: Implement minimal endpoint behavior**

In `handleSkipSender`, keep the existing tenant/store/mailbox and sender validation. Change the conversation select to include `gmailThreadId`:

```ts
select: { id: true, gmailThreadId: true, senderEmail: true },
```

After validation, add:

```ts
const appPassword = await getDecryptedAppPassword(mailbox.id);
await createGmailAdapter({
  email: mailbox.email,
  appPassword,
}).reportThreadSpam(conversation.gmailThreadId);

await prisma.$transaction(async (tx) => {
  await tx.mailboxSkippedSender.upsert({
    where: {
      mailboxId_senderEmail: {
        mailboxId: mailbox.id,
        senderEmail,
      },
    },
    create: {
      mailboxId: mailbox.id,
      senderEmail,
      createdById: actorUserId,
    },
    update: {},
  });

  const inboxLabels = await tx.gmailLabel.findMany({
    where: { mailboxId: mailbox.id, type: "INBOX" },
    select: { id: true },
  });

  if (inboxLabels.length > 0) {
    await tx.conversationLabel.deleteMany({
      where: {
        conversationId: conversation.id,
        labelId: { in: inboxLabels.map((label) => label.id) },
      },
    });
  }

  await tx.mailboxConversation.update({
    where: { id: conversation.id },
    data: { isUnread: false },
  });
});
```

Replace the unsupported audit with:

```ts
await logAudit({
  actorUserId,
  tenantId,
  action: "mailbox.skip_sender",
  resourceType: "rt_ticket",
  resourceId: String(ticketId),
  metadata: { mailboxId: mailbox.id, storeId, senderEmail },
});

return json({ ok: true, senderEmail });
```

- [ ] **Step 4: Verify endpoint source**

Run:

```bash
npx vitest run tests/mailbox-proxy-source.test.ts
```

Expected: PASS.

## Task 3: Add Gmail Spam Helper for Scanned Messages

**Files:**
- Modify: `src/lib/mailboxes/gmail-client.ts`
- Modify: `tests/gmail-client.test.ts`

- [ ] **Step 1: Add Gmail helper test**

Append to `tests/gmail-client.test.ts`:

```ts
it("moves scanned Inbox UIDs to Spam without marking them read", async () => {
  const client = mockClient();
  const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);

  await adapter.moveInboxMessagesToSpam([1]);

  expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX");
  expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["\\Spam"], { uid: true, useLabels: true });
  expect(client.messageFlagsRemove).toHaveBeenCalledWith([1], ["\\Inbox"], { uid: true, useLabels: true });
  expect(client.messageFlagsAdd).not.toHaveBeenCalledWith(expect.anything(), ["\\Seen"], expect.anything());
});
```

- [ ] **Step 2: Run failing Gmail test**

Run:

```bash
npx vitest run tests/gmail-client.test.ts
```

Expected: FAIL because `moveInboxMessagesToSpam` does not exist.

- [ ] **Step 3: Add helper**

In `createGmailAdapter(...)` return object, add:

```ts
moveInboxMessagesToSpam: (uids: number[]) => withClient(async (connection) => {
  const deduped = [...new Set(uids.filter((uid) => Number.isInteger(uid) && uid > 0))];
  if (deduped.length === 0) return;
  const lock = await connection.getMailboxLock("INBOX");
  try {
    await connection.messageFlagsAdd(deduped, ["\\Spam"], { uid: true, useLabels: true });
    await connection.messageFlagsRemove(deduped, ["\\Inbox"], { uid: true, useLabels: true });
  } finally {
    lock.release();
  }
}),
```

- [ ] **Step 4: Verify Gmail helper**

Run:

```bash
npx vitest run tests/gmail-client.test.ts
```

Expected: PASS.

## Task 4: Filter Skipped Senders Before getmail

**Files:**
- Modify: `src/lib/mailboxes/sync.ts`
- Modify: `tests/mailbox-sync.test.ts`

- [ ] **Step 1: Extend sync dependency contract**

In `MailboxSyncDeps`, add:

```ts
loadSkippedSenders(mailboxId: string): Promise<Set<string>>;
moveInboxMessagesToSpam(input: {
  email: string;
  appPassword: string;
  uids: number[];
}): Promise<void>;
```

- [ ] **Step 2: Add failing test for filtering**

In `tests/mailbox-sync.test.ts`, add a case with two scanned messages:

```ts
it("moves skipped sender messages to Spam before getmail", async () => {
  const deps = createSyncDeps({
    loadSkippedSenders: vi.fn().mockResolvedValue(new Set(["bad@example.com"])),
    scanInbox: vi.fn().mockResolvedValue({
      uidValidity: BigInt(55),
      messages: [
        gmailMessage({ uid: BigInt(10), gmailMessageId: "bad-1", fromEmail: "bad@example.com" }),
        gmailMessage({ uid: BigInt(11), gmailMessageId: "ok-1", fromEmail: "ok@example.com" }),
      ],
    }),
    moveInboxMessagesToSpam: vi.fn().mockResolvedValue(undefined),
  });

  await syncMailbox("mailbox-1", deps);

  expect(deps.moveInboxMessagesToSpam).toHaveBeenCalledWith({
    email: "support@example.com",
    appPassword: "secret",
    uids: [10],
  });
  expect(deps.runGetmail).toHaveBeenCalledTimes(1);
  expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({
    messages: [expect.objectContaining({ gmailMessageId: "ok-1" })],
  }));
});
```

Use the existing local helpers in `tests/mailbox-sync.test.ts`; do not create a second fixture system if one already exists.

- [ ] **Step 3: Add failing test for failed Spam move**

Add:

```ts
it("does not run getmail when skipped sender spam move fails", async () => {
  const deps = createSyncDeps({
    loadSkippedSenders: vi.fn().mockResolvedValue(new Set(["bad@example.com"])),
    scanInbox: vi.fn().mockResolvedValue({
      uidValidity: BigInt(55),
      messages: [gmailMessage({ uid: BigInt(10), gmailMessageId: "bad-1", fromEmail: "bad@example.com" })],
    }),
    moveInboxMessagesToSpam: vi.fn().mockRejectedValue(new Error("gmail_spam_move_failed")),
  });

  await expect(syncMailbox("mailbox-1", deps)).rejects.toThrow("gmail_spam_move_failed");
  expect(deps.runGetmail).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Implement filter**

In `syncMailbox`, after `scan` and before `persist(...)`, add the minimal split:

```ts
const skippedSenders = await deps.loadSkippedSenders(mailbox.id);
const skippedMessages = scan.messages.filter((message) => {
  const sender = message.fromEmail?.trim().toLowerCase();
  return Boolean(sender && skippedSenders.has(sender));
});
if (skippedMessages.length > 0) {
  await deps.moveInboxMessagesToSpam({
    email: mailbox.email,
    appPassword,
    uids: skippedMessages.map((message) => Number(message.uid)),
  });
}
const allowedMessages = scan.messages.filter((message) => !skippedMessages.includes(message));
scan = { ...scan, messages: allowedMessages };
```

This keeps the cursor conservative: if the Spam move throws, execution stops
before `persist(...)` and before `runGetmail(...)`.

- [ ] **Step 5: Wire Prisma deps**

In `prismaMailboxSyncDeps`, add:

```ts
loadSkippedSenders: async (mailboxId) => {
  const rows = await prisma.mailboxSkippedSender.findMany({
    where: { mailboxId },
    select: { senderEmail: true },
  });
  return new Set(rows.map((row) => row.senderEmail));
},

moveInboxMessagesToSpam: ({ email, appPassword, uids }) =>
  createGmailAdapter({ email, appPassword }).moveInboxMessagesToSpam(uids),
```

- [ ] **Step 6: Verify sync behavior**

Run:

```bash
npx vitest run tests/mailbox-sync.test.ts
```

Expected: PASS.

## Task 5: Final Focused Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused mailbox tests**

Run:

```bash
npx vitest run \
  tests/mailbox-skipped-sender-schema-source.test.ts \
  tests/mailbox-proxy-source.test.ts \
  tests/gmail-client.test.ts \
  tests/mailbox-sync.test.ts
```

Expected: PASS.

- [ ] **Step 2: Validate Prisma schema**

Run:

```bash
npx prisma validate
```

Expected: PASS.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Optional live preflight**

Run only if disposable Gmail/RT env is available:

```bash
npm run mailbox:matrix:preflight
```

Expected: `READY`. If it reports missing env, do not claim live skip-sender verification.

## Self-Review

- Spec coverage: current-thread Spam, mailbox-scoped rule, sync-time future skip, error behavior, and focused tests are covered.
- Placeholder scan: clean.
- Type consistency: plan uses `MailboxSkippedSender`, `mailboxSkippedSender`, `moveInboxMessagesToSpam`, and existing mailbox proxy/sync naming consistently.
