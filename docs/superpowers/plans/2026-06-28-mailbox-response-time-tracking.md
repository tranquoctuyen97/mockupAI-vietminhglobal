# Mailbox Response Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track conversation-level mailbox response duration from the first customer email to the latest successful app-sent admin reply, attribute it to the latest replying admin/operator, then expose overdue and monthly summary views.

**Architecture:** Add durable response metric state keyed one-to-one to `MailboxConversation`. A small mailbox response-metrics service owns timestamp and duration math, inbound sync and verified mailgate create the metric from customer messages, the app reply route updates it after Gmail Sent read-back, report helpers aggregate it, and the mailbox UI surfaces overdue and monthly summary data.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, Vitest, RT + getmail6 Gmail mailbox stack, Gmail SMTP reply read-back, existing `/api/mailbox-proxy/[...path]` route.

**Approved spec:** `docs/superpowers/specs/2026-06-28-mailbox-response-time-tracking-design.md`

**Commit policy:** Do not run `git add` or `git commit`. The repository owner stages and commits manually. Each task ends with a verification checkpoint instead of a commit step.

---

## File Map

- Modify: `prisma/schema.prisma` — add `MailboxResponseMetric`, inverse `MailboxConversation.responseMetric`, `GmailMessageLink.gmailInternalDate`, and latest reply actor relation.
- Create: `prisma/migrations/20260628120000_mailbox_response_metrics/migration.sql` — add the metric table, relation indexes, and message internal-date column.
- Create: `tests/mailbox-response-schema-source.test.ts` — source contract for schema and migration.
- Create: `src/lib/mailboxes/response-metrics.ts` — service for metric creation, admin reply updates, reports, overdue lists, and rebuild.
- Create: `tests/mailbox-response-metrics.test.ts` — pure unit coverage with injected dependencies.
- Modify: `src/lib/mailboxes/sync.ts` — persist Gmail internal dates and record metrics for inbound customer messages linked to conversations.
- Modify: `tests/mailbox-sync.test.ts` — verify sync calls the metric hook and preserves start timestamps through the service.
- Modify: `scripts/verified-rt-mailgate.ts` — record metrics when mailgate creates or resolves a conversation for an already-indexed inbound message.
- Create: `tests/verified-rt-mailgate-response-metrics.test.ts` — verify mailgate persistence records the inbound start.
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts` — record latest admin reply after outbound Gmail link persistence; add summary and overdue proxy routes.
- Create: `tests/mailbox-response-proxy-source.test.ts` — source contract for route hook and report endpoints.
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx` — load and display overdue count/list and monthly summary in the existing mailbox workspace.
- Create: `src/app/(authed)/mailboxes/mailbox-response-ui-source.test.ts` — source contract for UI calls and display labels.
- Create: `scripts/rebuild-mailbox-response-metrics.ts` — dry-run/write rebuild for existing conversations from message links.
- Create: `tests/mailbox-response-rebuild-source.test.ts` — source contract for safe rebuild behavior.

## Execution Rules

- Preserve unrelated dirty worktree changes, especially current mailbox worker/queue edits.
- Use top-level static imports only.
- Do not add Zammad compatibility.
- Do not trust client-supplied timestamps.
- Do not print Gmail App Passwords, RT tokens, email bodies, or SMTP auth details.
- Use focused tests before broad build checks.

---

### Task 1: Add Schema And Migration Contracts

**Files:**
- Create: `tests/mailbox-response-schema-source.test.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260628120000_mailbox_response_metrics/migration.sql`

- [ ] **Step 1: Write the failing schema source test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox response metric schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260628120000_mailbox_response_metrics/migration.sql",
    "utf8",
  );

  it("adds a durable response metric model and internal Gmail dates", () => {
    expect(schema).toMatch(/model MailboxResponseMetric/);
    expect(schema).toMatch(/responseStartedAt\s+DateTime\s+@map\("response_started_at"\)/);
    expect(schema).toMatch(/latestAdminReplyAt\s+DateTime\?\s+@map\("latest_admin_reply_at"\)/);
    expect(schema).toMatch(/responseDurationMs\s+BigInt\?\s+@map\("response_duration_ms"\)/);
    expect(schema).toMatch(/latestAdminReplyActorUserId\s+String\?\s+@map\("latest_admin_reply_actor_user_id"\)/);
    expect(schema).toMatch(/latestAdminReplyActor\s+User\?\s+@relation/);
    expect(schema).toMatch(/responseMetric\s+MailboxResponseMetric\?/);
    expect(schema).toMatch(/gmailInternalDate\s+DateTime\?\s+@map\("gmail_internal_date"\)/);
  });

  it("creates the table and reporting indexes", () => {
    expect(migration).toContain("CREATE TABLE \"mailbox_response_metrics\"");
    expect(migration).toContain("\"response_started_at\" TIMESTAMP(3) NOT NULL");
    expect(migration).toContain("\"latest_admin_reply_at\" TIMESTAMP(3)");
    expect(migration).toContain("\"latest_admin_reply_actor_user_id\" TEXT");
    expect(migration).toContain("\"response_duration_ms\" BIGINT");
    expect(migration).toContain("CREATE INDEX \"mailbox_response_metrics_tenant_id_store_id_response_started_at_idx\"");
    expect(migration).toContain("CREATE INDEX \"mailbox_response_metrics_mailbox_id_response_started_at_idx\"");
    expect(migration).toContain("ALTER TABLE \"gmail_message_links\" ADD COLUMN \"gmail_internal_date\" TIMESTAMP(3)");
  });
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
npx vitest run tests/mailbox-response-schema-source.test.ts
```

Expected: FAIL because the test file is new and the schema/migration are not added yet.

- [ ] **Step 3: Add the Prisma schema fields**

In `model MailboxConversation`, add:

```prisma
  responseMetric MailboxResponseMetric?
```

In `model User`, add:

```prisma
mailboxResponseMetrics MailboxResponseMetric[] @relation("MailboxResponseLatestReplyActor")
```

In `model GmailMessageLink`, add:

```prisma
  gmailInternalDate DateTime? @map("gmail_internal_date")
```

After `model GmailLabelOperation`, add:

```prisma
model MailboxResponseMetric {
  conversationId     String   @id @map("conversation_id")
  mailboxId          String   @map("mailbox_id")
  tenantId           String   @map("tenant_id")
  storeId            String   @map("store_id")
  responseStartedAt  DateTime @map("response_started_at")
  latestAdminReplyAt DateTime? @map("latest_admin_reply_at")
  latestAdminReplyActorUserId String? @map("latest_admin_reply_actor_user_id")
  responseDurationMs BigInt?  @map("response_duration_ms")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  conversation MailboxConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  mailbox      Mailbox             @relation(fields: [mailboxId], references: [id], onDelete: Cascade)
  tenant       Tenant              @relation(fields: [tenantId], references: [id])
  store        Store               @relation(fields: [storeId], references: [id], onDelete: Cascade)
  latestAdminReplyActor User?      @relation("MailboxResponseLatestReplyActor", fields: [latestAdminReplyActorUserId], references: [id], onDelete: SetNull)

  @@index([tenantId, storeId, responseStartedAt])
  @@index([mailboxId, responseStartedAt])
  @@index([latestAdminReplyAt])
  @@index([latestAdminReplyActorUserId, responseStartedAt])
  @@map("mailbox_response_metrics")
}
```

- [ ] **Step 4: Add the SQL migration**

Create `prisma/migrations/20260628120000_mailbox_response_metrics/migration.sql`:

```sql
ALTER TABLE "gmail_message_links"
  ADD COLUMN "gmail_internal_date" TIMESTAMP(3);

CREATE TABLE "mailbox_response_metrics" (
  "conversation_id" TEXT NOT NULL,
  "mailbox_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "response_started_at" TIMESTAMP(3) NOT NULL,
  "latest_admin_reply_at" TIMESTAMP(3),
  "latest_admin_reply_actor_user_id" TEXT,
  "response_duration_ms" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mailbox_response_metrics_pkey" PRIMARY KEY ("conversation_id")
);

CREATE INDEX "mailbox_response_metrics_tenant_id_store_id_response_started_at_idx"
  ON "mailbox_response_metrics"("tenant_id", "store_id", "response_started_at");

CREATE INDEX "mailbox_response_metrics_mailbox_id_response_started_at_idx"
  ON "mailbox_response_metrics"("mailbox_id", "response_started_at");

CREATE INDEX "mailbox_response_metrics_latest_admin_reply_at_idx"
  ON "mailbox_response_metrics"("latest_admin_reply_at");

CREATE INDEX "mailbox_response_metrics_latest_admin_reply_actor_user_id_response_started_at_idx"
  ON "mailbox_response_metrics"("latest_admin_reply_actor_user_id", "response_started_at");

ALTER TABLE "mailbox_response_metrics"
  ADD CONSTRAINT "mailbox_response_metrics_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "mailbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_response_metrics"
  ADD CONSTRAINT "mailbox_response_metrics_mailbox_id_fkey"
  FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_response_metrics"
  ADD CONSTRAINT "mailbox_response_metrics_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mailbox_response_metrics"
  ADD CONSTRAINT "mailbox_response_metrics_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mailbox_response_metrics"
  ADD CONSTRAINT "mailbox_response_metrics_latest_admin_reply_actor_user_id_fkey"
  FOREIGN KEY ("latest_admin_reply_actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Verify schema contract and Prisma validation**

Run:

```bash
npx vitest run tests/mailbox-response-schema-source.test.ts
npx prisma validate
```

Expected: both PASS. If `npx prisma validate` hits the known Prisma dev patch issue, run `pnpm prisma validate` and record the exact command used.

---

### Task 2: Build The Response Metrics Service

**Files:**
- Create: `src/lib/mailboxes/response-metrics.ts`
- Create: `tests/mailbox-response-metrics.test.ts`

- [ ] **Step 1: Write service unit tests with injected repository functions**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildMonthlyResponseSummary,
  classifyResponseMetric,
  createResponseMetricService,
  durationMsBetween,
} from "../src/lib/mailboxes/response-metrics";

describe("mailbox response metrics", () => {
  it("creates the metric once and never resets the customer start", async () => {
    const createIfMissing = vi.fn().mockResolvedValue({ created: true });
    const service = createResponseMetricService({
      createIfMissing,
      findByConversationId: vi.fn(),
      updateAdminReply: vi.fn(),
      listForSummary: vi.fn(),
      listOverdue: vi.fn(),
      rebuild: vi.fn(),
    });

    await service.recordCustomerMessage({
      tenantId: "tenant-1",
      storeId: "store-1",
      mailboxId: "mailbox-1",
      conversationId: "conversation-1",
      messageAt: new Date("2026-06-01T10:00:00Z"),
    });
    await service.recordCustomerMessage({
      tenantId: "tenant-1",
      storeId: "store-1",
      mailboxId: "mailbox-1",
      conversationId: "conversation-1",
      messageAt: new Date("2026-06-01T12:00:00Z"),
    });

    expect(createIfMissing).toHaveBeenCalledTimes(2);
    expect(createIfMissing).toHaveBeenNthCalledWith(1, expect.objectContaining({
      conversationId: "conversation-1",
      responseStartedAt: new Date("2026-06-01T10:00:00Z"),
    }));
    expect(createIfMissing).toHaveBeenNthCalledWith(2, expect.objectContaining({
      conversationId: "conversation-1",
      responseStartedAt: new Date("2026-06-01T12:00:00Z"),
    }));
  });

  it("updates latest admin reply and computes the 10h to 13h example as 3 hours", async () => {
    const updateAdminReply = vi.fn().mockResolvedValue(undefined);
    const service = createResponseMetricService({
      createIfMissing: vi.fn(),
      findByConversationId: vi.fn().mockResolvedValue({
        conversationId: "conversation-1",
        responseStartedAt: new Date("2026-06-01T10:00:00Z"),
      }),
      updateAdminReply,
      listForSummary: vi.fn(),
      listOverdue: vi.fn(),
      rebuild: vi.fn(),
    });

    await service.recordAdminReply({
      conversationId: "conversation-1",
      actorUserId: "user-13h",
      repliedAt: new Date("2026-06-01T13:00:00Z"),
    });

    expect(updateAdminReply).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      latestAdminReplyAt: new Date("2026-06-01T13:00:00Z"),
      latestAdminReplyActorUserId: "user-13h",
      responseDurationMs: BigInt(10_800_000),
    });
  });

  it("rejects negative response durations", () => {
    expect(() => durationMsBetween(
      new Date("2026-06-01T13:00:00Z"),
      new Date("2026-06-01T10:00:00Z"),
    )).toThrow("negative_response_duration");
  });

  it("classifies overdue completed and pending conversations at 24 hours", () => {
    const now = new Date("2026-06-02T11:00:00Z");
    expect(classifyResponseMetric({
      responseStartedAt: new Date("2026-06-01T10:00:00Z"),
      latestAdminReplyAt: null,
      responseDurationMs: null,
    }, now).overdue).toBe(true);
    expect(classifyResponseMetric({
      responseStartedAt: new Date("2026-06-01T10:00:00Z"),
      latestAdminReplyAt: new Date("2026-06-01T13:00:00Z"),
      responseDurationMs: BigInt(10_800_000),
    }, now).overdue).toBe(false);
  });

  it("builds monthly summary by responseStartedAt month", () => {
    const summary = buildMonthlyResponseSummary([
      {
        responseStartedAt: new Date("2026-05-31T23:30:00Z"),
        latestAdminReplyAt: new Date("2026-06-01T01:00:00Z"),
        responseDurationMs: BigInt(5_400_000),
      },
      {
        responseStartedAt: new Date("2026-06-02T10:00:00Z"),
        latestAdminReplyAt: null,
        responseDurationMs: null,
      },
    ], new Date("2026-06-03T10:00:00Z"));

    expect(summary).toEqual([
      expect.objectContaining({ reportMonth: "2026-05", totalConversations: 1, repliedConversations: 1 }),
      expect.objectContaining({ reportMonth: "2026-06", totalConversations: 1, unrepliedConversations: 1 }),
    ]);
  });
});
```

- [ ] **Step 2: Run the unit tests and verify they fail**

Run:

```bash
npx vitest run tests/mailbox-response-metrics.test.ts
```

Expected: FAIL because `src/lib/mailboxes/response-metrics.ts` does not exist.

- [ ] **Step 3: Implement pure helpers and the injected service factory**

```ts
import { prisma } from "@/lib/db";

const RESPONSE_OVERDUE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface ResponseMetricShape {
  responseStartedAt: Date;
  latestAdminReplyAt: Date | null;
  latestAdminReplyActorUserId?: string | null;
  responseDurationMs: bigint | null;
}

export interface ResponseMetricRepository {
  createIfMissing(input: {
    tenantId: string;
    storeId: string;
    mailboxId: string;
    conversationId: string;
    responseStartedAt: Date;
  }): Promise<{ created: boolean }>;
  findByConversationId(conversationId: string): Promise<({ conversationId: string; responseStartedAt: Date }) | null>;
  updateAdminReply(input: {
    conversationId: string;
    latestAdminReplyAt: Date;
    latestAdminReplyActorUserId: string;
    responseDurationMs: bigint;
  }): Promise<void>;
  listForSummary(input: { tenantId: string; storeId?: string; mailboxId?: string; from: Date; to: Date }): Promise<ResponseMetricShape[]>;
  listOverdue(input: { tenantId: string; storeId?: string; mailboxId?: string; now: Date; thresholdMs: number }): Promise<ResponseMetricShape[]>;
  rebuild(input: { tenantId?: string; mailboxId?: string; dryRun: boolean }): Promise<{ examined: number; written: number; skipped: number }>;
}

export function durationMsBetween(start: Date, end: Date): bigint {
  const duration = end.getTime() - start.getTime();
  if (duration < 0) throw new Error("negative_response_duration");
  return BigInt(duration);
}

export function classifyResponseMetric(metric: ResponseMetricShape, now = new Date()) {
  const ageMs = metric.responseDurationMs ?? durationMsBetween(metric.responseStartedAt, now);
  return {
    ageMs,
    overdue: ageMs > BigInt(RESPONSE_OVERDUE_THRESHOLD_MS),
    replied: metric.latestAdminReplyAt !== null,
  };
}

export function buildMonthlyResponseSummary(metrics: ResponseMetricShape[], now = new Date()) {
  const grouped = new Map<string, ResponseMetricShape[]>();
  for (const metric of metrics) {
    const month = metric.responseStartedAt.toISOString().slice(0, 7);
    grouped.set(month, [...(grouped.get(month) ?? []), metric]);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([reportMonth, rows]) => {
    const replied = rows.filter((row) => row.latestAdminReplyAt !== null);
    const completedDurations = replied.map((row) => Number(row.responseDurationMs ?? 0n));
    return {
      reportMonth,
      totalConversations: rows.length,
      repliedConversations: replied.length,
      unrepliedConversations: rows.length - replied.length,
      overdueConversations: rows.filter((row) => classifyResponseMetric(row, now).overdue).length,
      averageResponseDurationMs: completedDurations.length
        ? Math.round(completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length)
        : null,
      maxResponseDurationMs: completedDurations.length ? Math.max(...completedDurations) : null,
      oldestPendingAgeMs: rows
        .filter((row) => row.latestAdminReplyAt === null)
        .map((row) => Number(durationMsBetween(row.responseStartedAt, now)))
        .sort((left, right) => right - left)[0] ?? null,
    };
  });
}

export function createResponseMetricService(repository: ResponseMetricRepository) {
  return {
    recordCustomerMessage(input: {
      tenantId: string;
      storeId: string;
      mailboxId: string;
      conversationId: string;
      messageAt: Date;
    }) {
      return repository.createIfMissing({
        tenantId: input.tenantId,
        storeId: input.storeId,
        mailboxId: input.mailboxId,
        conversationId: input.conversationId,
        responseStartedAt: input.messageAt,
      });
    },
    async recordAdminReply(input: { conversationId: string; actorUserId: string; repliedAt: Date }) {
      const metric = await repository.findByConversationId(input.conversationId);
      if (!metric) throw new Error("response_metric_missing");
      await repository.updateAdminReply({
        conversationId: input.conversationId,
        latestAdminReplyAt: input.repliedAt,
        latestAdminReplyActorUserId: input.actorUserId,
        responseDurationMs: durationMsBetween(metric.responseStartedAt, input.repliedAt),
      });
    },
    listForSummary: repository.listForSummary,
    listOverdue: repository.listOverdue,
    rebuild: repository.rebuild,
  };
}
```

- [ ] **Step 4: Add the Prisma repository export**

In the same file, export `mailboxResponseMetrics` using `createResponseMetricService(...)`. The repository must use `upsert` for `createIfMissing`, `findUnique` for `findByConversationId`, and `update` for admin replies:

```ts
export const mailboxResponseMetrics = createResponseMetricService({
  async createIfMissing(input) {
    await prisma.mailboxResponseMetric.upsert({
      where: { conversationId: input.conversationId },
      create: input,
      update: {},
    });
    return { created: true };
  },
  async findByConversationId(conversationId) {
    return prisma.mailboxResponseMetric.findUnique({
      where: { conversationId },
      select: { conversationId: true, responseStartedAt: true },
    });
  },
  async updateAdminReply(input) {
    await prisma.mailboxResponseMetric.update({
      where: { conversationId: input.conversationId },
      data: {
        latestAdminReplyAt: input.latestAdminReplyAt,
        latestAdminReplyActorUserId: input.latestAdminReplyActorUserId,
        responseDurationMs: input.responseDurationMs,
      },
    });
  },
  async listForSummary(input) {
    return prisma.mailboxResponseMetric.findMany({
      where: {
        tenantId: input.tenantId,
        ...(input.storeId ? { storeId: input.storeId } : {}),
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        responseStartedAt: { gte: input.from, lt: input.to },
      },
      select: { responseStartedAt: true, latestAdminReplyAt: true, latestAdminReplyActorUserId: true, responseDurationMs: true },
      orderBy: { responseStartedAt: "asc" },
    });
  },
  async listOverdue(input) {
    const cutoff = new Date(input.now.getTime() - input.thresholdMs);
    return prisma.mailboxResponseMetric.findMany({
      where: {
        tenantId: input.tenantId,
        ...(input.storeId ? { storeId: input.storeId } : {}),
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        OR: [
          { latestAdminReplyAt: null, responseStartedAt: { lt: cutoff } },
          { responseDurationMs: { gt: BigInt(input.thresholdMs) } },
        ],
      },
      select: { responseStartedAt: true, latestAdminReplyAt: true, latestAdminReplyActorUserId: true, responseDurationMs: true },
      orderBy: { responseStartedAt: "asc" },
    });
  },
  rebuild: rebuildMailboxResponseMetrics,
});
```

Define `rebuildMailboxResponseMetrics` in Task 7; in this task add a stub that returns `{ examined: 0, written: 0, skipped: 0 }` so TypeScript compiles, then replace it in Task 7.

- [ ] **Step 5: Verify service tests**

Run:

```bash
npx vitest run tests/mailbox-response-metrics.test.ts
```

Expected: PASS.

---

### Task 3: Wire Inbound Sync Metrics

**Files:**
- Modify: `src/lib/mailboxes/sync.ts`
- Modify: `tests/mailbox-sync.test.ts`

- [ ] **Step 1: Add a failing sync test for inbound metric recording**

Append to `tests/mailbox-sync.test.ts`:

```ts
it("records a response metric for inbound customer messages linked to conversations", async () => {
  const mailbox = {
    id: "mailbox-1",
    tenantId: "tenant-1",
    storeId: "store-1",
    email: "support@example.com",
    initialSyncAfter: new Date("2026-01-01T00:00:00Z"),
    rtQueueId: 7,
    isActive: true,
    syncCursor: { lastCommittedUid: BigInt(41), uidValidity: BigInt(9) },
  };
  const recordCustomerMessage = vi.fn().mockResolvedValue(undefined);
  const deps: MailboxSyncDeps = {
    findMailbox: vi.fn().mockResolvedValue(mailbox),
    getAppPassword: vi.fn().mockResolvedValue("app-pass"),
    provisionMailbox: vi.fn().mockResolvedValue({ status: "ACTIVE", queueId: 7 }),
    scanInbox: vi.fn().mockResolvedValue({
      uidValidity: BigInt(9),
      messages: [{
        uid: BigInt(42),
        uidValidity: BigInt(9),
        gmailMessageId: "gmail-42",
        gmailThreadId: "thread-1",
        rfcMessageId: "<m42@example.com>",
        internalDate: new Date("2026-01-02T10:00:00Z"),
        fromEmail: "customer@example.com",
        flags: [],
        labels: ["\\Inbox"],
      }],
    }),
    discoverLabels: vi.fn().mockResolvedValue([]),
    persistLabelCatalog: vi.fn().mockResolvedValue(undefined),
    reconcileInboxState: vi.fn().mockResolvedValue(undefined),
    recordCustomerMessage,
    persist: vi.fn()
      .mockResolvedValueOnce({
        imported: 1,
        inherited: 0,
        lastCommittedUid: BigInt(41),
        responseMetricInputs: [{
          tenantId: "tenant-1",
          storeId: "store-1",
          mailboxId: "mailbox-1",
          conversationId: "conversation-1",
          messageAt: new Date("2026-01-02T10:00:00Z"),
        }],
      })
      .mockResolvedValueOnce({ imported: 0, inherited: 0, lastCommittedUid: BigInt(42), responseMetricInputs: [] }),
    materializeConfig: vi.fn().mockResolvedValue("/runtime/configs/mailbox-1.getmailrc"),
    runGetmail: vi.fn().mockResolvedValue(undefined),
    acquireLease: vi.fn().mockResolvedValue(true),
    releaseLease: vi.fn().mockResolvedValue(undefined),
    markError: vi.fn(),
  };

  await syncMailbox("mailbox-1", deps);

  expect(recordCustomerMessage).toHaveBeenCalledWith({
    tenantId: "tenant-1",
    storeId: "store-1",
    mailboxId: "mailbox-1",
    conversationId: "conversation-1",
    messageAt: new Date("2026-01-02T10:00:00Z"),
  });
});
```

- [ ] **Step 2: Run the focused sync test and verify it fails**

Run:

```bash
npx vitest run tests/mailbox-sync.test.ts
```

Expected: FAIL because `MailboxSyncDeps` does not include `recordCustomerMessage`, the persist result type has no `responseMetricInputs`, and `SyncMailboxRecord` lacks `tenantId`/`storeId`.

- [ ] **Step 3: Extend sync types and default dependencies**

In `src/lib/mailboxes/sync.ts`, add a static import:

```ts
import { mailboxResponseMetrics } from "./response-metrics";
```

Extend `MailboxSyncDeps`:

```ts
  recordCustomerMessage(input: {
    tenantId: string;
    storeId: string;
    mailboxId: string;
    conversationId: string;
    messageAt: Date;
  }): Promise<void>;
```

Change the `persist(...)` return type inside `MailboxSyncDeps` from:

```ts
Promise<{ imported: number; inherited: number; lastCommittedUid: bigint }>;
```

to:

```ts
Promise<{
  imported: number;
  inherited: number;
  lastCommittedUid: bigint;
  responseMetricInputs: Array<{
    tenantId: string;
    storeId: string;
    mailboxId: string;
    conversationId: string;
    messageAt: Date;
  }>;
}>;
```

Extend `SyncMailboxRecord`:

```ts
  tenantId: string;
  storeId: string;
```

In `findMailbox`, select:

```ts
tenantId: true,
storeId: true,
```

In `prismaMailboxSyncDeps`, add:

```ts
recordCustomerMessage: mailboxResponseMetrics.recordCustomerMessage,
```

- [ ] **Step 4: Persist Gmail internal dates and invoke the metric hook**

When creating an inbound `gmailMessageLink`, add:

```ts
gmailInternalDate: message.internalDate,
```

When updating/creating outbound links elsewhere, also set `gmailInternalDate` in the relevant tasks.

Inside `prismaMailboxSyncDeps.persist`, collect metric inputs when `link.conversationId` exists and the sender is not the mailbox email:

```ts
const responseMetricInputs: Array<{
  tenantId: string;
  storeId: string;
  mailboxId: string;
  conversationId: string;
  messageAt: Date;
}> = [];
```

Push inputs after a link has a conversation:

```ts
const senderEmail = message.fromEmail?.trim().toLowerCase();
const mailboxEmail = mailbox.email.trim().toLowerCase();
if (link.conversationId && senderEmail && senderEmail !== mailboxEmail) {
  responseMetricInputs.push({
    tenantId: mailbox.tenantId,
    storeId: mailbox.storeId,
    mailboxId: mailbox.id,
    conversationId: link.conversationId,
    messageAt: message.internalDate,
  });
}
```

Return the inputs from `persist`:

```ts
return {
  imported,
  inherited,
  lastCommittedUid,
  responseMetricInputs,
};
```

For the early `messages.length === 0` return, include:

```ts
responseMetricInputs: [],
```

In `syncMailbox`, after each `deps.persist(...)` call and before returning or RT label reconciliation, run:

```ts
await Promise.all(indexed.responseMetricInputs.map((input) => deps.recordCustomerMessage(input)));
```

After the second persist call, run:

```ts
await Promise.all(reconciled.responseMetricInputs.map((input) => deps.recordCustomerMessage(input)));
```

- [ ] **Step 5: Update existing tests for the new dependency**

Every `MailboxSyncDeps` literal in `tests/mailbox-sync.test.ts` needs:

```ts
recordCustomerMessage: vi.fn().mockResolvedValue(undefined),
```

Existing mailbox test records also need:

```ts
tenantId: "tenant-1",
storeId: "store-1",
```

Every mocked `persist` return in `tests/mailbox-sync.test.ts` needs:

```ts
responseMetricInputs: [],
```

- [ ] **Step 6: Verify sync tests**

Run:

```bash
npx vitest run tests/mailbox-sync.test.ts
```

Expected: PASS.

---

### Task 4: Wire Verified Mailgate Metrics

**Files:**
- Modify: `scripts/verified-rt-mailgate.ts`
- Create: `tests/verified-rt-mailgate-response-metrics.test.ts`

- [ ] **Step 1: Write the failing mailgate metric test**

```ts
import { describe, expect, it, vi } from "vitest";
import { runVerifiedMailgate, type MailgateDependencies } from "../scripts/verified-rt-mailgate";

describe("verified mailgate response metrics", () => {
  it("records a customer response metric when a resolved inbound link gains a conversation", async () => {
    const recordCustomerMessage = vi.fn().mockResolvedValue(undefined);
    const deps: MailgateDependencies = {
      load: vi.fn().mockResolvedValue({ duplicate: false, rtQueueId: 7, gmailMessageLinkId: "link-1" }),
      resolve: vi.fn().mockResolvedValue({ ticketId: 42, transactionId: 1001 }),
      deliver: vi.fn(),
      verify: vi.fn().mockResolvedValue(true),
      persist: vi.fn().mockResolvedValue({
        tenantId: "tenant-1",
        storeId: "store-1",
        mailboxId: "mailbox-1",
        conversationId: "conversation-1",
        messageAt: new Date("2026-06-01T10:00:00Z"),
      }),
      recordCustomerMessage,
    };

    const exitCode = await runVerifiedMailgate({
      mailboxId: "mailbox-1",
      mime: Buffer.from("Message-ID: <customer@example.test>\nSubject: Help\n\nBody"),
    }, deps);

    expect(exitCode).toBe(0);
    expect(recordCustomerMessage).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      storeId: "store-1",
      mailboxId: "mailbox-1",
      conversationId: "conversation-1",
      messageAt: new Date("2026-06-01T10:00:00Z"),
    });
  });
});
```

- [ ] **Step 2: Run the mailgate test and verify it fails**

Run:

```bash
npx vitest run tests/verified-rt-mailgate-response-metrics.test.ts
```

Expected: FAIL because `MailgateDependencies.persist` returns `Promise<void>` and there is no `recordCustomerMessage`.

- [ ] **Step 3: Extend mailgate dependency types and imports**

In `scripts/verified-rt-mailgate.ts`, add:

```ts
import { mailboxResponseMetrics } from "../src/lib/mailboxes/response-metrics";
```

Add:

```ts
export interface MailgateMetricInput {
  tenantId: string;
  storeId: string;
  mailboxId: string;
  conversationId: string;
  messageAt: Date;
}
```

Change `persist` to:

```ts
persist(input: { gmailMessageLinkId: string; rtTicketId: number; rtTransactionId: number }): Promise<MailgateMetricInput | null>;
recordCustomerMessage(input: MailgateMetricInput): Promise<void>;
```

- [ ] **Step 4: Record metric after successful persistence**

In `persistResolvedIdentity`, capture the metric input:

```ts
const metricInput = await dependencies.persist({
  gmailMessageLinkId: mapping.gmailMessageLinkId,
  rtTicketId: identity.ticketId,
  rtTransactionId: identity.transactionId,
});
if (metricInput) {
  await dependencies.recordCustomerMessage(metricInput);
}
return true;
```

- [ ] **Step 5: Return metric data from default persistence**

In the default `persist`, select link and mailbox metadata:

```ts
const link = await tx.gmailMessageLink.findUniqueOrThrow({
  where: { id: input.gmailMessageLinkId },
  include: { mailbox: { select: { tenantId: true, storeId: true } } },
});
```

After updating `gmailMessageLink`, return:

```ts
return {
  tenantId: link.mailbox.tenantId,
  storeId: link.mailbox.storeId,
  mailboxId: link.mailboxId,
  conversationId: conversation.id,
  messageAt: link.gmailInternalDate ?? link.createdAt,
};
```

In `defaults`, add:

```ts
recordCustomerMessage: mailboxResponseMetrics.recordCustomerMessage,
```

Update existing `MailgateDependencies` literals in `tests/verified-rt-mailgate.test.ts` so `persist` returns either the expected metric input or `null`, and add:

```ts
recordCustomerMessage: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 6: Verify mailgate tests**

Run:

```bash
npx vitest run tests/verified-rt-mailgate-response-metrics.test.ts tests/verified-rt-mailgate.test.ts
```

Expected: PASS.

---

### Task 5: Wire Admin Reply Metrics

**Files:**
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
- Create: `tests/mailbox-response-proxy-source.test.ts`
- Modify: `tests/gmail-reply.test.ts`

- [ ] **Step 1: Write source guard for reply route ordering and report routes**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox response proxy hooks", () => {
  const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

  it("updates response metrics only after outbound Gmail link persistence", () => {
    expect(source).toContain("mailboxResponseMetrics.recordAdminReply");
    expect(source.indexOf("await prisma.gmailMessageLink.create")).toBeLessThan(
      source.indexOf("mailboxResponseMetrics.recordAdminReply"),
    );
    expect(source).toContain("repliedAt: sent.internalDate");
    expect(source).toContain("actorUserId");
  });

  it("exposes summary and overdue response metric proxy routes", () => {
    expect(source).toContain('proxyPath === "/response-metrics/summary"');
    expect(source).toContain('proxyPath === "/response-metrics/overdue"');
    expect(source).toContain("handleResponseMetricSummary");
    expect(source).toContain("handleOverdueResponseMetrics");
    expect(source).toContain("serializeOverdueResponseMetric");
  });
});
```

- [ ] **Step 2: Run source guard and verify it fails**

Run:

```bash
npx vitest run tests/mailbox-response-proxy-source.test.ts
```

Expected: FAIL because route hooks do not exist.

- [ ] **Step 3: Import the metric service**

Add a top-level static import in `route.ts`:

```ts
import { buildMonthlyResponseSummary, mailboxResponseMetrics } from "@/lib/mailboxes/response-metrics";
```

- [ ] **Step 4: Persist outbound Gmail internal date and record admin reply**

In `handleReply`, add `gmailInternalDate` to the outbound link create:

```ts
gmailInternalDate: sent.internalDate,
```

After the outbound link create succeeds and before `comment(ticketId, ...)`, add:

```ts
await mailboxResponseMetrics.recordAdminReply({
  conversationId: conversation.id,
  actorUserId,
  repliedAt: sent.internalDate,
});
```

This ensures failed SMTP/read-back or failed link persistence does not update metrics.

- [ ] **Step 5: Add report route dispatch**

Near the existing `GET /labels` dispatch, add:

```ts
if (method === "GET" && proxyPath === "/response-metrics/summary") {
  return handleResponseMetricSummary(request, session.tenantId);
}
if (method === "GET" && proxyPath === "/response-metrics/overdue") {
  return handleOverdueResponseMetrics(request, session.tenantId);
}
```

- [ ] **Step 6: Add route handlers**

Add handlers below `handleListLabels`:

```ts
function monthRange(value: string | null) {
  const month = value && /^\d{4}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 7);
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return { month, from, to };
}

async function handleResponseMetricSummary(request: NextRequest, tenantId: string) {
  const storeId = request.nextUrl.searchParams.get("storeId") ?? undefined;
  const mailboxId = request.nextUrl.searchParams.get("mailboxId") ?? undefined;
  const { month, from, to } = monthRange(request.nextUrl.searchParams.get("month"));
  if (storeId && !await requireStoreAccess(tenantId, storeId)) {
    return errorJson("Forbidden — store not found", 403);
  }
  if (storeId && mailboxId && !await requireMailbox(tenantId, storeId, mailboxId)) {
    return errorJson("Forbidden — mailbox not found or inactive", 403);
  }
  const metrics = await mailboxResponseMetrics.listForSummary({ tenantId, storeId, mailboxId, from, to });
  return json({ month, summary: buildMonthlyResponseSummary(metrics) });
}

async function handleOverdueResponseMetrics(request: NextRequest, tenantId: string) {
  const storeId = request.nextUrl.searchParams.get("storeId") ?? undefined;
  const mailboxId = request.nextUrl.searchParams.get("mailboxId") ?? undefined;
  if (storeId && !await requireStoreAccess(tenantId, storeId)) {
    return errorJson("Forbidden — store not found", 403);
  }
  if (storeId && mailboxId && !await requireMailbox(tenantId, storeId, mailboxId)) {
    return errorJson("Forbidden — mailbox not found or inactive", 403);
  }
  const metrics = await mailboxResponseMetrics.listOverdue({
    tenantId,
    storeId,
    mailboxId,
    now: new Date(),
    thresholdMs: 24 * 60 * 60 * 1000,
  });
  return json({ conversations: metrics.map((metric) => serializeOverdueResponseMetric(metric)) });
}
```

Add a serializer next to `monthRange` so BigInt and Date values never go into
`NextResponse.json` raw:

```ts
function serializeOverdueResponseMetric(metric: {
  responseStartedAt: Date;
  latestAdminReplyAt: Date | null;
  responseDurationMs: bigint | null;
}) {
  return {
    responseStartedAt: metric.responseStartedAt.toISOString(),
    latestAdminReplyAt: metric.latestAdminReplyAt?.toISOString() ?? null,
    responseDurationMs: metric.responseDurationMs?.toString() ?? null,
  };
}
```

- [ ] **Step 7: Verify proxy source guard and reply tests**

Run:

```bash
npx vitest run tests/mailbox-response-proxy-source.test.ts tests/gmail-reply.test.ts
```

Expected: PASS.

---

### Task 6: Add UI Surface In Mailboxes Workspace

**Files:**
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx`
- Create: `src/app/(authed)/mailboxes/mailbox-response-ui-source.test.ts`

- [ ] **Step 1: Write UI source guard**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox response metric UI", () => {
  const source = readFileSync("src/app/(authed)/mailboxes/MailboxesClient.tsx", "utf8");

  it("loads summary and overdue response metrics through mailbox proxy", () => {
    expect(source).toContain("/api/mailbox-proxy/response-metrics/summary");
    expect(source).toContain("/api/mailbox-proxy/response-metrics/overdue");
    expect(source).toContain("responseSummary");
    expect(source).toContain("overdueResponses");
  });

  it("renders operational response metric labels", () => {
    expect(source).toContain("Over 24h");
    expect(source).toContain("Avg response");
    expect(source).toContain("Oldest pending");
  });
});
```

- [ ] **Step 2: Run source guard and verify it fails**

Run:

```bash
npx vitest run 'src/app/(authed)/mailboxes/mailbox-response-ui-source.test.ts'
```

Expected: FAIL because UI calls and labels are absent.

- [ ] **Step 3: Add state and loaders near existing mailbox state**

Add types:

```ts
type ResponseSummaryRow = {
  reportMonth: string;
  totalConversations: number;
  repliedConversations: number;
  unrepliedConversations: number;
  overdueConversations: number;
  averageResponseDurationMs: number | null;
  maxResponseDurationMs: number | null;
  oldestPendingAgeMs: number | null;
  actorUserId?: string | null;
};

type OverdueResponseRow = {
  responseStartedAt: string;
  latestAdminReplyAt: string | null;
  responseDurationMs: string | number | null;
};
```

Add state:

```ts
const [responseSummary, setResponseSummary] = useState<ResponseSummaryRow[]>([]);
const [overdueResponses, setOverdueResponses] = useState<OverdueResponseRow[]>([]);
```

Add a formatter:

```ts
function formatDuration(valueMs: number | string | null | undefined) {
  if (valueMs == null) return "—";
  const ms = typeof valueMs === "string" ? Number(valueMs) : valueMs;
  if (!Number.isFinite(ms)) return "—";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
```

- [ ] **Step 4: Fetch summary and overdue data when store/mailbox selection changes**

Use the same selected store/mailbox guard as conversation loading. Fetch:

```ts
const summaryUrl = `/api/mailbox-proxy/response-metrics/summary?storeId=${selectedStoreId}&mailboxId=${selectedMailbox.id}`;
const overdueUrl = `/api/mailbox-proxy/response-metrics/overdue?storeId=${selectedStoreId}&mailboxId=${selectedMailbox.id}`;
```

Parse:

```ts
const summaryJson = await summaryResponse.json();
setResponseSummary(Array.isArray(summaryJson.summary) ? summaryJson.summary : []);

const overdueJson = await overdueResponse.json();
setOverdueResponses(Array.isArray(overdueJson.conversations) ? overdueJson.conversations : []);
```

- [ ] **Step 5: Render a compact operational section**

Near the current mailbox list/detail workspace controls, render:

```tsx
<section style={responseMetricsPanel}>
  <div style={responseMetricStat}>
    <span>Over 24h</span>
    <strong>{overdueResponses.length}</strong>
  </div>
  <div style={responseMetricStat}>
    <span>Avg response</span>
    <strong>{formatDuration(responseSummary[0]?.averageResponseDurationMs)}</strong>
  </div>
  <div style={responseMetricStat}>
    <span>Oldest pending</span>
    <strong>{formatDuration(responseSummary[0]?.oldestPendingAgeMs)}</strong>
  </div>
</section>
```

Add local styles using existing restrained mailbox UI style patterns:

```ts
const responseMetricsPanel: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
};

const responseMetricStat: React.CSSProperties = {
  border: "1px solid #d9e2ec",
  borderRadius: 8,
  padding: "0.65rem",
  background: "#fff",
};
```

- [ ] **Step 6: Verify UI source guard**

Run:

```bash
npx vitest run 'src/app/(authed)/mailboxes/mailbox-response-ui-source.test.ts'
```

Expected: PASS.

---

### Task 7: Add Rebuild Script And Complete Repository Rebuild

**Files:**
- Modify: `src/lib/mailboxes/response-metrics.ts`
- Create: `scripts/rebuild-mailbox-response-metrics.ts`
- Create: `tests/mailbox-response-rebuild-source.test.ts`

- [ ] **Step 1: Write source guard for the rebuild command**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox response metric rebuild script", () => {
  const script = readFileSync("scripts/rebuild-mailbox-response-metrics.ts", "utf8");
  const service = readFileSync("src/lib/mailboxes/response-metrics.ts", "utf8");

  it("supports dry-run by default and explicit write mode", () => {
    expect(script).toContain("--write");
    expect(script).toContain("dryRun: !write");
    expect(script).toContain("mailboxResponseMetrics.rebuild");
  });

  it("derives start and latest reply from inbound and outbound Gmail links", () => {
    expect(service).toContain('direction: "INBOUND"');
    expect(service).toContain('direction: "OUTBOUND"');
    expect(service).toContain("gmailInternalDate");
    expect(service).toContain("responseStartedAt");
    expect(service).toContain("latestAdminReplyAt");
    expect(service).toContain("latestAdminReplyActorUserId");
  });
});
```

- [ ] **Step 2: Run source guard and verify it fails**

Run:

```bash
npx vitest run tests/mailbox-response-rebuild-source.test.ts
```

Expected: FAIL because the script and real rebuild logic do not exist.

- [ ] **Step 3: Replace the rebuild repository stub**

In `src/lib/mailboxes/response-metrics.ts`, implement rebuild with Prisma:

```ts
async function rebuildMailboxResponseMetrics(input: { tenantId?: string; mailboxId?: string; dryRun: boolean }) {
  const conversations = await prisma.mailboxConversation.findMany({
    where: {
      ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
      mailbox: input.tenantId ? { tenantId: input.tenantId } : undefined,
    },
    include: {
      mailbox: { select: { tenantId: true, storeId: true } },
      messages: {
        select: {
          direction: true,
          gmailInternalDate: true,
          createdAt: true,
        },
      },
    },
  });

  let written = 0;
  let skipped = 0;
  for (const conversation of conversations) {
    const inbound = conversation.messages
      .filter((message) => message.direction === "INBOUND")
      .sort((left, right) => (left.gmailInternalDate ?? left.createdAt).getTime() - (right.gmailInternalDate ?? right.createdAt).getTime())[0];
    if (!inbound) {
      skipped += 1;
      continue;
    }
    const outbound = conversation.messages
      .filter((message) => message.direction === "OUTBOUND")
      .sort((left, right) => (right.gmailInternalDate ?? right.createdAt).getTime() - (left.gmailInternalDate ?? left.createdAt).getTime())[0];
    const responseStartedAt = inbound.gmailInternalDate ?? inbound.createdAt;
    const latestAdminReplyAt = outbound ? outbound.gmailInternalDate ?? outbound.createdAt : null;
    const responseDurationMs = latestAdminReplyAt ? durationMsBetween(responseStartedAt, latestAdminReplyAt) : null;
    if (!input.dryRun) {
      await prisma.mailboxResponseMetric.upsert({
        where: { conversationId: conversation.id },
        create: {
          conversationId: conversation.id,
          mailboxId: conversation.mailboxId,
          tenantId: conversation.mailbox.tenantId,
          storeId: conversation.mailbox.storeId,
          responseStartedAt,
          latestAdminReplyAt,
          responseDurationMs,
        },
        update: {
          responseStartedAt,
          latestAdminReplyAt,
          responseDurationMs,
        },
      });
    }
    written += 1;
  }
  return { examined: conversations.length, written, skipped };
}
```

- [ ] **Step 4: Add the CLI script**

Create `scripts/rebuild-mailbox-response-metrics.ts`:

```ts
import { mailboxResponseMetrics } from "../src/lib/mailboxes/response-metrics";

async function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has("--write");
  const tenantArg = process.argv.find((arg) => arg.startsWith("--tenant-id="));
  const mailboxArg = process.argv.find((arg) => arg.startsWith("--mailbox-id="));
  const result = await mailboxResponseMetrics.rebuild({
    tenantId: tenantArg?.slice("--tenant-id=".length),
    mailboxId: mailboxArg?.slice("--mailbox-id=".length),
    dryRun: !write,
  });
  console.log(JSON.stringify({ mode: write ? "write" : "dry-run", ...result }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "rebuild_mailbox_response_metrics_failed");
  process.exitCode = 1;
});
```

- [ ] **Step 5: Verify rebuild source guard**

Run:

```bash
npx vitest run tests/mailbox-response-rebuild-source.test.ts
```

Expected: PASS.

---

### Task 8: Final Focused Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused response metric tests**

Run:

```bash
npx vitest run \
  tests/mailbox-response-schema-source.test.ts \
  tests/mailbox-response-metrics.test.ts \
  tests/mailbox-sync.test.ts \
  tests/verified-rt-mailgate-response-metrics.test.ts \
  tests/mailbox-response-proxy-source.test.ts \
  'src/app/(authed)/mailboxes/mailbox-response-ui-source.test.ts' \
  tests/mailbox-response-rebuild-source.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run adjacent mailbox tests**

Run:

```bash
npx vitest run \
  tests/gmail-reply.test.ts \
  tests/mailbox-reply-context.test.ts \
  tests/mailbox-queue.test.ts \
  tests/verified-rt-mailgate.test.ts \
  tests/mailbox-sync-worker.test.ts
```

Expected: PASS.

- [ ] **Step 3: Validate Prisma schema**

Run:

```bash
npx prisma validate
```

Expected: PASS. If `npx` uses the wrong Prisma path, use:

```bash
pnpm prisma validate
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Check the final diff without staging**

Run:

```bash
git status --short
git diff --check
```

Expected: `git diff --check` PASS. `git status --short` shows the new plan/spec/tests/source changes plus any unrelated pre-existing dirty files.
