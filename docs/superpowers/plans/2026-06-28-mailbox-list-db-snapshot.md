# Mailbox List DB Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mailbox `Prev`/`Next` pagination render from app DB snapshots so normal list navigation no longer waits on RT list/search calls.

**Architecture:** Extend `MailboxConversation` with the fields needed to render list rows, then update inbound sync and app-owned actions to keep those snapshots fresh. Replace the hot `/api/mailbox-proxy/conversations` list path with one DB query plus local labels, keep RT for conversation detail/reply/status side effects, and add a small client page cache for instant back/forward within one mailbox session.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma/Postgres, Vitest, RT REST2 client for detail/action/repair paths only.

---

## Constraints

- Do not use RT `searchTickets(...)` or `listTicketsByIds(...)` inside normal `GET /api/mailbox-proxy/conversations` list pagination.
- Keep RT calls for conversation detail, reply, status mutation, and repair/backfill.
- Preserve the current response shape consumed by `MailboxesClient`: `id`, `mailboxId`, `number`, `subject`, `status`, `updatedAt`, `createdAt`, `articleCount`, `fromName`, `fromEmail`, `labels`, `unread`, and `customerId` if already available.
- Do not add `git add` or commit steps. The repo owner handles staging and commits.

## File Map

- Modify: `prisma/schema.prisma`
  - Add list snapshot fields to `MailboxConversation`.
- Create: `prisma/migrations/20260628130000_mailbox_conversation_list_snapshot/migration.sql`
  - Add DB columns and indexes for snapshot-backed pagination.
- Create: `src/lib/mailboxes/conversation-list-snapshot.ts`
  - Normalize `MailboxConversation` DB rows into the existing mailbox list conversation shape.
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
  - Convert `handleListConversations` to DB-only list pagination and update app-owned actions to refresh snapshot fields.
- Modify: `scripts/verified-rt-mailgate.ts`
  - Persist subject/article count/update timestamp when new inbound RT tickets are linked to app conversations.
- Modify: `src/lib/mailboxes/sync.ts`
  - Preserve or improve snapshot fields when Gmail sync sees an existing thread.
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx`
  - Add session-local page cache and cache invalidation around mailbox writes.
- Create: `scripts/rebuild-mailbox-list-snapshots.ts`
  - Repair old or incomplete rows by reading RT in batches outside the hot list path.
- Create: `tests/mailbox-list-snapshot-schema-source.test.ts`
  - Source-level migration/schema guard for snapshot fields and indexes.
- Create: `tests/mailbox-list-snapshot-normalizer.test.ts`
  - Unit tests for DB row to UI row normalization.
- Create: `tests/mailbox-list-db-source.test.ts`
  - Source-level guard that list pagination no longer calls RT list/search functions.
- Create: `tests/mailbox-page-cache-source.test.ts`
  - Source-level guard for client cache keying and invalidation.
- Create: `tests/mailbox-list-snapshot-rebuild-source.test.ts`
  - Source-level guard for dry-run/write repair script behavior.
- Modify: `tests/verified-rt-mailgate-source.test.ts`
  - Update source assertions for snapshot writes in inbound mailgate.
- Modify: `tests/mailbox-sync-linkage-source.test.ts`
  - Add source assertion for sync preserving subject and list activity snapshot fields.
- Modify: `tests/mailbox-proxy-source.test.ts`
  - Add source assertions for reply/status/read/spam snapshot updates.

## Task 1: Add Snapshot Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260628130000_mailbox_conversation_list_snapshot/migration.sql`
- Create: `tests/mailbox-list-snapshot-schema-source.test.ts`

- [ ] **Step 1: Write the schema source test**

Create `tests/mailbox-list-snapshot-schema-source.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("mailbox conversation list snapshot schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260628130000_mailbox_conversation_list_snapshot/migration.sql",
    "utf8",
  );

  it("adds list snapshot fields to MailboxConversation", () => {
    expect(schema).toMatch(/subject\s+String\?\s+@map\("subject"\)/);
    expect(schema).toMatch(/articleCount\s+Int\s+@default\(0\)\s+@map\("article_count"\)/);
    expect(schema).toMatch(/rtStatus\s+String\?\s+@map\("rt_status"\)/);
    expect(schema).toMatch(/rtCreatedAt\s+DateTime\?\s+@map\("rt_created_at"\)/);
    expect(schema).toMatch(/rtLastUpdatedAt\s+DateTime\?\s+@map\("rt_last_updated_at"\)/);
  });

  it("creates snapshot columns and list indexes", () => {
    expect(migration).toContain('ADD COLUMN "subject" TEXT');
    expect(migration).toContain('ADD COLUMN "article_count" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('ADD COLUMN "rt_status" TEXT');
    expect(migration).toContain('ADD COLUMN "rt_created_at" TIMESTAMP(3)');
    expect(migration).toContain('ADD COLUMN "rt_last_updated_at" TIMESTAMP(3)');
    expect(migration).toContain('CREATE INDEX "mailbox_conversations_mailbox_id_rt_last_updated_at_idx"');
  });
});
```

- [ ] **Step 2: Run the failing schema test**

Run:

```bash
npx vitest run tests/mailbox-list-snapshot-schema-source.test.ts
```

Expected: FAIL because the migration file and schema fields do not exist yet.

- [ ] **Step 3: Update the Prisma model**

In `prisma/schema.prisma`, update `model MailboxConversation` to include:

```prisma
  subject         String?               @map("subject")
  articleCount    Int                   @default(0) @map("article_count")
  rtStatus        String?               @map("rt_status")
  rtCreatedAt     DateTime?             @map("rt_created_at")
  rtLastUpdatedAt DateTime?             @map("rt_last_updated_at")
```

Add the index near the existing mailbox conversation indexes:

```prisma
  @@index([mailboxId, rtLastUpdatedAt])
```

- [ ] **Step 4: Add the SQL migration**

Create `prisma/migrations/20260628130000_mailbox_conversation_list_snapshot/migration.sql`:

```sql
ALTER TABLE "mailbox_conversations"
  ADD COLUMN "subject" TEXT,
  ADD COLUMN "article_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rt_status" TEXT,
  ADD COLUMN "rt_created_at" TIMESTAMP(3),
  ADD COLUMN "rt_last_updated_at" TIMESTAMP(3);

CREATE INDEX "mailbox_conversations_mailbox_id_rt_last_updated_at_idx"
  ON "mailbox_conversations"("mailbox_id", "rt_last_updated_at");
```

- [ ] **Step 5: Verify schema task**

Run:

```bash
npx vitest run tests/mailbox-list-snapshot-schema-source.test.ts
npx prisma validate
```

Expected: both commands pass.

## Task 2: Add DB Row Normalizer

**Files:**
- Create: `src/lib/mailboxes/conversation-list-snapshot.ts`
- Create: `tests/mailbox-list-snapshot-normalizer.test.ts`

- [ ] **Step 1: Write the normalizer test**

Create `tests/mailbox-list-snapshot-normalizer.test.ts`:

```ts
import { normalizeMailboxConversationListRow } from "../src/lib/mailboxes/conversation-list-snapshot";

describe("normalizeMailboxConversationListRow", () => {
  it("maps a DB snapshot row to the existing mailbox list shape", () => {
    const updatedAt = new Date("2026-06-28T06:00:00.000Z");
    const createdAt = new Date("2026-06-28T04:00:00.000Z");

    const result = normalizeMailboxConversationListRow({
      id: "conv_1",
      mailboxId: "mailbox_1",
      rtTicketId: 123,
      subject: "Need help with order",
      status: "active",
      isUnread: true,
      articleCount: 4,
      senderName: "Linh",
      senderEmail: "linh@example.com",
      lastActivityAt: updatedAt,
      rtCreatedAt: createdAt,
      rtLastUpdatedAt: updatedAt,
      createdAt,
      updatedAt,
      labels: [
        {
          label: {
            id: "label_inbox",
            name: "Inbox",
            state: "ACTIVE",
          },
        },
      ],
    });

    expect(result).toEqual({
      id: 123,
      mailboxId: "mailbox_1",
      number: "123",
      subject: "Need help with order",
      status: "active",
      updatedAt: "2026-06-28T06:00:00.000Z",
      createdAt: "2026-06-28T04:00:00.000Z",
      articleCount: 4,
      fromName: "Linh",
      fromEmail: "linh@example.com",
      labels: [{ id: "label_inbox", name: "Inbox", state: "ACTIVE" }],
      unread: true,
      customerId: 123,
    });
  });

  it("uses stable fallbacks for incomplete historical rows", () => {
    const createdAt = new Date("2026-06-28T04:00:00.000Z");

    const result = normalizeMailboxConversationListRow({
      id: "conv_2",
      mailboxId: "mailbox_1",
      rtTicketId: 124,
      subject: null,
      status: "pending",
      isUnread: false,
      articleCount: 0,
      senderName: null,
      senderEmail: null,
      lastActivityAt: null,
      rtCreatedAt: null,
      rtLastUpdatedAt: null,
      createdAt,
      updatedAt: createdAt,
      labels: [],
    });

    expect(result.subject).toBe("(no subject)");
    expect(result.updatedAt).toBe("2026-06-28T04:00:00.000Z");
    expect(result.fromName).toBe("Unknown sender");
    expect(result.fromEmail).toBe("");
    expect(result.articleCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the failing normalizer test**

Run:

```bash
npx vitest run tests/mailbox-list-snapshot-normalizer.test.ts
```

Expected: FAIL because `conversation-list-snapshot.ts` does not exist.

- [ ] **Step 3: Create the normalizer**

Create `src/lib/mailboxes/conversation-list-snapshot.ts`:

```ts
export type MailboxConversationListRow = {
  id: string;
  mailboxId: string;
  rtTicketId: number;
  subject: string | null;
  status: string;
  isUnread: boolean;
  articleCount: number;
  senderName: string | null;
  senderEmail: string | null;
  lastActivityAt: Date | null;
  rtCreatedAt: Date | null;
  rtLastUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  labels: Array<{
    label: {
      id: string;
      name: string;
      state: string;
    };
  }>;
};

export function normalizeMailboxConversationListRow(row: MailboxConversationListRow) {
  const updatedAt = row.rtLastUpdatedAt ?? row.lastActivityAt ?? row.updatedAt;
  const createdAt = row.rtCreatedAt ?? row.createdAt;

  return {
    id: row.rtTicketId,
    mailboxId: row.mailboxId,
    number: String(row.rtTicketId),
    subject: row.subject?.trim() || "(no subject)",
    status: row.status,
    updatedAt: updatedAt.toISOString(),
    createdAt: createdAt.toISOString(),
    articleCount: row.articleCount,
    fromName: row.senderName?.trim() || row.senderEmail?.trim() || "Unknown sender",
    fromEmail: row.senderEmail?.trim() || "",
    labels: row.labels.map((join) => ({
      id: join.label.id,
      name: join.label.name,
      state: join.label.state,
    })),
    unread: row.isUnread,
    customerId: row.rtTicketId,
  };
}
```

- [ ] **Step 4: Verify normalizer task**

Run:

```bash
npx vitest run tests/mailbox-list-snapshot-normalizer.test.ts
```

Expected: PASS.

## Task 3: Convert List API To DB-Only Pagination

**Files:**
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
- Create: `tests/mailbox-list-db-source.test.ts`

- [ ] **Step 1: Write the source guard**

Create `tests/mailbox-list-db-source.test.ts`:

```ts
import { readFileSync } from "node:fs";

function functionBody(source: string, name: string) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("mailbox list API DB snapshot source", () => {
  const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");
  const listBody = functionBody(source, "handleListConversations");

  it("does not call RT list or search in normal pagination", () => {
    expect(listBody).not.toContain("searchTickets(");
    expect(listBody).not.toContain("listTicketsByIds(");
  });

  it("uses DB conversation count/findMany and normalizes local rows", () => {
    expect(listBody).toContain("prisma.mailboxConversation.count");
    expect(listBody).toContain("prisma.mailboxConversation.findMany");
    expect(listBody).toContain("normalizeMailboxConversationListRow");
    expect(listBody).toContain("include: { labels: { include: { label: true } } }");
  });

  it("keeps RT imports available for detail and action paths", () => {
    expect(source).toContain("getTicket(");
    expect(source).toContain("updateTicketStatus(");
  });
});
```

- [ ] **Step 2: Run the failing source guard**

Run:

```bash
npx vitest run tests/mailbox-list-db-source.test.ts
```

Expected: FAIL because `handleListConversations` still calls `searchTickets(` or `listTicketsByIds(`.

- [ ] **Step 3: Import the normalizer**

At the top of `src/app/api/mailbox-proxy/[...path]/route.ts`, add:

```ts
import { normalizeMailboxConversationListRow } from "@/lib/mailboxes/conversation-list-snapshot";
```

- [ ] **Step 4: Replace `handleListConversations` with DB pagination**

Replace the body of `handleListConversations` with this shape:

```ts
async function handleListConversations(request: NextRequest, tenantId: string) {
  const url = request.nextUrl;
  const storeId = extractStoreId(url.searchParams);
  if (storeId instanceof NextResponse) return storeId;
  const mailboxId = extractMailboxId(url.searchParams);
  if (mailboxId instanceof NextResponse) return mailboxId;

  const mailbox = await requireProvisionedMailbox(tenantId, storeId, mailboxId);
  if (!mailbox || !mailbox.rtQueueId) return errorJson("Forbidden — mailbox not found or not provisioned", 403);

  const status = url.searchParams.get("status") as AppStatus | null;
  const effectiveStatus =
    status && ["active", "pending", "closed"].includes(status) ? status : undefined;
  const labelId = url.searchParams.get("labelId");
  const selectedLabel = labelId ? mailbox.labels.find((label) => label.id === labelId) : undefined;
  if (labelId && !selectedLabel) return errorJson("Label not found", 404);

  const currentPage = pageNumber(url.searchParams.get("page"));
  const currentPageSize = pageSize(url.searchParams.get("pageSize"));
  const where = {
    mailboxId: mailbox.id,
    ...(effectiveStatus ? { status: effectiveStatus } : {}),
    ...(selectedLabel
      ? {
          labels: {
            some: {
              labelId: selectedLabel.id,
            },
          },
        }
      : {}),
  };

  const [totalElements, conversationRows] = await Promise.all([
    prisma.mailboxConversation.count({ where }),
    prisma.mailboxConversation.findMany({
      where,
      include: { labels: { include: { label: true } } },
      orderBy: [
        { lastActivityAt: "desc" },
        { rtLastUpdatedAt: "desc" },
        { updatedAt: "desc" },
      ],
      skip: (currentPage - 1) * currentPageSize,
      take: currentPageSize,
    }),
  ]);

  return json({
    conversations: conversationRows.map(normalizeMailboxConversationListRow),
    page: {
      size: currentPageSize,
      number: currentPage,
      totalElements,
      totalPages: Math.max(1, Math.ceil(totalElements / currentPageSize)),
    },
  });
}
```

- [ ] **Step 5: Remove dead list-only hydration**

If `loadConversationSenderSnapshots` is only used by old list hydration after Step 4, remove that helper. Keep it if another path still references it.

- [ ] **Step 6: Verify list API source task**

Run:

```bash
npx vitest run tests/mailbox-list-db-source.test.ts tests/mailbox-list-snapshot-normalizer.test.ts
```

Expected: PASS.

## Task 4: Persist Snapshots From Inbound Mail And Sync

**Files:**
- Modify: `scripts/verified-rt-mailgate.ts`
- Modify: `src/lib/mailboxes/sync.ts`
- Modify: `tests/verified-rt-mailgate-source.test.ts`
- Modify: `tests/mailbox-sync-linkage-source.test.ts`

- [ ] **Step 1: Extend source tests for inbound snapshot writes**

In `tests/verified-rt-mailgate-source.test.ts`, add assertions that the mailgate upsert writes:

```ts
expect(source).toContain("subject:");
expect(source).toContain("articleCount:");
expect(source).toContain("rtLastUpdatedAt:");
expect(source).toContain("lastActivityAt:");
```

- [ ] **Step 2: Extend source tests for sync snapshot preservation**

In `tests/mailbox-sync-linkage-source.test.ts`, add:

```ts
it("preserves list snapshot fields while syncing Gmail metadata", () => {
  const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");
  expect(source).toContain("subject:");
  expect(source).toContain("articleCount");
  expect(source).toContain("lastActivityAt");
});
```

- [ ] **Step 3: Run the failing source tests**

Run:

```bash
npx vitest run tests/verified-rt-mailgate-source.test.ts tests/mailbox-sync-linkage-source.test.ts
```

Expected: FAIL until both inbound paths write snapshot fields.

- [ ] **Step 4: Update mailgate conversation upserts**

In `scripts/verified-rt-mailgate.ts`, wherever `prisma.mailboxConversation.upsert` or `update` links the RT ticket to the Gmail thread, include:

```ts
subject: parsedMessage.subject?.trim() || ticket.Subject || null,
articleCount: Math.max(existingArticleCount ?? 0, 1),
rtStatus: ticket.Status ?? null,
rtCreatedAt: ticket.Created ? new Date(ticket.Created) : null,
rtLastUpdatedAt: ticket.LastUpdated ? new Date(ticket.LastUpdated) : internalDate,
lastActivityAt: internalDate,
```

Use the actual variable names already present in `scripts/verified-rt-mailgate.ts`; the required behavior is:

- Prefer MIME/Gmail subject when available.
- Fall back to RT ticket subject.
- Keep `articleCount` at least `1`.
- Use Gmail internal date for `lastActivityAt`.
- Use RT timestamps when the mailgate has them, otherwise use Gmail internal date for the updated snapshot.

- [ ] **Step 5: Update sync conversation writes**

In `src/lib/mailboxes/sync.ts`, when an existing conversation is touched from Gmail metadata, include:

```ts
subject: message.subject?.trim() || conversation.subject,
articleCount: conversation.articleCount > 0 ? conversation.articleCount : 1,
lastActivityAt: message.internalDate,
rtLastUpdatedAt: conversation.rtLastUpdatedAt ?? message.internalDate,
```

The update must not overwrite a known subject with an empty string.

- [ ] **Step 6: Verify inbound snapshot task**

Run:

```bash
npx vitest run tests/verified-rt-mailgate-source.test.ts tests/mailbox-sync-linkage-source.test.ts
```

Expected: PASS.

## Task 5: Refresh Snapshots On App-Owned Actions

**Files:**
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
- Modify: `tests/mailbox-proxy-source.test.ts`

- [ ] **Step 1: Add source guards for action snapshot updates**

In `tests/mailbox-proxy-source.test.ts`, add:

```ts
function functionBody(source: string, name: string) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

it("updates list snapshots when app-owned actions change a conversation", () => {
  const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");
  expect(functionBody(source, "handleReply")).toContain("articleCount");
  expect(functionBody(source, "handleReply")).toContain("rtLastUpdatedAt");
  expect(functionBody(source, "handleUpdateConversationStatus")).toContain("rtStatus");
  expect(functionBody(source, "handleMarkConversationRead")).toContain("isUnread: false");
  expect(functionBody(source, "handleMarkConversationUnread")).toContain("isUnread: true");
  expect(functionBody(source, "handleReportConversationSpam")).toContain("isUnread: false");
});
```

- [ ] **Step 2: Run the failing proxy source test**

Run:

```bash
npx vitest run tests/mailbox-proxy-source.test.ts
```

Expected: FAIL until all action paths update the snapshot.

- [ ] **Step 3: Update reply success path**

In `handleReply`, after Gmail reply and RT comment succeed, update the conversation:

```ts
await prisma.mailboxConversation.update({
  where: { id: conversation.id },
  data: {
    articleCount: { increment: 1 },
    rtLastUpdatedAt: new Date(),
    lastActivityAt: new Date(),
  },
});
```

Use one `const repliedAt = new Date()` so both timestamps match.

- [ ] **Step 4: Update status path**

In `handleUpdateConversationStatus`, extend the existing local update:

```ts
data: {
  status: parsed.data.status,
  rtStatus: parsed.data.status,
  rtLastUpdatedAt: new Date(),
}
```

If RT uses a different status vocabulary than app status in the existing code, map to the RT value returned by `updateTicketStatus`.

- [ ] **Step 5: Confirm read/unread/spam local snapshot writes**

Ensure these handlers keep writing:

```ts
isUnread: false
```

for read and spam, and:

```ts
isUnread: true
```

for unread.

- [ ] **Step 6: Verify action snapshot task**

Run:

```bash
npx vitest run tests/mailbox-proxy-source.test.ts
```

Expected: PASS.

## Task 6: Add Client Page Cache

**Files:**
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx`
- Create: `tests/mailbox-page-cache-source.test.ts`

- [ ] **Step 1: Write the client cache source test**

Create `tests/mailbox-page-cache-source.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("mailbox page cache source", () => {
  const source = readFileSync("src/app/(authed)/mailboxes/MailboxesClient.tsx", "utf8");

  it("keys cached pages by store, mailbox, label, page, and page size", () => {
    expect(source).toContain("conversationPageCacheRef");
    expect(source).toContain("conversationPageCacheKey");
    expect(source).toContain("selectedStoreId");
    expect(source).toContain("selectedMailbox.id");
    expect(source).toContain("effectiveSelectedLabelId");
    expect(source).toContain("currentPage");
    expect(source).toContain("pageSize");
  });

  it("renders cached pages before fetching and refreshes cache after fetch", () => {
    expect(source).toContain("conversationPageCacheRef.current.get(cacheKey)");
    expect(source).toContain("setConversations(cached.conversations)");
    expect(source).toContain("conversationPageCacheRef.current.set(cacheKey");
  });

  it("clears cache after mailbox writes and filter changes", () => {
    expect(source).toContain("clearConversationPageCache");
    expect(source).toContain("clearConversationPageCache();");
  });
});
```

- [ ] **Step 2: Run the failing client cache source test**

Run:

```bash
npx vitest run tests/mailbox-page-cache-source.test.ts
```

Expected: FAIL because the cache ref/helper does not exist.

- [ ] **Step 3: Add cache helpers**

In `MailboxesClient.tsx`, near state declarations, add:

```tsx
const conversationPageCacheRef = useRef(
  new Map<string, { conversations: Conversation[]; page: PageInfo }>(),
);

const conversationPageCacheKey = useCallback(
  (page: number, pageSize: number) =>
    [
      selectedStoreId ?? "",
      selectedMailbox?.id ?? "",
      effectiveSelectedLabelId ?? "",
      page,
      pageSize,
    ].join(":"),
  [selectedStoreId, selectedMailbox?.id, effectiveSelectedLabelId],
);

const clearConversationPageCache = useCallback(() => {
  conversationPageCacheRef.current.clear();
}, []);
```

- [ ] **Step 4: Render cached pages before fetch**

At the start of `loadConversations`, after readiness checks and before `setConvLoading(true)`, add:

```tsx
const pageSize = 25;
const cacheKey = conversationPageCacheKey(currentPage, pageSize);
const cached = conversationPageCacheRef.current.get(cacheKey);
if (cached) {
  setConversations(cached.conversations);
  setPageInfo(cached.page);
}
```

Use `pageSize` when building query params:

```tsx
pageSize: String(pageSize),
```

- [ ] **Step 5: Refresh cache after fetch**

After `apiFetch` returns `data`, before `setConversations(data.conversations)`, add:

```tsx
conversationPageCacheRef.current.set(cacheKey, data);
```

- [ ] **Step 6: Clear cache on filter/context changes**

Add an effect:

```tsx
useEffect(() => {
  clearConversationPageCache();
}, [selectedStoreId, selectedMailbox?.id, effectiveSelectedLabelId, clearConversationPageCache]);
```

- [ ] **Step 7: Clear cache on writes**

Call `clearConversationPageCache();` before or after each successful mailbox write that changes list rows:

- reply send
- status update
- mark read
- mark unread
- report spam
- replace labels
- label create/rename/delete

- [ ] **Step 8: Verify client cache task**

Run:

```bash
npx vitest run tests/mailbox-page-cache-source.test.ts
```

Expected: PASS.

## Task 7: Add Historical Snapshot Repair Script

**Files:**
- Create: `scripts/rebuild-mailbox-list-snapshots.ts`
- Create: `tests/mailbox-list-snapshot-rebuild-source.test.ts`

- [ ] **Step 1: Write the repair script source test**

Create `tests/mailbox-list-snapshot-rebuild-source.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("mailbox list snapshot rebuild script", () => {
  const source = readFileSync("scripts/rebuild-mailbox-list-snapshots.ts", "utf8");

  it("defaults to dry-run and requires --write to mutate rows", () => {
    expect(source).toContain('process.argv.includes("--write")');
    expect(source).toContain("DRY_RUN");
    expect(source).toContain("prisma.mailboxConversation.update");
  });

  it("uses RT only for repair outside the list API hot path", () => {
    expect(source).toContain("getTicket(");
    expect(source).toContain("articleCount");
    expect(source).toContain("rtLastUpdatedAt");
  });
});
```

- [ ] **Step 2: Run the failing repair script test**

Run:

```bash
npx vitest run tests/mailbox-list-snapshot-rebuild-source.test.ts
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Create the repair script**

Create `scripts/rebuild-mailbox-list-snapshots.ts` with this behavior:

```ts
import { prisma } from "../src/lib/prisma";
import { getTicket } from "../src/lib/rt/client";

const DRY_RUN = !process.argv.includes("--write");
const mailboxIdArg = process.argv.find((arg) => arg.startsWith("--mailboxId="));
const mailboxId = mailboxIdArg?.slice("--mailboxId=".length);

async function main() {
  const conversations = await prisma.mailboxConversation.findMany({
    where: {
      ...(mailboxId ? { mailboxId } : {}),
      OR: [
        { subject: null },
        { rtStatus: null },
        { rtCreatedAt: null },
        { rtLastUpdatedAt: null },
      ],
    },
    include: { mailbox: true },
    take: 500,
  });

  let updated = 0;
  for (const conversation of conversations) {
    if (!conversation.mailbox.rtQueueId) continue;
    const ticket = await getTicket({
      queueId: conversation.mailbox.rtQueueId,
      ticketId: conversation.rtTicketId,
    });
    if (!ticket.ok || !ticket.data) continue;

    const patch = {
      subject: ticket.data.Subject || conversation.subject,
      rtStatus: ticket.data.Status || conversation.rtStatus,
      rtCreatedAt: ticket.data.Created ? new Date(ticket.data.Created) : conversation.rtCreatedAt,
      rtLastUpdatedAt: ticket.data.LastUpdated ? new Date(ticket.data.LastUpdated) : conversation.rtLastUpdatedAt,
      articleCount: Math.max(conversation.articleCount, ticket.data.TransactionCount ?? 0),
    };

    if (DRY_RUN) {
      console.log(JSON.stringify({ mode: "DRY_RUN", conversationId: conversation.id, patch }));
      continue;
    }

    await prisma.mailboxConversation.update({
      where: { id: conversation.id },
      data: patch,
    });
    updated += 1;
  }

  console.log(JSON.stringify({ mode: DRY_RUN ? "DRY_RUN" : "WRITE", scanned: conversations.length, updated }));
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

If the current RT `getTicket` return type uses lowercase field names, map those exact names while preserving the same output fields.

- [ ] **Step 4: Verify repair script task**

Run:

```bash
npx vitest run tests/mailbox-list-snapshot-rebuild-source.test.ts
npx tsx scripts/rebuild-mailbox-list-snapshots.ts
```

Expected:

- Test passes.
- Script prints JSON `DRY_RUN` rows or a summary without mutating DB.

## Task 8: End-To-End Verification

**Files:**
- All files changed in Tasks 1-7.

- [ ] **Step 1: Run focused mailbox tests**

Run:

```bash
npx vitest run \
  tests/mailbox-list-snapshot-schema-source.test.ts \
  tests/mailbox-list-snapshot-normalizer.test.ts \
  tests/mailbox-list-db-source.test.ts \
  tests/mailbox-page-cache-source.test.ts \
  tests/mailbox-list-snapshot-rebuild-source.test.ts \
  tests/verified-rt-mailgate-source.test.ts \
  tests/mailbox-sync-linkage-source.test.ts \
  tests/mailbox-proxy-source.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Validate Prisma**

Run:

```bash
npx prisma validate
npx prisma generate
```

Expected: both commands pass.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: build exits successfully.

- [ ] **Step 4: Whitespace check excluding dirty PM2 logs**

Run:

```bash
git diff --check -- . ':(exclude)logs/pm2/*'
```

Expected: no whitespace errors.

- [ ] **Step 5: Manual local verification**

Start the app with the project’s existing dev command, open `/mailboxes`, and verify:

- Page 1 loads.
- Clicking `Next` shows page 2.
- Clicking `Prev` returns to page 1 immediately if it was cached in the current session.
- Server logs for `GET /api/mailbox-proxy/conversations` do not show RT list/search calls.
- Opening one conversation still loads detail normally.
- Sending a reply, changing status, marking read/unread, reporting spam, and changing labels clear stale cached pages and then reload accurate list rows.

## Self-Review Notes

- Spec coverage: DB-backed list source is covered by Tasks 1-3; inbound/action freshness by Tasks 4-5; client fast back/forward by Task 6; historical data repair by Task 7; verification by Task 8.
- RT boundary: The plan removes RT from normal list pagination and keeps RT in detail/action/repair paths.
- Commit policy: This plan intentionally contains no staging or commit steps.
