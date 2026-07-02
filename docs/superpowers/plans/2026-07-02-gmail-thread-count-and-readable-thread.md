# Gmail Thread Count and Readable Thread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Gmail-like unread Inbox badges, per-thread message counts, readable Gmail thread detail, and a backfill path for existing counts.

**Architecture:** Keep `/api/mailbox-proxy/conversations` DB-backed. Add one Gmail adapter method that fetches a known thread from `[Gmail]/All Mail` with message bodies, use it only in conversation detail/backfill, and repair `MailboxConversation.articleCount` after real thread reads.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, ImapFlow, Vitest, existing mailbox proxy and Gmail App Password credentials.

---

## File Structure

- Modify: `src/lib/mailboxes/gmail-client.ts`
  - Add a minimal thread-detail fetch method on the existing Gmail adapter.
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
  - Use Gmail thread detail for Gmail-only conversations and repair stale `articleCount`.
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx`
  - Show `articleCount` on each conversation row when greater than 1.
- Create: `scripts/backfill-gmail-thread-counts.ts`
  - Backfill existing conversation counts per mailbox.
- Modify tests:
  - `tests/gmail-client.test.ts`
  - `tests/mailbox-proxy-source.test.ts`
  - `tests/mailbox-ui-source.test.ts`
  - Create `tests/mailbox-thread-count-backfill-source.test.ts`

No schema migration is needed. `MailboxConversation.articleCount` already exists.

## Task 1: Gmail Thread Detail Fetch

**Files:**
- Modify: `src/lib/mailboxes/gmail-client.ts`
- Test: `tests/gmail-client.test.ts`

- [ ] **Step 1: Add failing Gmail adapter test**

Append this test inside `describe("Gmail IMAP adapter", () => { ... })`:

```ts
it("fetches readable messages for a known Gmail thread from All Mail", async () => {
  const client = mockClient({
    fetchAll: vi.fn().mockResolvedValue([
      {
        uid: 1,
        emailId: "msg-1",
        threadId: "thread-1",
        internalDate: new Date("2026-07-02T08:09:00.000Z"),
        envelope: {
          subject: "xsxwcdsw",
          from: [{ name: "Customer", address: "customer@example.test" }],
          to: [{ name: "Support", address: "support@example.test" }],
        },
        flags: new Set<string>(["\\Seen"]),
        labels: new Set(["\\Inbox"]),
        headers: Buffer.from("Message-ID: <one@example.test>\r\n"),
        source: Buffer.from("From: Customer <customer@example.test>\r\nTo: Support <support@example.test>\r\nSubject: xsxwcdsw\r\nMessage-ID: <one@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello"),
      },
      {
        uid: 2,
        emailId: "msg-2",
        threadId: "thread-1",
        internalDate: new Date("2026-07-02T08:12:50.000Z"),
        envelope: {
          subject: "Re: xsxwcdsw",
          from: [{ name: "Support", address: "support@example.test" }],
          to: [{ name: "Customer", address: "customer@example.test" }],
        },
        flags: new Set<string>(["\\Seen"]),
        labels: new Set(["\\Sent"]),
        headers: Buffer.from("Message-ID: <two@example.test>\r\n"),
        source: Buffer.from("From: Support <support@example.test>\r\nTo: Customer <customer@example.test>\r\nSubject: Re: xsxwcdsw\r\nMessage-ID: <two@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nreply"),
      },
    ]),
  });
  const adapter = createGmailAdapter({ email: "support@example.test", appPassword: "secret" }, () => client as never);

  const result = await adapter.fetchThreadMessages("thread-1");

  expect(client.getMailboxLock).toHaveBeenCalledWith("[Gmail]/All Mail");
  expect(client.search).toHaveBeenCalledWith({ threadId: "thread-1" }, { uid: true });
  expect(client.fetchAll).toHaveBeenCalledWith([1], expect.objectContaining({ source: true, envelope: true, threadId: true }), { uid: true });
  expect(result.messages).toHaveLength(2);
  expect(result.messages[0]).toMatchObject({
    gmailMessageId: "msg-1",
    gmailThreadId: "thread-1",
    rfcMessageId: "<one@example.test>",
    subject: "xsxwcdsw",
    fromEmail: "customer@example.test",
    toEmail: "support@example.test",
    body: "hello",
    contentType: "text/plain",
  });
  expect(result.messages[1]).toMatchObject({
    gmailMessageId: "msg-2",
    body: "reply",
    contentType: "text/plain",
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm exec vitest run tests/gmail-client.test.ts`

Expected: FAIL because `fetchThreadMessages` does not exist.

- [ ] **Step 3: Implement minimal Gmail thread body parsing**

In `src/lib/mailboxes/gmail-client.ts`:

1. Add `source: true` to a new fetch query constant for detail reads.
2. Add a small parser that splits headers/body at the first blank line and reads `content-type`.
3. Add `fetchThreadMessages(gmailThreadId: string)` to the returned adapter object.

Use this shape:

```ts
const FETCH_THREAD_MESSAGE: FetchQueryObject = {
  uid: true,
  flags: true,
  labels: true,
  threadId: true,
  envelope: true,
  headers: ["message-id"],
  internalDate: true,
  source: true,
};

function parseBody(source?: Buffer): { body: string; contentType: string } {
  if (!source) return { body: "", contentType: "text/plain" };
  const raw = source.toString("utf8");
  const separator = raw.match(/\r?\n\r?\n/);
  const headerText = separator ? raw.slice(0, separator.index) : "";
  const body = separator ? raw.slice((separator.index ?? 0) + separator[0].length) : raw;
  const contentType = headerText.match(/^content-type:\s*([^;\r\n]+)/im)?.[1]?.trim().toLowerCase() || "text/plain";
  return { body, contentType };
}
```

Add this method near `lookupKnownThread`:

```ts
fetchThreadMessages: (gmailThreadId: string) => withClient(async (connection) => {
  if (!gmailThreadId) throw new Error("gmail_thread_id_required");
  const allMail = (await connection.list()).find((mailbox) => mailbox.specialUse === "\\All")?.path ?? DEFAULT_ALL_MAIL;
  const lock = await connection.getMailboxLock(allMail);
  try {
    const uids = await connection.search({ threadId: gmailThreadId }, { uid: true });
    const uidValidity = connection.mailbox && connection.mailbox.uidValidity;
    if (!uidValidity) throw new Error("gmail_uidvalidity_missing");
    if (!uids || uids.length === 0) return { uidValidity, messages: [] };
    const fetched = await connection.fetchAll(uids, FETCH_THREAD_MESSAGE, { uid: true });
    const messages = fetched.map((message) => {
      if (!message.emailId || !message.threadId) throw new Error("gmail_metadata_incomplete");
      if (message.threadId !== gmailThreadId) throw new Error("gmail_thread_mismatch");
      const sender = message.envelope?.from?.[0];
      const recipient = message.envelope?.to?.[0];
      const parsed = parseBody(message.source);
      return {
        uid: BigInt(message.uid),
        uidValidity,
        gmailMessageId: message.emailId,
        gmailThreadId: message.threadId,
        rfcMessageId: parseMessageId(message.headers),
        internalDate: new Date(message.internalDate ?? 0),
        subject: message.envelope?.subject || undefined,
        fromEmail: sender?.address || undefined,
        fromName: sender?.name || undefined,
        toEmail: recipient?.address || undefined,
        toName: recipient?.name || undefined,
        flags: [...(message.flags ?? [])],
        labels: [...(message.labels ?? [])],
        body: parsed.body,
        contentType: parsed.contentType,
      };
    });
    return { uidValidity, messages: messages.sort((a, b) => Number(a.uid - b.uid)) };
  } finally {
    lock.release();
  }
}),
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm exec vitest run tests/gmail-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `git diff -- src/lib/mailboxes/gmail-client.ts tests/gmail-client.test.ts`

Do not `git add` or commit unless the user explicitly asks.

## Task 2: Gmail-Only Detail Reads Real Messages and Repairs Count

**Files:**
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
- Test: `tests/mailbox-proxy-source.test.ts`

- [ ] **Step 1: Add failing source guard**

Append to `tests/mailbox-proxy-source.test.ts`:

```ts
it("fetches Gmail-only conversation detail from All Mail and repairs articleCount", () => {
  const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");
  const body = functionBody(source, "handleGetConversation");

  expect(body).toContain("fetchThreadMessages(conversation.gmailThreadId)");
  expect(body).toContain("messageCount !== conversation.articleCount");
  expect(body).toContain("articleCount: messageCount");
  expect(body).toContain("displayType: message.fromEmail?.toLowerCase() === mailbox.email.toLowerCase() ? \"app_reply\" as const : \"email\" as const");
  expect(body).not.toContain("body: link.rfcMessageId ? `Message-ID: ${link.rfcMessageId}`");
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm exec vitest run tests/mailbox-proxy-source.test.ts`

Expected: FAIL because detail still builds placeholder rows.

- [ ] **Step 3: Replace Gmail-only placeholder detail path**

In `handleGetConversation`, inside `if (conversation.rtTicketId == null)`, replace the `messageLinks` mapping with Gmail detail fetch:

```ts
const [threadResult, internalNotes] = await Promise.all([
  createGmailAdapter({
    email: mailbox.email,
    appPassword: await getDecryptedAppPassword(mailbox.id),
  }).fetchThreadMessages(conversation.gmailThreadId),
  prisma.mailboxInternalNote.findMany({
    where: { mailboxId: mailbox.id, conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { email: true } } },
  }),
]);
const messageCount = threadResult.messages.length;
if (messageCount > 0 && messageCount !== conversation.articleCount) {
  await prisma.mailboxConversation.update({
    where: { id: conversation.id },
    data: { articleCount: messageCount },
  });
}
const id = `gmail:${conversation.id}`;
const threads = [
  ...threadResult.messages.map((message) => ({
    id: `gmail-${message.gmailMessageId}`,
    conversationId: id,
    subject: message.subject ?? conversation.subject ?? undefined,
    body: message.body,
    contentType: message.contentType,
    from: message.fromName && message.fromEmail ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail,
    to: message.toName && message.toEmail ? `${message.toName} <${message.toEmail}>` : message.toEmail,
    cc: "",
    type: message.fromEmail?.toLowerCase() === mailbox.email.toLowerCase() ? "app_reply" : "email",
    sender: message.fromEmail,
    internal: false,
    hidden: false,
    displayType: message.fromEmail?.toLowerCase() === mailbox.email.toLowerCase() ? "app_reply" as const : "email" as const,
    attachments: [],
    createdAt: message.internalDate.toISOString(),
  })),
  ...internalNotes.map((note) => ({
    id: `note-${note.id}`,
    conversationId: id,
    subject: "Internal note",
    body: note.body,
    contentType: "text/plain",
    from: note.actor.email,
    to: mailbox.email,
    cc: "",
    type: "comment",
    sender: note.actor.email,
    internal: true,
    hidden: false,
    displayType: "internal" as const,
    attachments: [],
    createdAt: note.createdAt.toISOString(),
  })),
].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
```

Return the normalized conversation with a repaired count:

```ts
return json({
  conversation: {
    ...normalizeMailboxConversationListRow(conversation),
    articleCount: messageCount > 0 ? messageCount : conversation.articleCount,
  },
  gmailThreadId: conversation.gmailThreadId,
  threads,
});
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm exec vitest run tests/mailbox-proxy-source.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `git diff -- 'src/app/api/mailbox-proxy/[...path]/route.ts' tests/mailbox-proxy-source.test.ts`

Do not `git add` or commit unless the user explicitly asks.

## Task 3: Show Thread Count Badge in List Rows

**Files:**
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx`
- Test: `tests/mailbox-ui-source.test.ts`

- [ ] **Step 1: Add failing UI source guard**

Append to `tests/mailbox-ui-source.test.ts`:

```ts
it("shows Gmail thread message counts on conversation rows", () => {
  expect(source).toContain("const messageCount = conversation.articleCount");
  expect(source).toContain("messageCount > 1");
  expect(source).toContain("<Mail size={13} />");
  expect(source).toContain("{messageCount}");
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm exec vitest run tests/mailbox-ui-source.test.ts`

Expected: FAIL because the row does not render `articleCount` as a badge.

- [ ] **Step 3: Add compact count badge**

Inside the conversation row render where `conversation` is in scope, add:

```tsx
const messageCount = conversation.articleCount;
```

Near the subject/date metadata line, render:

```tsx
{messageCount > 1 ? (
  <span style={messageCountBadge} title={`${messageCount} messages`}>
    <Mail size={13} />
    {messageCount}
  </span>
) : null}
```

Add the style object near existing row badge styles:

```tsx
const messageCountBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  minWidth: 26,
  height: 22,
  padding: "0 7px",
  borderRadius: 8,
  background: "#eef2ff",
  color: "#3730a3",
  fontSize: 12,
  fontWeight: 700,
};
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm exec vitest run tests/mailbox-ui-source.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `git diff -- 'src/app/(authed)/mailboxes/MailboxesClient.tsx' tests/mailbox-ui-source.test.ts`

Do not `git add` or commit unless the user explicitly asks.

## Task 4: Backfill Existing Thread Counts

**Files:**
- Create: `scripts/backfill-gmail-thread-counts.ts`
- Test: `tests/mailbox-thread-count-backfill-source.test.ts`

- [ ] **Step 1: Add failing source test**

Create `tests/mailbox-thread-count-backfill-source.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("gmail thread count backfill script source", () => {
  const source = readFileSync("scripts/backfill-gmail-thread-counts.ts", "utf8");

  it("requires mailbox id and supports dry-run plus limit", () => {
    expect(source).toContain("--mailbox-id");
    expect(source).toContain("--dry-run");
    expect(source).toContain("--limit");
    expect(source).toContain("mailboxId required");
  });

  it("counts Gmail All Mail thread messages and only updates changed counts", () => {
    expect(source).toContain("fetchThreadMessages(conversation.gmailThreadId)");
    expect(source).toContain("messageCount !== conversation.articleCount");
    expect(source).toContain("articleCount: messageCount");
    expect(source).toContain("dryRun");
  });

  it("continues after per-thread failures and prints a summary", () => {
    expect(source).toContain("failed += 1");
    expect(source).toContain("continue");
    expect(source).toContain("checked=");
    expect(source).toContain("updated=");
    expect(source).toContain("unchanged=");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm exec vitest run tests/mailbox-thread-count-backfill-source.test.ts`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Create the script**

Create `scripts/backfill-gmail-thread-counts.ts`:

```ts
import { prisma } from "@/lib/db";
import { getDecryptedAppPassword } from "@/lib/mailboxes/credentials";
import { createGmailAdapter } from "@/lib/mailboxes/gmail-client";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const mailboxId = argValue("--mailbox-id");
  if (!mailboxId) throw new Error("mailboxId required: pass --mailbox-id <id>");
  const limitValue = argValue("--limit");
  const limit = limitValue ? Number.parseInt(limitValue, 10) : 100;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  const dryRun = hasFlag("--dry-run");

  const mailbox = await prisma.mailbox.findUnique({
    where: { id: mailboxId },
    select: { id: true, email: true },
  });
  if (!mailbox) throw new Error(`mailbox not found: ${mailboxId}`);

  const conversations = await prisma.mailboxConversation.findMany({
    where: { mailboxId, gmailThreadId: { not: "" } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, gmailThreadId: true, articleCount: true },
  });

  const gmail = createGmailAdapter({
    email: mailbox.email,
    appPassword: await getDecryptedAppPassword(mailbox.id),
  });

  let checked = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  for (const conversation of conversations) {
    checked += 1;
    try {
      const thread = await gmail.fetchThreadMessages(conversation.gmailThreadId);
      const messageCount = thread.messages.length;
      if (messageCount === 0) {
        skipped += 1;
        continue;
      }
      if (messageCount !== conversation.articleCount) {
        updated += 1;
        if (!dryRun) {
          await prisma.mailboxConversation.update({
            where: { id: conversation.id },
            data: { articleCount: messageCount },
          });
        }
      } else {
        unchanged += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`[backfill] failed conversationId=${conversation.id} gmailThreadId=${conversation.gmailThreadId}`, error);
      continue;
    }
  }

  console.log(`[backfill] checked=${checked} updated=${updated} unchanged=${unchanged} skipped=${skipped} failed=${failed} dryRun=${dryRun}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Run source test**

Run: `pnpm exec vitest run tests/mailbox-thread-count-backfill-source.test.ts`

Expected: PASS.

- [ ] **Step 5: Run TypeScript smoke without live Gmail**

Run: `pnpm exec tsx scripts/backfill-gmail-thread-counts.ts --dry-run`

Expected: exits non-zero with `mailboxId required: pass --mailbox-id <id>`. This proves the script loads before touching Gmail.

- [ ] **Step 6: Checkpoint**

Run: `git diff -- scripts/backfill-gmail-thread-counts.ts tests/mailbox-thread-count-backfill-source.test.ts`

Do not `git add` or commit unless the user explicitly asks.

## Task 5: Focused Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm exec vitest run tests/gmail-client.test.ts tests/mailbox-proxy-source.test.ts tests/mailbox-ui-source.test.ts tests/mailbox-thread-count-backfill-source.test.ts tests/mailbox-list-snapshot-normalizer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run static diff check**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 3: Optional live backfill dry run**

Only run when a real mailbox ID is available:

```bash
pnpm exec tsx scripts/backfill-gmail-thread-counts.ts --mailbox-id <real-mailbox-id> --limit 5 --dry-run
```

Expected: logs `checked=... updated=... unchanged=... skipped=... failed=... dryRun=true`.

- [ ] **Step 4: Handoff summary**

Report:

- Tests run and pass/fail status.
- Whether live backfill dry run was skipped or run.
- Files changed.
- Reminder that nothing was added or committed unless explicitly requested.

## Self-Review Checklist

- Spec coverage: list counts, unread badge semantics, readable detail, backfill script, count repair, no bulk body storage.
- Placeholder scan: no TBD/TODO/fill-in steps.
- Type consistency: `articleCount`, `gmailThreadId`, `fetchThreadMessages`, and `messageCount` are used consistently.
