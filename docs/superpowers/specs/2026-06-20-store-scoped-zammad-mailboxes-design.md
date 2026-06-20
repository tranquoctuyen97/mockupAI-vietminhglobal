# Store-Scoped Zammad Mailboxes - Design

Date: 2026-06-20
Status: Proposed
Source spec: `docs/superpowers/specs/zammad-mailbox-management.md`
Backend: Zammad self-hosted REST API

## Goal

Redesign the implemented Zammad mailbox feature so mailboxes are owned by stores, not users. The app should support multiple mailboxes per store. Operators must choose a store before seeing that store's mailboxes and conversations.

This design intentionally does not introduce user-store ACL. Access stays tenant/feature based: a user with the `mailboxes` feature can use active mailboxes for stores in the same tenant.

## Non-Goals

- No per-user mailbox assignment.
- No new user-store permission model.
- No changes to Zammad's core mapping of app mailbox to Zammad group plus email channel.
- No Google OAuth for Gmail.
- No mailbox hard delete.
- No full inbox import or "sync all" option.
- No rewrite of Zammad client primitives unless required by store scoping.

## Current State

The current implementation follows the earlier Zammad design:

- `Mailbox` is app-managed metadata for a Zammad group and email channel.
- `UserMailboxAccess` maps individual users to `zammadGroupId` with `canReply` and `canUpdateStatus`.
- `/admin/mailboxes` can create, edit, enable, disable, and assign mailboxes to users.
- `/mailboxes` lists mailboxes available to the current user through `UserMailboxAccess`, except `SUPER_ADMIN`, which bypasses assignments.
- Zammad tickets are queried by `group_id`; ticket articles are used for threads and replies.

The new model keeps the Zammad concepts, but changes app ownership and runtime access from user assignment to store scoping.

## Decisions

1. Use store-owned mailboxes.
   - `Mailbox` belongs to exactly one `Store`.
   - One store can have many mailboxes.
   - A mailbox cannot exist without a store.

2. Remove user assignment from the active contract.
   - `UserMailboxAccess` is not used by the new runtime path.
   - `AssignUsersModal`, assignment routes, and `assignments` in the create contract are removed from the new UI/API surface.
   - `ZammadUser` remains because reply/status write operations still require app-user to Zammad-user mapping.

3. Keep tenant feature authorization.
   - Admin config still requires `requireMailboxAdmin()`.
   - Operator inbox still requires `requireFeature("mailboxes")`.
   - Store scoping is enforced by `tenantId + storeId`, not by per-user assignment.

4. Keep Zammad as the credential store.
   - App DB stores mailbox metadata only.
   - IMAP/SMTP passwords remain stored only in Zammad.
   - Audit logs must not include credentials or raw channel payloads.

5. Use a fixed six-month history window.
   - The mailbox create/settings UI must not offer "sync all", `all_archive`, or any full-history import mode.
   - New mailbox setup displays a single import policy: get email from the latest 6 months.
   - The server owns the value. Do not trust a client-supplied arbitrary month count.
   - If Zammad does not support this as a direct channel option, implementation must first verify the supported Zammad setting or worker strategy before enabling mailbox creation with this policy.

## Data Model

`Mailbox` gains explicit tenant and store ownership:

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

Notes:

- `zammadGroupId` and `zammadChannelId` stay unique because they identify global Zammad resources.
- The design does not require a unique email per store. If the implementation wants stronger protection, it can add `@@unique([tenantId, storeId, email])` after confirming duplicate email behavior in Zammad.
- `Store` should add `mailboxes Mailbox[]`.
- `Tenant` should add `mailboxes Mailbox[]`.

## Migration Strategy

Use a two-step safe migration because existing mailbox rows may not have a deterministic store.

Step 1:

- Add nullable `tenant_id` and `store_id` to `mailboxes`.
- Add indexes and relations only where the database can support them safely.
- Ship code or a script that reports any mailbox without a store.
- Backfill existing rows manually or with an explicit mapping script.

Step 2:

- Enforce `tenant_id NOT NULL` and `store_id NOT NULL`.
- Add final foreign keys and indexes.
- Stop reading `UserMailboxAccess` in the application.

`UserMailboxAccess` should remain deprecated in the first implementation pass to reduce rollback risk. Drop it in a later cleanup after the store-scoped flow is verified.

## Admin UX

`/admin/mailboxes` becomes store-first:

- Load active stores for the tenant.
- Show a store selector before the mailbox table.
- If no store is selected, show an empty state asking the admin to choose a store.
- Do not auto-select a store.
- After store selection, list mailboxes for that store only.
- The create button is disabled until a store is selected. The create modal receives that selected `storeId`; it does not offer a second store picker.
- The table shows mailbox name, email, provider, status, and store context.
- Remove the users column and assignment action.
- Keep edit and enable/disable actions.

Create flow:

- `POST /api/admin/mailboxes` requires `storeId`.
- The route validates the store by `id`, `tenantId`, active status, and not deleted.
- Zammad group/channel creation, connection tests, verification, rollback, and channel lookup remain the same.
- Initial email history is limited to the latest 6 months. The UI does not provide a "sync all" option.
- The local `Mailbox` row is saved with `tenantId` and `storeId`.
- Audit metadata includes `storeId`, mailbox name, email, provider, `zammadGroupId`, and `zammadChannelId`.

## Operator UX

`/mailboxes` becomes store-first:

- Load active stores for the tenant.
- Show a store selector at the top of the inbox sidebar.
- If no store is selected, show "Choose a store to view mailboxes."
- Do not auto-select a store.
- After store selection, call `/api/mailbox-proxy/mailboxes?storeId=...`.
- Show only active mailboxes for the selected store.
- Keep the existing status filters: active, pending, closed.
- Conversation list still queries by `mailboxId`, which maps to Zammad `group_id`.
- Empty state for a selected store becomes "This store has no active mailboxes."

The UI should keep the current dense inbox layout: store selector, mailbox list, conversation list, detail panel, reply composer.

## API Design

### Admin Routes

All admin routes keep `requireMailboxAdmin()`.

- `GET /api/admin/mailboxes?storeId=...`
  - Requires `storeId`.
  - Validates store belongs to `session.tenantId`.
  - Returns mailboxes for that store.

- `POST /api/admin/mailboxes`
  - Requires `storeId`.
  - Rejects `assignments`.
  - Creates Zammad resources and local row scoped to the store.

- `GET /api/admin/mailboxes/:id`
  - Verifies mailbox belongs to `session.tenantId`.
  - Includes store summary.

- `PUT /api/admin/mailboxes/:id`
  - Verifies mailbox belongs to `session.tenantId`.
  - Does not allow moving mailbox between stores in this phase.

- `POST /api/admin/mailboxes/:id/status`
  - Verifies mailbox belongs to `session.tenantId`.
  - Keeps disable-only behavior; no hard delete.

Remove from active surface:

- `GET /api/admin/mailboxes/:id/assignments`
- `PUT /api/admin/mailboxes/:id/assignments`

### Operator Proxy

Keep the catch-all proxy because the feature is an API boundary around Zammad.

- `GET /api/mailbox-proxy/mailboxes?storeId=...`
  - Requires `storeId`.
  - Validates store belongs to `ctx.tenantId`.
  - Returns active mailboxes for that store.

- `GET /api/mailbox-proxy/conversations?storeId=...&mailboxId=...`
  - Requires both `storeId` and numeric `mailboxId`.
  - Verifies the Zammad group belongs to an active mailbox for that store and tenant.
  - Calls Zammad ticket search by `group_id`.

- `GET /api/mailbox-proxy/conversations/:id?storeId=...`
  - Requires `storeId`.
  - Fetches the ticket from Zammad.
  - Verifies the ticket `group_id` belongs to an active mailbox for that store and tenant.

- `POST /api/mailbox-proxy/conversations/:id/threads?storeId=...`
  - Requires `storeId`.
  - Requires `ZammadUser`.
  - Verifies the ticket's mailbox is active and scoped to that store and tenant.
  - Sends a plain-text Zammad article.

- `PUT /api/mailbox-proxy/conversations/:id?storeId=...`
  - Requires `storeId`.
  - Requires `ZammadUser`.
  - Verifies the ticket's mailbox is active and scoped to that store and tenant.
  - Updates Zammad ticket state.

## Authorization Helpers

Replace user-assignment helpers with store-scoped helpers:

```ts
type MailboxAccessContext = {
  userId: string;
  role: string;
  tenantId: string;
  zammadUserId: number | null;
};

async function listStoreMailboxes(ctx: MailboxAccessContext, storeId: string) {}

async function requireActiveStoreMailbox(
  ctx: MailboxAccessContext,
  input: { storeId: string; zammadGroupId: number },
) {}

function requireZammadUser(ctx: MailboxAccessContext) {}
```

`canReply` and `canUpdateStatus` are removed. A user with the `mailboxes` feature and a valid `ZammadUser` can reply and update status for active store-scoped mailboxes in the tenant.

## Validation

`createMailboxSchema`:

- Requires `storeId`.
- Keeps `name`, `email`, `provider`, and Gmail/custom connection validation.
- Removes `importMode`.
- Does not accept arbitrary `historyWindowMonths`; the server uses a fixed 6-month policy.
- Rejects `assignments`.
- Stays strict.

`updateMailboxSchema`:

- Does not accept `storeId` in this phase.
- Keeps existing name/email/connection update rules.

Proxy validation:

- `storeId` is required for every operator proxy endpoint.
- `mailboxId` remains a positive integer because it is Zammad `group_id`.
- Reply/status body validation remains unchanged.

## Error Handling

- Missing `storeId` on any operator proxy route: `422`.
- Store not found or outside tenant: `404` for admin reads, `403` for operator access checks where hiding existence is preferable.
- Mailbox inactive/not app-managed: `403`.
- Ticket belongs to another tenant or store: `403`.
- Missing `ZammadUser` on reply/status: keep the existing localized operator message.
- Zammad upstream 401/403/502/timeout: keep the current generic `502` behavior for operators.
- Validation errors from Zammad: keep current `422` mapping where available.

Logs and audit metadata must include safe identifiers only. Do not log tokens, passwords, or raw inbound/outbound payloads.

## Next.js 16 Constraints

The implementation must follow the local `next-best-practices` skill and the repo AGENTS instructions:

- This repo uses Next `16.2.4`.
- `params` and `searchParams` are promises in pages, layouts, and route handlers; type and await them.
- Client Components must not be async.
- Server Components should fetch initial read data directly where practical, then pass JSON-serializable props to Client Components.
- Serialize `Date` values to strings before passing them to Client Components.
- Use route handlers for this feature's Zammad/admin/proxy API boundary. Do not rewrite this phase to Server Actions.
- If a Client Component uses `useSearchParams`, wrap it in a Suspense boundary. Prefer reading `searchParams` in the server page and passing `initialStoreId` to the client.
- Keep Node.js runtime default. Do not set `runtime = "edge"`.
- Use top-level static imports. Do not add dynamic imports inside functions except for documented AGENTS exceptions.

## File Impact

Expected files to change during implementation:

- `prisma/schema.prisma`
- new Prisma migration(s)
- `src/lib/zammad/auth.ts`
- `src/lib/zammad/admin-validation.ts`
- `src/app/api/admin/mailboxes/route.ts`
- `src/app/api/admin/mailboxes/[id]/route.ts`
- `src/app/api/admin/mailboxes/[id]/status/route.ts`
- `src/app/api/admin/mailboxes/[id]/assignments/route.ts` removed or made unreachable
- `src/app/api/mailbox-proxy/[...path]/route.ts`
- `src/app/(authed)/admin/mailboxes/page.tsx`
- `src/app/(authed)/admin/mailboxes/MailboxList.tsx`
- `src/app/(authed)/admin/mailboxes/CreateMailboxModal.tsx`
- `src/app/(authed)/admin/mailboxes/EditMailboxModal.tsx`
- `src/app/(authed)/admin/mailboxes/AssignUsersModal.tsx` removed
- `src/app/(authed)/mailboxes/page.tsx`
- `src/app/(authed)/mailboxes/MailboxesClient.tsx`
- focused Zammad/mailbox tests

## Testing Plan

Focused tests should cover:

- Prisma schema source test for `Mailbox.tenantId`, `Mailbox.storeId`, relations, and indexes.
- Validation tests proving `createMailboxSchema` requires `storeId`, rejects `assignments`, rejects `importMode`, and rejects arbitrary history-window fields.
- Admin list/create tests or source tests proving store scoping by `tenantId + storeId`.
- Admin create tests or source tests proving no `all_archive` / `all` sync-all mode remains and creation uses the fixed six-month policy.
- Operator proxy tests or source tests proving:
  - mailbox list requires `storeId`
  - list returns only active mailboxes for the selected store
  - conversation list verifies mailbox store ownership
  - detail/reply/status reject tickets whose `group_id` maps to another tenant or store
- UI source tests proving:
  - admin mailbox page has store selection and no assignment modal/action
  - operator inbox waits for explicit store selection before fetching mailboxes
- Existing Zammad client/type/validation tests should continue to pass because the Zammad REST contract is unchanged.

## Open Operational Note

Before production deployment, existing mailbox rows must be mapped to stores. If the environment is disposable, reset/backfill can be manual. If production data exists, use the two-step migration and do not enforce `NOT NULL` until all rows have `tenant_id` and `store_id`.
