# Triple Whale Sync From Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-shop Triple Whale initial backfill date and recurring sync interval with a 30-minute minimum.

**Architecture:** Store `syncFromDate` and `syncIntervalMinutes` on `TripleWhaleCredential`. The existing sync path reads `syncFromDate` only when `lastSyncedAt` is empty; a single BullMQ repeat dispatcher runs every 30 minutes and enqueues credentials whose interval has elapsed.

**Tech Stack:** Next.js route handlers, React client component, Prisma/Postgres, BullMQ, Vitest/source tests.

---

### Task 1: Schema And Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260628190000_triple_whale_sync_schedule/migration.sql`
- Test: `tests/triple-whale-sync-schedule-schema-source.test.ts`

- [ ] **Step 1: Add source test**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Triple Whale sync schedule schema", () => {
  it("stores initial backfill date and recurring interval on credentials", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const migration = readFileSync(
      join(process.cwd(), "prisma/migrations/20260628190000_triple_whale_sync_schedule/migration.sql"),
      "utf8",
    );

    expect(schema).toMatch(/syncFromDate\s+DateTime\s+@map\("sync_from_date"\) @db\.Date/);
    expect(schema).toMatch(/syncIntervalMinutes\s+Int\s+@default\(30\) @map\("sync_interval_minutes"\)/);
    expect(migration).toContain('ADD COLUMN "sync_from_date" DATE');
    expect(migration).toContain('ADD COLUMN "sync_interval_minutes" INTEGER NOT NULL DEFAULT 30');
    expect(migration).toContain('CHECK ("sync_interval_minutes" >= 30)');
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npx vitest run tests/triple-whale-sync-schedule-schema-source.test.ts`

Expected: fails because migration/test file or schema fields do not exist.

- [ ] **Step 3: Add minimal schema/migration**

Add to `TripleWhaleCredential`:

```prisma
  syncFromDate        DateTime  @map("sync_from_date") @db.Date
  syncIntervalMinutes Int       @default(30) @map("sync_interval_minutes")
```

Migration:

```sql
ALTER TABLE "triple_whale_credentials"
  ADD COLUMN "sync_from_date" DATE;

UPDATE "triple_whale_credentials"
SET "sync_from_date" = (CURRENT_DATE - INTERVAL '90 days')::date
WHERE "sync_from_date" IS NULL;

ALTER TABLE "triple_whale_credentials"
  ALTER COLUMN "sync_from_date" SET NOT NULL,
  ADD COLUMN "sync_interval_minutes" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "triple_whale_credentials"
  ADD CONSTRAINT "triple_whale_credentials_sync_interval_minutes_min"
  CHECK ("sync_interval_minutes" >= 30);
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/triple-whale-sync-schedule-schema-source.test.ts`

Expected: pass.

### Task 2: API And Sync Logic

**Files:**
- Modify: `src/app/api/integrations/triple-whale/route.ts`
- Modify: `src/app/api/integrations/triple-whale/[storeId]/route.ts`
- Modify: `src/lib/triple-whale/sync.ts`
- Test: `tests/triple-whale-sync-schedule-source.test.ts`

- [ ] **Step 1: Add source test**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Triple Whale sync schedule API and sync source", () => {
  it("validates create/update schedule fields and uses syncFromDate before first sync", () => {
    const createRoute = readFileSync(join(process.cwd(), "src/app/api/integrations/triple-whale/route.ts"), "utf8");
    const updateRoute = readFileSync(join(process.cwd(), "src/app/api/integrations/triple-whale/[storeId]/route.ts"), "utf8");
    const syncSource = readFileSync(join(process.cwd(), "src/lib/triple-whale/sync.ts"), "utf8");

    expect(createRoute).toContain("syncFromDate");
    expect(createRoute).toContain("syncIntervalMinutes");
    expect(createRoute).toContain(".min(30)");
    expect(updateRoute).toContain("syncIntervalMinutes");
    expect(syncSource).toContain("credential.syncFromDate");
    expect(syncSource).not.toContain("BACKFILL_DAYS");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npx vitest run tests/triple-whale-sync-schedule-source.test.ts`

Expected: fails because the fields are not wired.

- [ ] **Step 3: Wire validation and persistence**

In create schema, add:

```ts
syncFromDate: z.string().date(),
syncIntervalMinutes: z.number().int().min(30).default(30),
```

Create data:

```ts
syncFromDate: new Date(`${syncFromDate}T00:00:00.000Z`),
syncIntervalMinutes,
```

In update schema, allow:

```ts
syncIntervalMinutes: z.number().int().min(30).optional(),
```

Only update `syncIntervalMinutes` when provided.

- [ ] **Step 4: Use `syncFromDate` for initial sync**

Replace the hard-coded 90-day fallback in `src/lib/triple-whale/sync.ts`:

```ts
const startDate = credential.lastSyncedAt
  ? formatInTimeZone(credential.lastSyncedAt, timezone, "yyyy-MM-dd")
  : formatInTimeZone(credential.syncFromDate, timezone, "yyyy-MM-dd");
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/triple-whale-sync-schedule-source.test.ts`

Expected: pass.

### Task 3: Recurring Dispatcher

**Files:**
- Create: `src/lib/triple-whale/queue.ts`
- Modify: `src/lib/jobs/workers/triple-whale-sync-worker.ts`
- Test: `tests/triple-whale-recurring-sync-source.test.ts`

- [ ] **Step 1: Add source test**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Triple Whale recurring sync dispatcher", () => {
  it("schedules one 30-minute dispatcher and filters due credentials by configured interval", () => {
    const queueSource = readFileSync(join(process.cwd(), "src/lib/triple-whale/queue.ts"), "utf8");
    const workerSource = readFileSync(join(process.cwd(), "src/lib/jobs/workers/triple-whale-sync-worker.ts"), "utf8");

    expect(queueSource).toContain("TRIPLE_WHALE_SYNC_DISPATCHER_INTERVAL_MS = 30 * 60 * 1000");
    expect(queueSource).toContain("scheduleTripleWhaleSyncDispatcher");
    expect(queueSource).toContain("dispatchDueTripleWhaleSyncs");
    expect(queueSource).toContain("syncIntervalMinutes");
    expect(workerSource).toContain("dispatch-due-triple-whale-syncs");
    expect(workerSource).toContain("dispatchDueTripleWhaleSyncs()");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npx vitest run tests/triple-whale-recurring-sync-source.test.ts`

Expected: fails because dispatcher does not exist.

- [ ] **Step 3: Add dispatcher helpers**

Create `src/lib/triple-whale/queue.ts` with:

```ts
import type { Queue } from "bullmq";
import { prisma } from "@/lib/db";
import { getTripleWhaleSyncQueue } from "@/lib/queue/queue";

export const TRIPLE_WHALE_SYNC_DISPATCHER_JOB_ID = "triple-whale-sync-dispatcher";
export const TRIPLE_WHALE_SYNC_DISPATCHER_INTERVAL_MS = 30 * 60 * 1000;

export async function enqueueTripleWhaleSync(
  credentialId: string,
  tenantId: string,
  queue: Queue = getTripleWhaleSyncQueue(),
) {
  return queue.add(
    "sync-store",
    { credentialId, tenantId },
    { jobId: `tw-sync-${credentialId}-${Date.now()}` },
  );
}

export async function scheduleTripleWhaleSyncDispatcher(queue: Queue = getTripleWhaleSyncQueue()) {
  return queue.add(
    "dispatch-due-triple-whale-syncs",
    {},
    {
      jobId: TRIPLE_WHALE_SYNC_DISPATCHER_JOB_ID,
      repeat: { every: TRIPLE_WHALE_SYNC_DISPATCHER_INTERVAL_MS },
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );
}

export async function dispatchDueTripleWhaleSyncs() {
  const credentials = await prisma.tripleWhaleCredential.findMany({
    select: {
      id: true,
      tenantId: true,
      lastSyncedAt: true,
      syncIntervalMinutes: true,
    },
  });
  const now = Date.now();
  const due = credentials.filter((credential) => {
    if (!credential.lastSyncedAt) return true;
    return now - credential.lastSyncedAt.getTime() >= credential.syncIntervalMinutes * 60_000;
  });

  await Promise.all(due.map((credential) => enqueueTripleWhaleSync(credential.id, credential.tenantId)));
  return { enqueued: due.length };
}
```

- [ ] **Step 4: Wire worker**

In `startTripleWhaleSyncWorker`, before returning the worker, call:

```ts
void scheduleTripleWhaleSyncDispatcher();
```

In the processor, route dispatcher jobs:

```ts
if (job.name === "dispatch-due-triple-whale-syncs") {
  return dispatchDueTripleWhaleSyncs();
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/triple-whale-recurring-sync-source.test.ts`

Expected: pass.

### Task 4: UI Payload

**Files:**
- Modify: `src/app/(authed)/integrations/triple-whale/TripleWhaleClient.tsx`
- Test: `tests/triple-whale-ui-source.test.ts`

- [ ] **Step 1: Add source test**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Triple Whale Add modal schedule UI", () => {
  it("renders native date and interval inputs and posts them to create API", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/(authed)/integrations/triple-whale/TripleWhaleClient.tsx"),
      "utf8",
    );

    expect(source).toContain("syncFromDate");
    expect(source).toContain("syncIntervalMinutes");
    expect(source).toContain('type="date"');
    expect(source).toContain("min={30}");
    expect(source).toContain("Sync every");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npx vitest run tests/triple-whale-ui-source.test.ts`

Expected: fails because UI fields are absent.

- [ ] **Step 3: Add minimal UI state and payload**

In Add modal:

```ts
const defaultSyncFromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const [syncFromDate, setSyncFromDate] = useState(defaultSyncFromDate);
const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(30);
```

Payload:

```ts
body: JSON.stringify({
  shopDomain: shopDomain.trim(),
  customName: customName.trim(),
  apiKey: apiKey.trim(),
  syncFromDate,
  syncIntervalMinutes,
}),
```

Add controls:

```tsx
<input id={fromDateId} className="input" type="date" value={syncFromDate} onChange={(e) => setSyncFromDate(e.target.value)} />
<input id={intervalId} className="input" type="number" min={30} value={syncIntervalMinutes} onChange={(e) => setSyncIntervalMinutes(Math.max(30, Number(e.target.value) || 30))} />
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/triple-whale-ui-source.test.ts`

Expected: pass.

### Task 5: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/triple-whale-sync-schedule-schema-source.test.ts tests/triple-whale-sync-schedule-source.test.ts tests/triple-whale-recurring-sync-source.test.ts tests/triple-whale-ui-source.test.ts
```

Expected: pass.

- [ ] **Step 2: Validate Prisma schema**

Run: `npx prisma validate`

Expected: schema validates.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: pass unless blocked by the existing external Google font fetch issue.
