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
  ├── Users                  ← 1 Freescout user per platform operator (auto-provisioned)
  └── Permissions            ← operator assigned to mailboxes in Freescout admin UI
```

The app stores only the Freescout API key per operator. Mailbox configuration (IMAP host, SMTP credentials, provider settings) lives entirely in Freescout and is managed by SUPER_ADMIN directly in the Freescout admin panel.

---

## Data Model

### New table: `freescout_credentials`

```prisma
model FreescoutCredential {
  id              String   @id @default(cuid())
  userId          String   @unique @map("user_id")
  freescoutUserId Int      @map("freescout_user_id")
  apiKeyEncrypted Bytes    @map("api_key_encrypted")
  updatedAt       DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id])

  @@map("freescout_credentials")
}
```

Encryption uses the existing `src/lib/crypto/envelope.ts` (AES-256-GCM, same as `InkhubCredential`).

### New env vars

```
FREESCOUT_URL=https://inbox.yourdomain.com   # self-hosted Freescout base URL (configurable)
FREESCOUT_ADMIN_API_KEY=xxx                  # admin API key for provisioning new users
```

---

## Provisioning Flow

### When a new operator is created

1. Platform creates the `User` record as normal.
2. Server calls `POST {FREESCOUT_URL}/api/users` with `FREESCOUT_ADMIN_API_KEY` to create a matching Freescout user (same email).
3. Freescout returns a user ID and API key.
4. Platform encrypts the API key and saves `FreescoutCredential` row.

### When an operator is disabled

- Platform disables the platform user (existing flow).
- Optionally: call `PUT {FREESCOUT_URL}/api/users/{id}` to disable the Freescout user too (prevents direct Freescout access).

### Mailbox assignment

- Done entirely in Freescout admin UI by SUPER_ADMIN.
- No in-app flow needed — Freescout's permission system handles which users see which mailboxes.
- Operator automatically sees only mailboxes assigned to them when their API key is used.

---

## API Proxy

`GET|POST|PUT /api/mailbox-proxy/[...path]`

- Reads the current operator's `FreescoutCredential.apiKeyEncrypted`, decrypts it.
- Forwards the request to `{FREESCOUT_URL}/api/{path}` with `Authorization: Bearer <api_key>`.
- Returns the Freescout JSON response as-is.
- Returns 404 if the operator has no `FreescoutCredential` (not yet provisioned).

No HTML proxying — this is a pure REST API proxy, not an iframe proxy.

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

- **No credential provisioned:** "Tài khoản của bạn chưa được cấu hình. Vui lòng liên hệ SUPER_ADMIN."
- **No mailboxes assigned:** "Bạn chưa được assign vào mailbox nào. Vui lòng liên hệ SUPER_ADMIN."
- **No conversations:** "Không có email nào trong mục này."

---

## Freescout API endpoints used

| Action | Freescout API |
|--------|--------------|
| List mailboxes | `GET /api/mailboxes` |
| List conversations | `GET /api/conversations?mailboxId=X&status=open` |
| Get conversation + thread | `GET /api/conversations/{id}` |
| Reply to conversation | `POST /api/conversations/{id}/threads` |
| Change status | `PUT /api/conversations/{id}` with `{ status: "closed" }` |
| Create user (provisioning) | `POST /api/users` (admin key) |

---

## RBAC

- Add `mailboxes` to `FEATURES` const in `src/lib/auth/roles.ts`.
- Seed default: ADMIN gets `mailboxes`; OPERATOR gets `mailboxes`.
- SUPER_ADMIN always has full access (hardcoded).
- SUPER_ADMIN can revoke `mailboxes` from any role via the ACL UI.

---

## Error Handling

- If Freescout is unreachable: proxy returns 502, UI shows "Không thể kết nối đến hệ thống email. Vui lòng thử lại sau."
- If API key is invalid/expired: proxy returns 401, UI shows "Phiên đăng nhập hết hạn. Liên hệ SUPER_ADMIN để cấp lại."
- Network errors in Reply/Status actions: show toast error, don't close the conversation.

---

## Out of scope

- Composing new outbound emails (only reply to existing conversations).
- Attachment upload in replies (view attachments only).
- Email search (Freescout search can be added later).
- Freescout mailbox config UI inside the app (SUPER_ADMIN uses Freescout admin panel directly).
- Mobile-optimized layout.
