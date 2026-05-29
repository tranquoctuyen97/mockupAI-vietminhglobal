# Mailbox Management (Freescout Integration) — Design Spec

**Date:** 2026-05-22

---

## Goal

Embed a multi-mailbox shared inbox inside the platform, allowing operators to read and reply to emails from multiple stores (Gmail, Outlook, custom SMTP, etc.) without leaving the app. Built on a self-hosted Freescout instance as the email backend, with a custom React UI inside the app consuming Freescout's REST API.

---

## Context

- The platform already has an Auto Fulfill tab that embeds InkHub via iframe proxy.
- This feature follows a different pattern: **no iframe** — instead, a custom React inbox UI calls Freescout's REST API through a lightweight server-side proxy.
- Freescout is a self-hosted, open-source HelpScout clone (PHP/Laravel) that supports any IMAP/SMTP mailbox provider.

---

## Architecture

```
App (Next.js)
  ├── /mailboxes tab         ← React UI
  └── /api/mailbox-proxy/*  ← server-side proxy to Freescout REST API

Freescout (self-hosted, e.g. inbox.grabink.co)
  ├── Mailboxes              ← configured by SUPER_ADMIN in Freescout admin UI
  │     (Gmail, Outlook, custom SMTP — any IMAP/SMTP provider)
  ├── Users                  ← linked to platform operators for audit/reply identity
  └── API & Webhooks module  ← required to expose the REST API

App database
  ├── FreescoutUser          ← platform user ↔ Freescout user mapping
  └── UserMailboxAccess      ← platform-enforced mailbox access mapping
```

The app uses one server-only `FREESCOUT_ADMIN_API_KEY` to call Freescout. It does not store Freescout API keys per operator and does not rely on Freescout API keys to enforce operator mailbox scope. Mailbox configuration (IMAP host, SMTP credentials, provider settings) lives entirely in Freescout and is managed by SUPER_ADMIN directly in the Freescout admin panel.

Authorization is enforced by the app:

- RBAC controls whether the user can access the Mailboxes feature.
- `UserMailboxAccess` controls which Freescout mailboxes the user can list, read, reply to, and close.
- The proxy validates every request before forwarding it with the admin API key.

---

## Data Model

### New table: `freescout_users`

```prisma
model FreescoutUser {
  id              String   @id @default(cuid())
  userId          String   @unique @map("user_id")
  freescoutUserId Int      @map("freescout_user_id")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id])

  @@map("freescout_users")
}
```

### New table: `user_mailbox_access`

```prisma
model UserMailboxAccess {
  id                 String   @id @default(cuid())
  userId             String   @map("user_id")
  freescoutMailboxId Int      @map("freescout_mailbox_id")
  mailboxName        String?  @map("mailbox_name")
  canReply           Boolean  @default(true) @map("can_reply")
  canClose           Boolean  @default(true) @map("can_close")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, freescoutMailboxId])
  @@index([freescoutMailboxId])
  @@map("user_mailbox_access")
}
```

This mapping is the source of truth for platform mailbox authorization. Phase 1 can manage it through seed/admin scripts; a dedicated admin UI can be added later if needed.

### New env vars

```
FREESCOUT_URL=https://inbox.yourdomain.com   # self-hosted Freescout base URL (configurable)
FREESCOUT_ADMIN_API_KEY=xxx                  # server-only API key from Manage » API & Webhooks
```

The Freescout API & Webhooks module must be installed and enabled before this feature can work.

---

## Provisioning Flow

### When a new operator is created

1. Platform creates the `User` record as normal.
2. Server calls `POST {FREESCOUT_URL}/api/users` with `X-FreeScout-API-Key: FREESCOUT_ADMIN_API_KEY` to create a matching regular Freescout user.
3. Freescout returns the created resource ID. The app stores it in `FreescoutUser.freescoutUserId`.
4. If the email already exists in Freescout, the provisioning flow must link to the existing Freescout user instead of failing permanently. If the API cannot look up users by email in the installed module version, log a recoverable provisioning error and require SUPER_ADMIN to link the user manually.

Freescout's Create User API does not send invitation emails, does not update existing users, and does not grant default mailbox permissions. This design intentionally does not expect `POST /api/users` to return a per-user API key.

### When an operator is disabled

- Platform disables the platform user (existing flow).
- Phase 1 does not need to disable the Freescout user because app access is blocked by the platform user status.
- Optional follow-up: call `PUT {FREESCOUT_URL}/api/users/{id}` to disable or update the Freescout user too, if the live Freescout instance supports the desired user status workflow.

### Mailbox assignment

- Mailbox IMAP/SMTP configuration is done in Freescout admin UI by SUPER_ADMIN.
- Platform mailbox access is stored in `UserMailboxAccess`.
- The app may mirror Freescout mailbox assignments, but the proxy must still enforce `UserMailboxAccess` on every request.

---

## API Proxy

`GET|POST|PUT /api/mailbox-proxy/[...path]`

- Requires authenticated platform user.
- Requires `hasFeature("mailboxes")`.
- Rejects all non-allowlisted paths and methods with 403.
- Does not forward arbitrary client headers.
- Adds only these outbound headers:
  - `X-FreeScout-API-Key: <FREESCOUT_ADMIN_API_KEY>`
  - `Accept: application/json`
  - `Content-Type: application/json`
- Redacts API keys from logs, errors, and telemetry.

No HTML proxying — this is a pure REST API proxy, not an iframe proxy.

### Allowed proxy routes

| Client route | Freescout route | Authorization rule |
|--------------|-----------------|--------------------|
| `GET /api/mailbox-proxy/mailboxes` | `GET /api/mailboxes` | Return only mailboxes present in `UserMailboxAccess` for the current user. |
| `GET /api/mailbox-proxy/conversations?mailboxId=X&status=open&page=1&pageSize=25` | `GET /api/conversations?mailboxId=X&status=open&page=1&pageSize=25&sortField=updatedAt&sortOrder=desc` | Require access to mailbox `X`. `mailboxId` is required. |
| `GET /api/mailbox-proxy/conversations/:id` | `GET /api/conversations/:id?embed=threads` | Fetch detail, then require access to `conversation.mailboxId` before returning it. |
| `POST /api/mailbox-proxy/conversations/:id/threads` | `POST /api/conversations/:id/threads` | Require conversation mailbox access and `canReply = true`. Server injects `user`. |
| `PUT /api/mailbox-proxy/conversations/:id` | `PUT /api/conversations/:id` | Require conversation mailbox access. Status changes require `canClose = true`. Server injects `byUser`. |

### Request shaping

Clients send only product-level intent. The server shapes Freescout payloads.

Reply request from client:

```json
{
  "text": "Reply content"
}
```

Freescout payload sent by proxy:

```json
{
  "type": "message",
  "text": "Reply content",
  "user": 33,
  "status": "active"
}
```

The proxy uses `FreescoutUser.freescoutUserId` as `user`. Depending on the live Freescout behavior, the proxy may also need to include `to`, `cc`, or `bcc`; those values must be derived server-side from the conversation/customer data, not accepted blindly from the client.

Status request from client:

```json
{
  "status": "closed"
}
```

Freescout payload sent by proxy:

```json
{
  "byUser": 33,
  "status": "closed"
}
```

Allowed status values for phase 1: `active`, `pending`, `closed`.

---

## UI Components

### Feature flag

Feature key: `mailboxes` — controlled via the existing RBAC ACL system. SUPER_ADMIN and ADMIN have it by default; OPERATOR gets it if assigned.

### Navigation

New sidebar entry: **Mailboxes** (visible only if `hasFeature("mailboxes")`).

### Page structure

```
/mailboxes                   → MailboxesPage (server component)
  └── MailboxesClient        → (client component)
        ├── MailboxSidebar
        │     ├── Mailbox list (fetched from /api/mailbox-proxy/mailboxes)
        │     └── Status filters: Open / Pending / Closed
        └── ConversationPanel
              ├── ConversationList  (fetched from /api/mailbox-proxy/conversations)
              │     └── ConversationRow (subject, from, snippet, date, assignee)
              └── ConversationDetail (shown when a row is selected)
                    ├── ThreadView     (email chain, newest at bottom)
                    ├── ReplyComposer  (textarea + Send button)
                    └── StatusActions  (Close / Pending / Reopen)
```

### Empty states

- **No Freescout user linked:** "Tài khoản email của bạn chưa được cấu hình. Vui lòng liên hệ SUPER_ADMIN."
- **No mailboxes assigned:** "Bạn chưa được assign vào mailbox nào. Vui lòng liên hệ SUPER_ADMIN."
- **No conversations:** "Không có email nào trong mục này."

---

## Freescout API endpoints used

| Action | Freescout API |
|--------|--------------|
| List mailboxes | `GET /api/mailboxes` |
| List conversations | `GET /api/conversations?mailboxId=X&status=open` |
| Get conversation + thread | `GET /api/conversations/{id}?embed=threads` |
| Reply to conversation | `POST /api/conversations/{id}/threads` |
| Change status | `PUT /api/conversations/{id}` with `{ byUser: 33, status: "closed" }` |
| Create user (provisioning) | `POST /api/users` (admin key) |

All Freescout API requests use `X-FreeScout-API-Key`, not `Authorization: Bearer`.

---

## RBAC

- Add `mailboxes` to `FEATURES` const in `src/lib/auth/roles.ts`.
- Seed default: ADMIN gets `mailboxes`; OPERATOR gets `mailboxes`.
- SUPER_ADMIN always has full access (hardcoded).
- SUPER_ADMIN can revoke `mailboxes` from any role via the ACL UI.

---

## Error Handling

- If Freescout is unreachable: proxy returns 502, UI shows "Không thể kết nối đến hệ thống email. Vui lòng thử lại sau."
- If `FREESCOUT_ADMIN_API_KEY` is invalid/expired: proxy returns 502 to operators and logs a redacted admin-facing error.
- If the platform user lacks `mailboxes`: return 403 and show "Bạn không có quyền truy cập Mailboxes."
- If the user has no `FreescoutUser` mapping: return 404 and show the "No Freescout user linked" empty state.
- If the user has no mailbox access: return an empty mailbox list and show the "No mailboxes assigned" empty state.
- If a requested conversation is not in an allowed mailbox: return 403, not 404, so permission issues are auditable.
- If Freescout returns 404 for a real missing conversation: proxy returns 404 and UI shows "Email này không còn tồn tại hoặc đã bị xóa."
- If Freescout returns a conflict/validation error on reply or status update: proxy returns 409 or 422 with a normalized message; UI keeps the conversation open.
- Network errors in Reply/Status actions: show toast error, don't close the conversation.

### Audit

The app must write an audit log entry for:

- Reply sent.
- Status changed.
- Permission-denied reply/status attempt.

Audit fields: `platformUserId`, `freescoutUserId`, `conversationId`, `mailboxId`, `action`, `result`, `createdAt`.

---

## Refresh and Pagination

- Conversation list uses `page`, `pageSize`, `mailboxId`, `status`, and server-enforced `updatedAt desc` sorting.
- Default `pageSize`: 25.
- UI polling interval: 30-60 seconds while the Mailboxes page is visible.
- Webhooks are out of scope for phase 1, but the Freescout API & Webhooks module is still required for API access.

---

## Implementation Checklist

- Use `X-FreeScout-API-Key`; do not use Bearer auth.
- Do not store or expect per-operator Freescout API keys.
- Add `FreescoutUser` and `UserMailboxAccess`.
- Enforce proxy path/method allowlist.
- Require `mailboxId` for list conversations.
- Append `embed=threads` for conversation detail.
- Inject `user` for reply and `byUser` for status changes.
- Redact API keys from logs.
- Map 401/403/404/409/422/502 errors clearly.
- Handle existing Freescout users during provisioning by link/retry/manual-link flow.

---

## Testing Plan

- Unit test route allowlist rejects unsupported paths and methods.
- Unit test proxy headers use `X-FreeScout-API-Key` and never forward client auth headers.
- Unit test `GET /mailboxes` filters Freescout mailbox response by `UserMailboxAccess`.
- Unit test `GET /conversations` requires `mailboxId` and rejects unauthorized mailbox IDs.
- Unit test conversation detail appends `embed=threads` and checks returned `mailboxId`.
- Unit test reply injects `user = freescoutUserId` and rejects missing `canReply`.
- Unit test status update injects `byUser = freescoutUserId` and rejects missing `canClose`.
- Integration/mock test maps Freescout 401/403/404/409/422/502 to normalized app responses.
- Log test confirms API keys are redacted.

---

## Out of scope

- Composing new outbound emails (only reply to existing conversations).
- Attachment upload in replies (view attachments only).
- Email search (Freescout search can be added later).
- Freescout mailbox config UI inside the app (SUPER_ADMIN uses Freescout admin panel directly).
- Mobile-optimized layout.
- Webhook-based real-time updates.
