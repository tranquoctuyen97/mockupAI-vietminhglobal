# Zammad Mailbox Management — Technical Design & Implementation

> **Last updated**: 2026-05-30
> **Status**: Implemented (Phase 1 + Phase 2)
> **Backend**: Zammad self-hosted (REST API)

---

## 1. Overview

### What

App-managed mailbox system that lets SUPER_ADMIN/ADMIN create, configure, and assign email mailboxes to platform users — all from within the app UI. Zammad handles actual IMAP/SMTP operations; the app acts as a control panel.

### Why

- Admin should never need to log into Zammad admin UI
- Credentials stored only in Zammad, never in our database
- Operator inbox reads from app-managed `Mailbox` records, not raw Zammad groups
- Full audit trail for all mailbox operations

### Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│   Next.js App       │     │   Zammad Instance     │
│                     │     │                       │
│ ┌─ Admin UI ──────┐ │     │ ┌─ Email Channel ──┐  │
│ │ Create/Edit     │─┼────▶│ │ IMAP fetch       │  │
│ │ Test Connection │ │     │ │ SMTP send        │  │
│ │ Assign Users    │ │     │ └──────────────────┘  │
│ └─────────────────┘ │     │                       │
│                     │     │ ┌─ Groups ──────────┐  │
│ ┌─ Operator View ─┐ │     │ │ = Mailbox        │  │
│ │ /mailboxes      │─┼────▶│ └──────────────────┘  │
│ │ Read tickets    │ │     │                       │
│ │ Reply/Status    │ │     │ ┌─ Tickets ─────────┐ │
│ └─────────────────┘ │     │ │ = Conversations   │  │
│                     │     │ │ Articles = Thread  │  │
│ ┌─ Local DB ──────┐ │     │ └──────────────────┘  │
│ │ Mailbox table   │ │     │                       │
│ │ UserMailboxAccess│ │     │ Auth: Token token=... │
│ │ ZammadUser      │ │     └──────────────────────┘
│ └─────────────────┘ │
└─────────────────────┘
```

---

## 2. Concept Mapping

| App Concept       | Zammad Concept       | Notes                                    |
|-------------------|----------------------|------------------------------------------|
| Mailbox           | Group + Email Channel| Group routes tickets; Channel does IMAP/SMTP |
| Conversation      | Ticket               | Search via `/api/v1/tickets/search`      |
| Thread / Messages | Ticket Articles      | Each article = one email or reply        |
| Reply             | Create Article       | `POST /api/v1/ticket_articles`           |
| Status            | Ticket State         | `active→open`, `pending→pending`, `closed→closed` |
| Mailbox Config    | Email Channel        | Created via `channels_email_verify`      |

---

## 3. Environment Variables

```env
ZAMMAD_URL=https://your-zammad.example.com   # No trailing slash
ZAMMAD_ADMIN_TOKEN=abc123...                  # Admin API token with full access
```

- **Token type**: `Authorization: Token token=${ZAMMAD_ADMIN_TOKEN}`
- **Token creation**: Zammad Admin → Profile → Token Access → Create (admin permissions)
- **Security**: Server-only. Never exposed to client. Redacted from all logs.

---

## 4. Database Schema

### `ZammadUser` — Maps app user → Zammad user

```prisma
model ZammadUser {
  id           String   @id @default(cuid())
  userId       String   @unique              // FK → User.id
  zammadUserId Int                           // Zammad internal user ID
  @@map("zammad_users")
}
```

Required for reply/status operations. Without this mapping, user can read but not write.

### `UserMailboxAccess` — Per-user mailbox permissions

```prisma
model UserMailboxAccess {
  userId          String
  zammadGroupId   Int                        // Zammad group ID
  mailboxName     String?                    // Cached for display
  canReply        Boolean  @default(true)
  canUpdateStatus Boolean  @default(true)
  @@unique([userId, zammadGroupId])
  @@map("user_mailbox_access")
}
```

- SUPER_ADMIN bypasses this table entirely (virtual full access)
- ADMIN/OPERATOR require explicit rows

### `Mailbox` — App-managed mailbox metadata

```prisma
model Mailbox {
  id              String   @id @default(cuid())
  name            String                     // Display name
  email           String                     // Email address
  provider        String                     // "gmail" | "custom"
  zammadGroupId   Int      @unique           // Linked Zammad group
  zammadChannelId Int?     @unique           // Linked Zammad email channel
  isActive        Boolean  @default(true)
  @@map("mailboxes")
}
```

**Critical**: No IMAP/SMTP passwords stored here. Zammad is the sole credential store.

---

## 5. Security Model

### 5.1 Access Control Matrix

| Role         | Admin Config (`/admin/mailboxes`) | Operator Inbox (`/mailboxes`) |
|--------------|-----------------------------------|-------------------------------|
| SUPER_ADMIN  | ✅ Full access                    | ✅ All mailboxes, all perms   |
| ADMIN        | ✅ Full access                    | ✅ Assigned mailboxes only    |
| OPERATOR     | ❌ Always 403                     | ✅ Assigned mailboxes only    |

### 5.2 Guards

**Admin routes** (`/api/admin/mailboxes/*`):
```
requireMailboxAdmin()
  1. validateSession() → 401 if not authenticated
  2. hasFeature("mailboxes") → 403 if feature disabled
  3. role ∈ {SUPER_ADMIN, ADMIN} → 403 if OPERATOR
```

**Operator routes** (`/api/mailbox-proxy/*`):
```
requireFeature("mailboxes")
  + getMailboxAuthContext()
  + requireActiveMailbox(groupId) → 403 if Mailbox.isActive=false
  + getMailboxAccess(ctx, groupId) → 403 if no UserMailboxAccess row
  + per-action permission: canReply, canUpdateStatus
```

### 5.3 `isActive` Enforcement

`Mailbox.isActive` is checked on **every** operator proxy operation:
- `GET /mailboxes` — only active mailboxes listed
- `GET /conversations` — blocked if mailbox disabled
- `GET /conversations/:id` — blocked if ticket's mailbox disabled
- `POST /conversations/:id/reply` — blocked
- `PUT /conversations/:id/status` — blocked

### 5.4 Assignment Rules

- ADMIN can assign ADMIN + OPERATOR users
- SUPER_ADMIN can assign any user
- SUPER_ADMIN is **never assigned** — they have implicit access to all

### 5.5 Credential Security

| Rule                          | Implementation                                      |
|-------------------------------|------------------------------------------------------|
| No passwords in app DB        | Only Zammad stores IMAP/SMTP credentials             |
| No passwords in logs          | `redactPasswords()` strips all `*password*` fields   |
| No passwords in audit logs    | Audit `metadata` only contains name/email/IDs        |
| Password mask on update       | Send `**********` to Zammad = keep existing password |
| No raw channel payloads       | Audit never logs inbound/outbound config objects     |

---

## 6. Zammad API Reference

### 6.1 Authentication

All requests use header:
```
Authorization: Token token=${ZAMMAD_ADMIN_TOKEN}
```

### 6.2 Key Endpoints

| Operation          | Method | Endpoint                           | Timeout |
|--------------------|--------|------------------------------------|---------|
| List groups        | GET    | `/api/v1/groups`                   | 10s     |
| Create group       | POST   | `/api/v1/groups`                   | 10s     |
| Update group       | PUT    | `/api/v1/groups/:id`               | 10s     |
| Delete group       | DELETE | `/api/v1/groups/:id`               | 10s     |
| Auto-probe email   | POST   | `/api/v1/channels_email_probe`     | 10s     |
| Test inbound       | POST   | `/api/v1/channels_email_inbound`   | 10s     |
| Test outbound      | POST   | `/api/v1/channels_email_outbound`  | 10s     |
| Verify/create      | POST   | `/api/v1/channels_email_verify`    | **45s** |
| List channels      | GET    | `/api/v1/channels_email`           | 10s     |
| Enable channel     | POST   | `/api/v1/channels_email_enable`    | 10s     |
| Disable channel    | POST   | `/api/v1/channels_email_disable`   | 10s     |
| Search tickets     | GET    | `/api/v1/tickets/search`           | 10s     |
| Get ticket         | GET    | `/api/v1/tickets/:id`              | 10s     |
| Get articles       | GET    | `/api/v1/ticket_articles/by_ticket/:id` | 10s |
| Create article     | POST   | `/api/v1/ticket_articles`          | 10s     |
| Update ticket      | PUT    | `/api/v1/tickets/:id`              | 10s     |

### 6.3 Encryption Mapping

| App Value    | Zammad Inbound `ssl` | Zammad Outbound `ssl` |
|--------------|----------------------|-----------------------|
| `ssl`        | `"ssl"`              | `true`                |
| `starttls`   | `"starttls"`         | `true`                |
| `none`       | `"false"`            | `false`               |

### 6.4 Password Masking

Zammad automatically masks passwords as `**********` in GET responses. On PUT/update:
- Send `**********` → Zammad keeps existing password
- Send new password → Zammad updates it

### 6.5 `channels_email_verify` Behavior

- **Blocks up to 30s** performing real email delivery test
- Returns only `{ "result": "ok" }` — no channel ID
- Channel ID must be extracted via `findChannelByGroupId()` after verify

---

## 7. Mailbox Create Flow & Rollback

```
Step 1: createGroup({ name })
  └─ fail? → return 502

Step 2: testEmailInbound(inbound)
  └─ fail? → deleteGroup(groupId) → return 422

Step 3: testEmailOutbound(outbound)
  └─ fail? → deleteGroup(groupId) → return 422

Step 4: verifyEmailChannel({ group_id, inbound, outbound, meta })
  └─ fail? → deleteGroup(groupId) → return 422

Step 5: findChannelByGroupId(groupId, email)
  └─ null? → warn (channel exists but ID extraction failed)

Step 6: prisma.mailbox.create(...)
  └─ fail? → disableEmailChannel(channelId) + deleteGroup(groupId) → return 500
            ↳ log CRITICAL with IDs (no secrets) if rollback fails

Step 7: upsert UserMailboxAccess (optional)

Step 8: logAudit (no credentials)

→ return 201 { mailbox }
```

### `findChannelByGroupId` — Hardened Matching

1. Filter `Email::Account` channels only (exclude notification channels)
2. Must match `group_id` AND `active=true`
3. If multiple matches → prefer one matching the mailbox email
4. If still ambiguous → return `null` + log error for manual cleanup

---

## 8. API Routes

### Admin Routes (`/api/admin/mailboxes/*`)

All use `requireMailboxAdmin()` — OPERATOR always denied.

| Route                                    | Method | Purpose                      |
|------------------------------------------|--------|------------------------------|
| `/api/admin/mailboxes`                   | GET    | List all mailboxes + counts  |
| `/api/admin/mailboxes`                   | POST   | Create mailbox (full flow)   |
| `/api/admin/mailboxes/probe`             | POST   | Auto-discover IMAP/SMTP      |
| `/api/admin/mailboxes/test-connection`   | POST   | Test inbound/outbound        |
| `/api/admin/mailboxes/:id`               | GET    | Mailbox detail               |
| `/api/admin/mailboxes/:id`               | PUT    | Update name/email/connection |
| `/api/admin/mailboxes/:id/status`        | POST   | Enable/disable (no DELETE)   |
| `/api/admin/mailboxes/:id/assignments`   | GET    | List assigned users          |
| `/api/admin/mailboxes/:id/assignments`   | PUT    | Bulk update assignments      |

### Operator Proxy Routes (`/api/mailbox-proxy/*`)

| Route                                         | Method | Purpose              |
|------------------------------------------------|--------|----------------------|
| `/api/mailbox-proxy/mailboxes`                | GET    | List active mailboxes|
| `/api/mailbox-proxy/conversations`            | GET    | List by mailboxId    |
| `/api/mailbox-proxy/conversations/:id`        | GET    | Ticket + articles    |
| `/api/mailbox-proxy/conversations/:id/reply`  | POST   | Create article       |
| `/api/mailbox-proxy/conversations/:id/status` | PUT    | Update ticket state  |

---

## 9. Validation Schemas

### Create (`createMailboxSchema`)
- `name`: required, max 200
- `email`: valid email
- `provider`: `"gmail"` | `"custom"`
- `fromName`: optional, max 200
- `inbound`: host, port (1-65535), encryption (ssl|starttls|none), username, **password required**
- `outbound`: same, **password required**
- `assignments`: optional array of `{ userId, canReply, canUpdateStatus }`
- All schemas use `.strict()` — extra fields rejected

### Update (`updateMailboxSchema`)
- All fields optional
- `inbound.password` and `outbound.password` **optional** — blank = keep existing

### Reply (`validateReplyBody`)
- Body treated as plain text (`content_type: "text/plain"`)
- Max 50,000 chars, trimmed, non-empty
- No HTML rejection — XSS prevented at render time by escaping

---

## 10. File Map

```
src/
├── lib/
│   ├── auth/
│   │   └── mailbox-admin-guard.ts    # requireMailboxAdmin()
│   └── zammad/
│       ├── types.ts                  # All Zammad API types
│       ├── client.ts                 # Zammad HTTP client + admin helpers
│       ├── auth.ts                   # MailboxAuthContext, access checks
│       ├── validation.ts             # Operator reply/status validation
│       └── admin-validation.ts       # Admin Zod schemas + encryption mapping
├── app/
│   ├── (authed)/
│   │   ├── admin/mailboxes/
│   │   │   ├── page.tsx              # Admin mailbox list page
│   │   │   ├── MailboxList.tsx        # Table component
│   │   │   ├── CreateMailboxModal.tsx # 2-step wizard (info → connection)
│   │   │   ├── EditMailboxModal.tsx   # Edit with optional connection change
│   │   │   └── AssignUsersModal.tsx   # ADMIN/OPERATOR assignment table
│   │   └── mailboxes/
│   │       ├── page.tsx              # Operator inbox page
│   │       └── MailboxesClient.tsx    # Operator inbox client component
│   └── api/
│       ├── admin/mailboxes/          # Admin API routes (6 files)
│       └── mailbox-proxy/            # Operator proxy route
tests/
├── zammad-admin-validation.test.ts   # 26 tests — schemas + encryption
└── zammad-admin-client.test.ts       # 5 tests — password redaction
```

---

## 11. Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Zammad over FreeScout** | FreeScout API module is paid; Zammad REST API is free and fully featured |
| **No local password storage** | Zammad is sole credential store. App sends passwords once on create, never stores them |
| **Disable-only, no delete** | Prevents orphaning tickets and breaking audit history |
| **Separate admin guard** | OPERATOR has `mailboxes` feature (for inbox) but must NOT access admin config |
| **Local `Mailbox` table** | Operator list uses app records, not raw Zammad groups — hides system groups like "Users" |
| **`isActive` on all ops** | Disabled mailbox blocks everything, not just listing |
| **45s timeout for verify** | `channels_email_verify` blocks up to 30s for delivery test |
| **Gmail App Password** | Google OAuth out of scope for Phase 2 |
| **Plain text replies** | `content_type: "text/plain"` — XSS prevented by escaping at render, not by rejecting `<>` chars |

---

## 12. Deployment Checklist

1. Set `ZAMMAD_URL` and `ZAMMAD_ADMIN_TOKEN` in `.env`
2. Run `npx prisma migrate deploy` (creates 3 tables)
3. Run `npx prisma generate`
4. Verify: `curl -H "Authorization: Token token=$TOKEN" $ZAMMAD_URL/api/v1/groups`
5. Log in as SUPER_ADMIN → Admin → Mailbox Config → Create first mailbox
6. Assign users from the assignment modal
7. Operators see mailboxes at `/mailboxes`

---

## 13. Future Scope (Not Implemented)

- **Google OAuth** for Gmail without App Passwords
- **Import existing Zammad channels** into app
- **Hard delete** with ticket migration
- **Webhook integration** for real-time ticket updates
- **Per-mailbox signature** configuration

---

## Appendix A: Zammad API Spike Results

> Tested against local Zammad Docker Compose instance.
> All calls used `Authorization: Token token=<admin_token>`.

### A.1 Phase 1 Spike — Core API (Groups, Tickets, Articles)

#### A.1.1 List Groups — `GET /api/v1/groups`

**Response**: Array of group objects. Always includes system group `"Users"` (id: 1).

```json
[
  {
    "id": 1,
    "name": "Users",
    "name_last": "Users",
    "active": true,
    "note": "Standard Group/Pool for Tickets.",
    "email_address_id": null,
    "signature_id": null,
    "created_at": "2026-05-28T...",
    "updated_at": "2026-05-28T..."
  },
  {
    "id": 2,
    "name": "Support",
    "name_last": "Support",
    "active": true,
    "note": null,
    "email_address_id": 1,
    "signature_id": null,
    "created_at": "2026-05-28T...",
    "updated_at": "2026-05-28T..."
  }
]
```

**Gotcha**: `"Users"` group is always present but is a system group — should be hidden from operators. This is why we use the local `Mailbox` table for operator listing.

#### A.1.2 Create Group — `POST /api/v1/groups`

**Request**:
```json
{ "name": "Sales", "active": true }
```

**Response** (201):
```json
{
  "id": 3,
  "name": "Sales",
  "name_last": "Sales",
  "active": true,
  "note": null,
  "email_address_id": null,
  "signature_id": null,
  "created_at": "2026-05-28T...",
  "updated_at": "2026-05-28T..."
}
```

**Gotcha**: Group name must be unique. Duplicate name returns 422.

#### A.1.3 Search Tickets — `GET /api/v1/tickets/search`

**Request**: `?query=group_id:2&limit=10&page=1&sort_by=updated_at&order_by=desc`

**Response**:
```json
[
  {
    "id": 1,
    "group_id": 2,
    "number": "67001",
    "title": "Test email subject",
    "state_id": 1,
    "state": "new",
    "priority_id": 2,
    "customer_id": 3,
    "owner_id": 1,
    "created_at": "2026-05-28T...",
    "updated_at": "2026-05-28T..."
  }
]
```

**Key findings**:
- `state` field is a string: `"new"`, `"open"`, `"pending reminder"`, `"pending close"`, `"closed"`
- Our app maps: `active → ["new","open"]`, `pending → ["pending reminder","pending close"]`, `closed → ["closed"]`
- Pagination: `limit` + `page` params. No `totalElements` in response — must infer from result count
- `sort_by=updated_at&order_by=desc` works as expected
- Query syntax: `group_id:N` filters by Zammad group. Can combine: `group_id:2 AND state:open`

#### A.1.4 Get Ticket Detail — `GET /api/v1/tickets/:id`

**Response**: Single ticket object (same shape as search result, but more fields):
```json
{
  "id": 1,
  "group_id": 2,
  "number": "67001",
  "title": "Test email subject",
  "state_id": 1,
  "state": "new",
  "priority_id": 2,
  "customer_id": 3,
  "customer": "customer@example.com",
  "owner_id": 1,
  "note": null,
  "first_response_at": null,
  "close_at": null,
  "created_at": "2026-05-28T...",
  "updated_at": "2026-05-28T..."
}
```

**Gotcha**: 404 for non-existent ticket ID. No wrapping object — returns the ticket directly.

#### A.1.5 Get Ticket Articles — `GET /api/v1/ticket_articles/by_ticket/:ticket_id`

**Response**: Array of article objects, ordered by `created_at` asc:
```json
[
  {
    "id": 1,
    "ticket_id": 1,
    "type_id": 1,
    "type": "email",
    "sender_id": 2,
    "sender": "Customer",
    "from": "customer@example.com",
    "to": "support@example.com",
    "cc": null,
    "subject": "Test email subject",
    "body": "This is the email body content",
    "content_type": "text/html",
    "internal": false,
    "created_at": "2026-05-28T...",
    "updated_at": "2026-05-28T...",
    "created_by_id": 3,
    "attachments": []
  }
]
```

**Key findings**:
- `sender`: `"Customer"` (inbound) or `"Agent"` (reply from operator)
- `type`: `"email"`, `"note"` (internal), `"phone"`, `"web"`
- `internal: true` means internal note, not visible to customer
- `content_type`: usually `"text/html"` for incoming email, `"text/plain"` for our replies
- `attachments`: array of `{ id, filename, size, preferences }` — not implemented in our UI yet

#### A.1.6 Create Reply — `POST /api/v1/ticket_articles`

**Request**:
```json
{
  "ticket_id": 1,
  "body": "Thank you for contacting us. We will look into this.",
  "content_type": "text/plain",
  "type": "email",
  "internal": false,
  "sender": "Agent"
}
```

**Response** (201): Created article object.

**Key findings**:
- `type: "email"` sends actual email to customer
- `type: "note"` creates internal note only (not sent)
- `sender: "Agent"` is required for outbound replies
- `content_type: "text/plain"` — we always send plain text for safety
- `from`/`to` fields are **auto-populated** by Zammad from the channel config — no need to specify
- If ticket state is `"new"`, Zammad auto-changes it to `"open"` after first agent reply

#### A.1.7 Update Ticket State — `PUT /api/v1/tickets/:id`

**Request**:
```json
{ "state": "closed" }
```

**Response**: Updated ticket object.

**State mapping tested**:
| App status | Zammad search states             | Zammad update state      |
|------------|----------------------------------|--------------------------|
| `active`   | `["new", "open"]`                | `"open"`                 |
| `pending`  | `["pending reminder", "pending close"]` | `"pending reminder"` |
| `closed`   | `["closed"]`                     | `"closed"`               |

**Gotcha**: Cannot set state to `"new"` — it's auto-assigned on creation only.

---

### A.2 Phase 2 Spike — Email Channel Management

#### A.2.1 Auto-Probe — `POST /api/v1/channels_email_probe`

**Request**:
```json
{
  "email": "support@gmail.com",
  "password": "abcd-efgh-ijkl-mnop"
}
```

**Response (success)**:
```json
{
  "result": "ok",
  "setting": {
    "inbound": {
      "adapter": "imap",
      "options": {
        "host": "imap.gmail.com",
        "port": "993",
        "ssl": "ssl",
        "user": "support@gmail.com",
        "password": "abcd-efgh-ijkl-mnop",
        "folder": "inbox"
      }
    },
    "outbound": {
      "adapter": "smtp",
      "options": {
        "host": "smtp.gmail.com",
        "port": 587,
        "start_tls": true,
        "user": "support@gmail.com",
        "password": "abcd-efgh-ijkl-mnop"
      }
    }
  }
}
```

**Response (failure)**:
```json
{
  "result": "failed",
  "message": "error message from server",
  "message_human": "Human-readable error description"
}
```

**Key findings**:
- Probe auto-detects IMAP/SMTP settings from email domain
- Works best with Gmail — auto-fills host/port/ssl
- Custom domains may fail → fallback to manual inbound/outbound test
- Response includes **plaintext password** (not masked) — we never store or log this
- Outbound uses `start_tls` boolean, not `ssl` string (differs from inbound)

#### A.2.2 Test Inbound — `POST /api/v1/channels_email_inbound`

**Request**:
```json
{
  "adapter": "imap",
  "options": {
    "host": "imap.gmail.com",
    "port": "993",
    "ssl": "ssl",
    "user": "support@gmail.com",
    "password": "abcd-efgh-ijkl-mnop",
    "folder": "inbox"
  }
}
```

**Response (success)**: `{ "result": "ok" }`

**Response (failure)**:
```json
{
  "result": "invalid",
  "message_human": "Authentication failed, username or password incorrect.",
  "invalid_field": { "user": true, "password": true }
}
```

**Key findings**:
- `ssl` field is a **string**, not boolean: `"ssl"`, `"starttls"`, or `"false"`
- `port` is a **string**, not number (Zammad quirk)
- `invalid_field` tells you which field caused the failure
- Takes 3-8s for Gmail, can timeout on unreachable hosts

#### A.2.3 Test Outbound — `POST /api/v1/channels_email_outbound`

**Request**:
```json
{
  "adapter": "smtp",
  "options": {
    "host": "smtp.gmail.com",
    "port": 587,
    "ssl": true,
    "user": "support@gmail.com",
    "password": "abcd-efgh-ijkl-mnop"
  },
  "email": "support@gmail.com"
}
```

**Response (success)**: `{ "result": "ok" }`

**Key findings**:
- `ssl` field is a **boolean** here (unlike inbound which uses string)
- `port` is a **number** here (unlike inbound which uses string)
- `email` field at root level is required — used as the test recipient
- Both `ssl: true` and `starttls` map to `ssl: true` for Zammad outbound
- Only `none` maps to `ssl: false`

#### A.2.4 Verify & Create Channel — `POST /api/v1/channels_email_verify`

**Request**:
```json
{
  "meta": {
    "realname": "Support Team",
    "email": "support@gmail.com"
  },
  "group_id": 3,
  "inbound": {
    "adapter": "imap",
    "options": {
      "host": "imap.gmail.com",
      "port": "993",
      "ssl": "ssl",
      "user": "support@gmail.com",
      "password": "abcd-efgh-ijkl-mnop",
      "folder": "inbox"
    }
  },
  "outbound": {
    "adapter": "smtp",
    "options": {
      "host": "smtp.gmail.com",
      "port": 587,
      "ssl": true,
      "user": "support@gmail.com",
      "password": "abcd-efgh-ijkl-mnop"
    }
  }
}
```

**Response (success)**:
```json
{ "result": "ok" }
```

**Response (failure)**:
```json
{
  "result": "invalid",
  "message": "...",
  "message_human": "...",
  "source": "inbound"
}
```

**Critical findings**:
- **Blocks 10-30 seconds** — Zammad sends a real test email and waits for delivery
- **No channel ID in response** — only `{ "result": "ok" }`
- Must call `GET /api/v1/channels_email` after to find the newly created channel
- Creates both an `Email::Account` channel AND an `EmailAddress` record
- `group_id` links the new channel to the specified Zammad group
- `channel_id` in request body = update existing channel (omit for create)
- If `source: "inbound"` in error → inbound config is wrong; `"outbound"` → SMTP is wrong
- `"duplicate"` result means this email address already has a channel

#### A.2.5 List Email Channels — `GET /api/v1/channels_email`

**Response**:
```json
{
  "account_channel_ids": [1, 2],
  "notification_channel_ids": [3],
  "email_address_ids": [1, 2],
  "assets": {
    "Channel": {
      "1": {
        "id": 1,
        "group_id": 2,
        "area": "Email::Account",
        "active": true,
        "options": {
          "inbound": {
            "adapter": "imap",
            "options": {
              "host": "imap.gmail.com",
              "port": "993",
              "ssl": "ssl",
              "user": "support@gmail.com",
              "password": "**********",
              "folder": "inbox"
            }
          },
          "outbound": {
            "adapter": "smtp",
            "options": {
              "host": "smtp.gmail.com",
              "port": 587,
              "ssl": true,
              "user": "support@gmail.com",
              "password": "**********"
            }
          }
        },
        "status_in": "ok",
        "status_out": "ok"
      }
    }
  }
}
```

**Critical findings**:
- Channels are in `assets.Channel` — keyed by string ID, not array
- `area: "Email::Account"` = real mailbox channels
- `area: "Email::Notification"` = system notification channel (skip these)
- Passwords are **always masked** as `"**********"` in responses
- `status_in` / `status_out`: `"ok"` means working, `"error"` means connectivity issue
- `group_id` links channel → group → our Mailbox
- Our `findChannelByGroupId()` filters: `area === "Email::Account"` AND `active === true` AND `group_id === target`

#### A.2.6 Enable/Disable Channel

**Enable** — `POST /api/v1/channels_email_enable`
```json
{ "id": 1 }
```
Response: `{ }` (empty on success)

**Disable** — `POST /api/v1/channels_email_disable`
```json
{ "id": 1 }
```
Response: `{ }` (empty on success)

**Key findings**:
- Disabling stops IMAP polling — no new emails fetched
- Existing tickets remain accessible
- Re-enabling resumes polling immediately
- Used in our rollback cascade when DB save fails after channel creation

#### A.2.7 Delete Group — `DELETE /api/v1/groups/:id`

**Response**: 200 with empty body on success.

**Key findings**:
- Cannot delete group if it has tickets assigned — returns 422
- Can delete empty group (no tickets)
- Used in rollback cascade when channel creation or DB save fails
- System group `"Users"` (id: 1) cannot be deleted

---

### A.3 API Quirks & Gotchas Summary

| Quirk | Detail |
|-------|--------|
| **Inbound port is string** | `"993"` not `993` — Zammad stores as string |
| **Outbound port is number** | `587` not `"587"` — inconsistent with inbound |
| **Inbound ssl is string** | `"ssl"`, `"starttls"`, `"false"` |
| **Outbound ssl is boolean** | `true` or `false` |
| **Password mask** | Always `"**********"` (10 asterisks) in GET responses |
| **Verify has no channel ID** | Must extract via channel list after successful verify |
| **Verify blocks 10-30s** | Real SMTP delivery test — set 45s timeout |
| **Search has no total count** | Must infer: if `results.length < limit` → last page |
| **Groups include system "Users"** | Always filter or use local Mailbox table |
| **State "new" is auto-only** | Cannot manually set state to "new" via API |
| **First reply auto-changes state** | "new" → "open" on first agent article |
| **Channel area types** | `"Email::Account"` = mailbox, `"Email::Notification"` = system |
| **Probe returns plaintext password** | Never log or store probe response |
| **Gmail needs App Password** | 2FA + App Password; regular password won't work |
| **Duplicate email = error** | `channels_email_verify` returns `"duplicate"` if email already has channel |
