# Zammad Setup Guide

> **Zammad is a separate self-hosted service.** It is NOT part of this Next.js app repo.
> The app connects to Zammad via REST API using a server-only admin token (`ZAMMAD_ADMIN_TOKEN`).

## 1. Requirements

- **Zammad instance** — self-hosted via Docker Compose (recommended) or bare-metal
- **Services required by Zammad**: PostgreSQL, Elasticsearch, Redis, Memcached
- The official Zammad Docker Compose handles all dependencies automatically

## 2. Local Development (Docker Compose)

Clone the official Zammad Docker setup:

```bash
cd infra/
git clone https://github.com/zammad/zammad-docker-compose.git zammad
cd zammad
```

Create `.env` file:

```env
NGINX_EXPOSE_PORT=8050
TZ=Asia/Ho_Chi_Minh
```

Start:

```bash
docker compose up -d
```

Wait ~2 minutes for initialization. Access: `http://localhost:8050`

Complete the Setup Wizard:
1. Create admin account (e.g. `admin@example.com`)
2. Set organization name
3. Configure email channel (optional for spike, can skip)

## 3. Create API Token

### Via Web UI (Recommended)
1. Log in as admin at `http://localhost:8050`
2. Click avatar icon (bottom-left) → **Profile**
3. Go to **Token Access** tab
4. Click **Create**
5. Name: `app-proxy`
6. Select permissions: **admin**, **ticket.agent**
7. Click Create
8. **Copy the token immediately** — it is only shown once

### Via Rails Console (Docker)
```bash
docker exec zammad-zammad-railsserver-1 /opt/zammad/bin/rails runner '
user = User.find_by(login: "admin@example.com")
token = Token.create!(
  action: "api", user_id: user.id, persistent: true,
  name: "app-proxy",
  preferences: { permission: ["admin", "ticket.agent"] }
)
puts "TOKEN: #{token.token}"
'
```

## 4. Environment Variables

Set in your `.env`:

```env
ZAMMAD_URL=http://localhost:8050
ZAMMAD_ADMIN_TOKEN=<your-token-here>
```

For production:
```env
ZAMMAD_URL=https://inbox.yourdomain.com
ZAMMAD_ADMIN_TOKEN=<production-token>
```

> ⚠️ **ZAMMAD_ADMIN_TOKEN is server-only.** Never expose to the client.

## 5. Verify API Connection

```bash
# List groups (= mailboxes)
curl -s http://localhost:8050/api/v1/groups \
  -H "Authorization: Token token=YOUR_TOKEN" | python3 -m json.tool

# List tickets
curl -s 'http://localhost:8050/api/v1/tickets/search?query=*&limit=5' \
  -H "Authorization: Token token=YOUR_TOKEN" | python3 -m json.tool
```

## 6. Get Group IDs

Groups in Zammad map to "Mailboxes" in the app UI.

```bash
curl -s http://localhost:8050/api/v1/groups \
  -H "Authorization: Token token=YOUR_TOKEN" \
  | python3 -c "
import json, sys
for g in json.load(sys.stdin):
    print(f'  id={g[\"id\"]} name={g[\"name\"]} active={g[\"active\"]}')
"
```

## 7. Configure Email Channel (Production)

1. Go to **Admin** → **Channels** → **Email**
2. Click **Add Email Account**
3. Configure:
   - **Inbound**: IMAP host, port, user, password
   - **Outbound**: SMTP host, port, user, password
   - **Group**: Assign to a group (this is the "mailbox")
4. Test connection

When a mailbox is created or updated from the app, the app enforces
`keep_on_server: true` on the Zammad email channel before marking the mailbox as
active. Email may still be marked as read in Gmail after Zammad fetches it.
`keep_on_server` only ensures email is not deleted from the original server.

## 8. Seed ZammadUser and Mailbox Access

Link a platform user to their Zammad user ID and grant group access:

```bash
# Step 1: Find user's Zammad ID
curl -s http://localhost:8050/api/v1/users \
  -H "Authorization: Token token=YOUR_TOKEN" \
  | python3 -c "
import json, sys
for u in json.load(sys.stdin):
    print(f'  id={u[\"id\"]} email={u[\"email\"]} login={u[\"login\"]}')
"

# Step 2: Link platform user to Zammad user + grant group access
pnpm tsx scripts/seed-zammad-user.ts \
  --email operator@example.com \
  --zammad-user-id 3 \
  --group-id 1 \
  --mailbox-name "Support Inbox" \
  --can-reply true \
  --can-update-status true
```

## 9. Concept Mapping

| App UI | Zammad Concept | API Endpoint |
|--------|---------------|--------------|
| Mailbox | Group | `GET /api/v1/groups` |
| Conversation | Ticket | `GET /api/v1/tickets/search` |
| Thread | Ticket Article | `GET /api/v1/ticket_articles/by_ticket/:id` |
| Reply | Create Article | `POST /api/v1/ticket_articles` |
| Status (Open/Pending/Closed) | Ticket State | `PUT /api/v1/tickets/:id` |

### Status Mapping

| App Status | Zammad State | state_id |
|-----------|-------------|----------|
| Open (active) | `new` or `open` | 1, 2 |
| Pending | `pending reminder` | 3 |
| Closed | `closed` | 4 |

> **Note:** Setting status to "Pending" automatically sets `pending_time` to 24 hours from now.
> A future UI update may add a date picker for custom pending time.

## 10. Smoke Test Checklist

After setup, verify these endpoints work through the app:

- [ ] `GET /api/mailbox-proxy/mailboxes` — returns list of Zammad groups
- [ ] `GET /api/mailbox-proxy/conversations?mailboxId=1&status=active` — returns tickets
- [ ] `GET /api/mailbox-proxy/conversations/1` — returns ticket detail + articles
- [ ] `POST /api/mailbox-proxy/conversations/1/threads` with `{ "text": "test" }` — creates article
- [ ] `PUT /api/mailbox-proxy/conversations/1` with `{ "status": "pending" }` — updates state
- [ ] `PUT /api/mailbox-proxy/conversations/1` with `{ "status": "closed" }` — closes ticket
- [ ] `PUT /api/mailbox-proxy/conversations/1` with `{ "status": "active" }` — reopens ticket
- [ ] Non-SUPER_ADMIN without `UserMailboxAccess` gets 403
- [ ] User without `ZammadUser` mapping gets 404 on reply/status
