# Store-Scoped Zammad Mailboxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move mailbox ownership from users to stores, make operator access store-first, and enforce a fixed six-month initial history policy for mailbox setup.

**Architecture:** Keep Zammad as the upstream email/ticket engine and keep the app as the store-scoped control plane. Server components should load store lists and initial state directly, client components should stay interactive but not own data fetching that can be done on the server, and route handlers should remain the boundary for Zammad/admin operations. The mailbox create path must be fixed to a six-month history policy, not a selectable import mode.

**Tech Stack:** Next.js 16 App Router, Prisma, Zod, Vitest, Node `node:test`, Zammad REST API.

---

**Execution note:** this checkout currently has unrelated merge conflicts in other files. Resolve those before starting feature edits so the plan can be executed cleanly.

## File Structure

- Modify `prisma/schema.prisma`
  - Add `tenantId` and `storeId` to `Mailbox`, add `Store.mailboxes` and `Tenant.mailboxes`, keep Zammad IDs unique.
- Add a new Prisma migration
  - Add nullable columns first, backfill mailbox ownership, then enforce `NOT NULL` after data is mapped.
- Modify `src/lib/zammad/admin-validation.ts`
  - Remove `importMode` from mailbox create input, add a fixed `MAILBOX_HISTORY_WINDOW_MONTHS = 6` constant, keep the create schema strict.
- Modify `src/lib/zammad/client.ts`
  - Add a helper that applies the fixed six-month mailbox history policy when creating/updating the email channel, or fails closed if the supported Zammad path is missing.
- Modify `src/lib/zammad/auth.ts`
  - Replace user mailbox assignment helpers with store-scoped helpers.
- Modify `src/app/api/admin/mailboxes/route.ts`
  - Store-scoped list/create flow, fixed six-month setup, no assignments.
- Modify `src/app/api/admin/mailboxes/[id]/route.ts`
  - Store-aware detail/update.
- Modify `src/app/api/admin/mailboxes/[id]/status/route.ts`
  - Enable/disable only, store-aware guard.
- Delete `src/app/api/admin/mailboxes/[id]/assignments/route.ts`
  - Dead surface after the new contract lands.
- Create `src/app/(authed)/admin/mailboxes/AdminMailboxesClient.tsx`
  - Client component for store selection, mailbox table, create/edit modals.
- Modify `src/app/(authed)/admin/mailboxes/page.tsx`
  - Server component that reads async `searchParams`, loads stores, and passes serializable props into the client component.
- Modify `src/app/(authed)/admin/mailboxes/CreateMailboxModal.tsx`
  - Remove import-mode chooser, show fixed six-month import policy, keep connection testing.
- Modify `src/app/(authed)/admin/mailboxes/EditMailboxModal.tsx`
  - Keep name/email/connection editing, no store move in this phase.
- Delete `src/app/(authed)/admin/mailboxes/AssignUsersModal.tsx`
  - No user assignment surface remains.
- Modify `src/app/api/mailbox-proxy/[...path]/route.ts`
  - Require `storeId` on every operator proxy path and verify ticket/mailbox ownership against that store.
- Modify `src/app/(authed)/mailboxes/page.tsx`
  - Server component for the inbox shell, reads async `searchParams` and passes `initialStoreId`.
- Modify `src/app/(authed)/mailboxes/MailboxesClient.tsx`
  - Store-first inbox UI with URL-driven store selection and store-scoped mailbox/conversation fetching.
- Add `tests/zammad-mailbox-store-source.test.ts`
  - Source-level regression guard for store ownership, fixed six-month policy, and removal of assignment/import-mode surfaces.
- Modify `tests/zammad-admin-validation.test.ts`
  - Validate `storeId` is required, `importMode` is rejected, and the fixed history policy is visible in the contract.

## Task 1: Lock the New Contract in Tests

**Files:**
- Create: `tests/zammad-mailbox-store-source.test.ts`
- Modify: `tests/zammad-admin-validation.test.ts`

- [ ] **Step 1: Write the failing source test**

Use this complete file:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(path, "utf8");
}

test("mailbox schema is store-owned", () => {
  const source = read("prisma/schema.prisma");
  assert.match(source, /model Mailbox\s*\{[\s\S]*tenantId\s+String\s+@map\("tenant_id"\)[\s\S]*storeId\s+String\s+@map\("store_id"\)[\s\S]*store\s+Store\s+@relation\(/);
  assert.match(source, /Store\s+\{[\s\S]*mailboxes\s+Mailbox\[\]/);
  assert.match(source, /Tenant\s+\{[\s\S]*mailboxes\s+Mailbox\[\]/);
});

test("admin validation removes importMode and keeps the schema strict", () => {
  const source = read("src/lib/zammad/admin-validation.ts");
  assert.match(source, /MAILBOX_HISTORY_WINDOW_MONTHS\s*=\s*6/);
  assert.match(source, /createMailboxSchema[\s\S]*storeId/);
  assert.doesNotMatch(source, /importMode/);
  assert.doesNotMatch(source, /all_archive/);
  assert.doesNotMatch(source, /new_only/);
  assert.doesNotMatch(source, /historyWindowMonths/);
});

test("admin create route requires storeId and uses the fixed history policy", () => {
  const source = read("src/app/api/admin/mailboxes/route.ts");
  assert.match(source, /storeId/);
  assert.match(source, /MAILBOX_HISTORY_WINDOW_MONTHS/);
  assert.doesNotMatch(source, /assignments/);
});

test("admin and operator UIs are store-first", () => {
  const adminPage = read("src/app/(authed)/admin/mailboxes/page.tsx");
  const adminClient = read("src/app/(authed)/admin/mailboxes/CreateMailboxModal.tsx");
  const inboxPage = read("src/app/(authed)/mailboxes/page.tsx");
  const inboxClient = read("src/app/(authed)/mailboxes/MailboxesClient.tsx");

  assert.match(adminPage, /searchParams:\s*Promise<\{/);
  assert.match(adminPage, /storeId/);
  assert.match(adminClient, /fixed six-month/i);
  assert.doesNotMatch(adminClient, /importMode/);
  assert.match(inboxPage, /searchParams:\s*Promise<\{/);
  assert.match(inboxClient, /storeId/);
  assert.match(inboxClient, /router\.replace\(.+\?storeId=/s);
});

test("operator proxy requires storeId on all mailbox actions", () => {
  const source = read("src/app/api/mailbox-proxy/[...path]/route.ts");
  assert.match(source, /storeId/);
  assert.doesNotMatch(source, /getAllowedMailboxIds/);
  assert.doesNotMatch(source, /getMailboxAccess/);
});
```

- [ ] **Step 2: Update the focused validation test**

Add these assertions to `tests/zammad-admin-validation.test.ts`:

```ts
it("requires storeId and rejects importMode", () => {
  const validCustomInput = {
    storeId: "store_123",
    name: "Support",
    email: "support@example.com",
    provider: "custom",
    inbound: { host: "imap.gmail.com", port: 993, encryption: "ssl", username: "user", password: "pass" },
    outbound: { host: "smtp.gmail.com", port: 587, encryption: "starttls", username: "user", password: "pass" },
  };

  expect(createMailboxSchema.safeParse(validCustomInput).success).toBe(true);
  expect(createMailboxSchema.safeParse({ ...validCustomInput, importMode: "all" }).success).toBe(false);
});
```

- [ ] **Step 3: Run the tests and verify they fail before implementation**

Run:

```bash
./node_modules/.bin/tsx --test tests/zammad-mailbox-store-source.test.ts tests/zammad-admin-validation.test.ts
```

Expected: FAIL because `storeId`, fixed six-month policy, and store-first UI/proxy changes are not implemented yet.

- [ ] **Step 4: Commit the failing test surface**

```bash
git add tests/zammad-mailbox-store-source.test.ts tests/zammad-admin-validation.test.ts
git commit -m "test: specify store-scoped mailbox contract"
```

## Task 2: Change the Data Model and Zammad Helpers

**Files:**
- Modify: `prisma/schema.prisma`
- Add: new Prisma migration generated by Prisma
- Modify: `src/lib/zammad/admin-validation.ts`
- Modify: `src/lib/zammad/client.ts`
- Modify: `src/lib/zammad/auth.ts`

- [ ] **Step 1: Extend the Prisma model for store ownership**

Make `Mailbox` store-owned and tenant-owned, and add the reverse relations:

```prisma
model Mailbox {
  id              String   @id @default(cuid())
  tenantId        String   @map("tenant_id")
  storeId         String   @map("store_id")
  name            String
  email           String
  provider        String
  zammadGroupId   Int      @unique @map("zammad_group_id")
  zammadChannelId Int?     @unique @map("zammad_channel_id")
  isActive        Boolean  @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])
  store  Store  @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([tenantId, storeId, isActive])
  @@index([storeId])
  @@map("mailboxes")
}
```

Add `mailboxes Mailbox[]` to both `Store` and `Tenant`.

- [ ] **Step 2: Remove `importMode` from the create contract and add the fixed six-month constant**

Replace the create schema shape with a strict schema that requires `storeId` and keeps the connection fields:

```ts
export const MAILBOX_HISTORY_WINDOW_MONTHS = 6;

export const createMailboxSchema = z.object({
  storeId: z.string().min(1),
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Invalid email"),
  provider: z.enum(["gmail", "custom"]),
  fromName: z.string().min(1).max(200).optional(),
  appPassword: z.string().min(1).optional(),
  inbound: inboundCreateSchema.optional(),
  outbound: outboundCreateSchema.optional(),
}).refine(
  (d) => (d.provider === "gmail" ? !!d.appPassword : !!d.inbound && !!d.outbound),
  "Gmail requires appPassword; Custom requires inbound + outbound",
);
```

Do not keep `importMode`, `all_archive`, `new_only`, or a client-controlled history window field.

- [ ] **Step 3: Add a Zammad helper for the fixed six-month policy**

Add one helper in `src/lib/zammad/client.ts` that owns the mailbox history policy:

```ts
export async function applyMailboxHistoryWindow(channelId: number): Promise<ZammadResponse<unknown>> {
  // Implementation must verify the supported Zammad path first.
  // If Zammad cannot enforce the 6-month history cap directly, return a failure
  // and let the caller fail closed instead of falling back to sync-all.
}
```

The plan is intentionally strict: mailbox creation must not silently degrade to full-history sync.

- [ ] **Step 4: Replace mailbox assignment helpers with store-scoped helpers**

Rewrite `src/lib/zammad/auth.ts` around these helpers:

```ts
export interface MailboxAccessContext {
  userId: string;
  role: string;
  tenantId: string;
  zammadUserId: number | null;
}

export async function listStoreMailboxes(ctx: MailboxAccessContext, storeId: string) {}
export async function requireActiveStoreMailbox(ctx: MailboxAccessContext, storeId: string, zammadGroupId: number) {}
export function requireZammadUser(ctx: MailboxAccessContext) {}
```

Remove `getAllowedMailboxIds`, `getMailboxAccess`, and any `canReply` / `canUpdateStatus` runtime checks.

- [ ] **Step 5: Run schema and unit validation**

Run:

```bash
npx prisma validate
./node_modules/.bin/tsx --test tests/zammad-admin-validation.test.ts
```

Expected: the schema validates and the admin validation test now reflects the store-scoped, fixed-policy contract.

- [ ] **Step 6: Commit the model and helper changes**

```bash
git add prisma/schema.prisma src/lib/zammad/admin-validation.ts src/lib/zammad/client.ts src/lib/zammad/auth.ts
git commit -m "feat: make mailboxes store-owned with fixed history policy"
```

## Task 3: Rework the Admin Mailbox Flow

**Files:**
- Modify: `src/app/api/admin/mailboxes/route.ts`
- Modify: `src/app/api/admin/mailboxes/[id]/route.ts`
- Modify: `src/app/api/admin/mailboxes/[id]/status/route.ts`
- Delete: `src/app/api/admin/mailboxes/[id]/assignments/route.ts`
- Create: `src/app/(authed)/admin/mailboxes/AdminMailboxesClient.tsx`
- Modify: `src/app/(authed)/admin/mailboxes/page.tsx`
- Modify: `src/app/(authed)/admin/mailboxes/MailboxList.tsx`
- Modify: `src/app/(authed)/admin/mailboxes/CreateMailboxModal.tsx`
- Modify: `src/app/(authed)/admin/mailboxes/EditMailboxModal.tsx`
- Delete: `src/app/(authed)/admin/mailboxes/AssignUsersModal.tsx`

- [ ] **Step 1: Convert the admin page to a server shell**

Move store loading into the server page and pass serializable props to a new client shell:

```tsx
export default async function AdminMailboxesPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const { storeId } = await searchParams;
  // Load active stores and, if storeId is valid, that store's mailboxes.
  // Pass { stores, selectedStoreId, initialMailboxes } into AdminMailboxesClient.
}
```

Keep the URL as the source of truth for selected store state so the client does not need `useSearchParams`.

- [ ] **Step 2: Rewrite create/update routes for store ownership**

In `POST /api/admin/mailboxes`, require `storeId`, validate the store belongs to the tenant, and save `tenantId` plus `storeId` into `Mailbox`.

Use this shape in the route:

```ts
const parsed = createMailboxSchema.safeParse(body);
if (!parsed.success) return NextResponse.json({ error: "Validation failed" }, { status: 400 });

const store = await prisma.store.findFirst({
  where: { id: parsed.data.storeId, tenantId: session.tenantId, status: "ACTIVE", deletedAt: null },
});
```

After channel verification, call the fixed six-month helper and fail closed if it is not supported. Do not persist any `importMode`.

- [ ] **Step 3: Remove assignment actions from the admin UI**

Delete the assignments route and the `AssignUsersModal` component. In `MailboxList.tsx`, remove the users column and assignment button; keep edit and status actions only.

- [ ] **Step 4: Update the create modal**

Make `CreateMailboxModal` receive the selected `storeId` from the page, remove the import-mode radio group, and surface a single line like `Lịch sử email chỉ lấy 6 tháng gần nhất`.

The modal should still keep the Gmail/custom connection probes and the save button.

- [ ] **Step 5: Run the admin-focused tests**

Run:

```bash
./node_modules/.bin/tsx --test tests/zammad-mailbox-store-source.test.ts tests/zammad-admin-validation.test.ts
```

Expected: PASS once store-scoped admin routes and UI are in place.

- [ ] **Step 6: Commit the admin flow**

```bash
git add src/app/api/admin/mailboxes/route.ts src/app/api/admin/mailboxes/[id]/route.ts src/app/api/admin/mailboxes/[id]/status/route.ts src/app/(authed)/admin/mailboxes
git rm src/app/api/admin/mailboxes/[id]/assignments/route.ts src/app/(authed)/admin/mailboxes/AssignUsersModal.tsx
git commit -m "feat: scope admin mailboxes by store"
```

## Task 4: Rework the Operator Inbox and Proxy

**Files:**
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
- Modify: `src/app/(authed)/mailboxes/page.tsx`
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx`

- [ ] **Step 1: Convert the inbox page to a server shell**

Read `searchParams` on the server, load stores, resolve `selectedStoreId`, and pass initial props to the inbox client:

```tsx
export default async function MailboxesPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const { storeId } = await searchParams;
  // Load active stores and pass initialStoreId into the client.
}
```

- [ ] **Step 2: Make the inbox client store-first**

The client should:

```tsx
router.replace(`/mailboxes?storeId=${storeId}`);
```

and fetch only mailboxes/conversations for the selected store. No auto-selection, no global list, no user assignment fallback.

- [ ] **Step 3: Require storeId on every proxy path**

Update the catch-all proxy so all mailbox actions require `storeId` and verify the ticket belongs to an active mailbox for that selected store:

```ts
const storeId = url.searchParams.get("storeId");
if (!storeId) return errorJson("storeId is required", 422);
```

The mailbox list, conversation list, detail, reply, and status actions should all resolve through the selected store.

- [ ] **Step 4: Run the inbox/proxy source test**

Use the source test from Task 1 and a focused route test run:

```bash
./node_modules/.bin/tsx --test tests/zammad-mailbox-store-source.test.ts
```

Expected: PASS when the inbox and proxy are store-scoped.

- [ ] **Step 5: Commit the inbox flow**

```bash
git add src/app/api/mailbox-proxy/[...path]/route.ts src/app/(authed)/mailboxes/page.tsx src/app/(authed)/mailboxes/MailboxesClient.tsx
git commit -m "feat: make mailbox inbox store-first"
```

## Task 5: Clean Up Dead Surfaces and Verify

**Files:**
- Modify: `tests/zammad-admin-validation.test.ts`
- Remove any lingering references to `importMode`, `assignments`, `all_archive`, `new_only`, `getAllowedMailboxIds`, `getMailboxAccess`

- [ ] **Step 1: Sweep the codebase for stale mailbox-assignment and sync-all references**

Run:

```bash
rg -n "importMode|all_archive|new_only|assignments|UserMailboxAccess|getAllowedMailboxIds|getMailboxAccess|sync all" src tests prisma docs/superpowers/specs
```

Expected: no runtime code still relies on the old assignment model or selectable mailbox import modes.

- [ ] **Step 2: Tighten the validation tests**

Keep these assertions in `tests/zammad-admin-validation.test.ts`:

```ts
expect(createMailboxSchema.safeParse({ ...validCustomInput, storeId: "store_1" }).success).toBe(true);
expect(createMailboxSchema.safeParse({ ...validCustomInput, storeId: "store_1", importMode: "all" }).success).toBe(false);
```

- [ ] **Step 3: Run the focused verification set**

Run:

```bash
npx prisma validate
./node_modules/.bin/tsx --test tests/zammad-mailbox-store-source.test.ts tests/zammad-admin-validation.test.ts
npx tsc --noEmit
```

Expected: schema validates, mailbox source tests pass, and no new TypeScript errors come from the mailbox refactor.

- [ ] **Step 4: Commit the cleanup**

```bash
git add tests/zammad-admin-validation.test.ts
git commit -m "test: cover store-scoped mailbox cleanup"
```
