# AI Hub Codex Mobile Design

## Goal

Add an `AI Hub` tab so internal members can use Codex Mobile from the MockupAI app without logging in to Codex/OpenAI themselves.

Phase 1 uses one shared Codex runtime on the VPS:

```text
member browser
  -> /ai-hub
  -> iframe /api/codex-proxy/
  -> codexapp on 127.0.0.1:18923
  -> Codex CLI/runtime as codexbot
  -> VPS workspaces and tools
```

The implementation should follow the current Auto Fulfill pattern: a full-height app page with an iframe, plus an authenticated Next API proxy in front of the upstream app.

## Decisions

- Add a new RBAC feature key: `ai_hub`.
- Use iframe + internal API proxy, not direct Nginx proxy, for phase 1.
- Add an admin page at `/admin/ai-hub`.
- Manage the Codex Mobile runtime through PM2 as `mockupai-codex`.
- Use one Linux user, `codexbot`, and one shared Codex account.
- Accept soft isolation in phase 1: workspace allowlists guard UX and app routes, but they are not OS-level isolation.
- Use generic AI Hub workspace table names so future non-Codex tools can reuse the model.

## Architecture

`/ai-hub` is an authenticated page in the main sidebar. It uses the same special full-height shell treatment as `/auto-fulfill` and renders:

```tsx
<iframe src="/api/codex-proxy/" title="AI Hub" />
```

The request flow:

```text
member login
  -> AI Hub sidebar tab
  -> /ai-hub page
  -> iframe /api/codex-proxy/
  -> session + ai_hub permission check
  -> workspace bootstrap for the member
  -> proxy to http://127.0.0.1:18923
```

MCP servers, skills, and Codex credentials belong to the `codexbot` runtime, not the website session. If `codexbot` can use an MCP server or skill on the VPS, members using AI Hub can use it too. Because this is shared, MCPs with broad filesystem or shell access must be treated as shared-team privileges.

## Data Model

Use generic names:

```text
ai_hub_workspaces
  id
  tenant_id
  name
  path
  type        private | shared
  provider    codex
  created_at

ai_hub_member_workspaces
  user_id
  workspace_id
  created_at
```

Phase 1 only uses `provider = "codex"`.

Do not add teams, projects, or per-tool permission engines in phase 1. Add those only when there is a real workflow that needs them.

## Workspace Flow

When a member opens `/ai-hub`:

1. Validate session.
2. Check `ai_hub` permission.
3. Ensure private folder exists at `${AI_HUB_MEMBERS_ROOT}/${user.id}`.
4. Ensure a private `ai_hub_workspaces` row exists for that path.
5. Ensure the shared folder exists at `${AI_HUB_SHARED_ROOT}`.
6. Ensure a shared `ai_hub_workspaces` row exists for that path.
7. Ensure member mappings exist for private + shared workspaces.
8. Render the iframe.

Workspace bootstrap must be idempotent.

The internal workspace endpoint for patched Codex Mobile:

```http
GET /api/internal/ai-hub/workspaces?provider=codex
Authorization: Bearer AI_HUB_INTERNAL_TOKEN
X-Internal-Member-Id: <user_id>
```

Response:

```json
[
  { "name": "My workspace", "path": "/srv/ai-hub/members/u_123" },
  { "name": "Common", "path": "/srv/ai-hub/common" }
]
```

Codex Mobile must reject project-open/start requests when the requested path is outside the returned allowlist.

## Admin Runtime

Add `/admin/ai-hub`, guarded by admin role plus `ai_hub`.

Show three status groups:

```text
Codex account:
  not_connected | waiting_for_device_auth | connected

Runtime:
  stopped | online | errored | unknown

Proxy:
  reachable | unreachable
```

Actions:

- `Connect Codex`: start Codex device auth for the `codexbot` user and show the login URL/code to the admin.
- `Check status`: check Codex login status, PM2 runtime status, and proxy reachability.
- `Restart runtime`: restart PM2 process `mockupai-codex`.

Do not build a generic process manager. The admin UI only wraps these AI Hub runtime operations.

## PM2 Runtime

Add a PM2 app:

```text
name: mockupai-codex
command: npx codexapp --no-tunnel --port 18923
user: codexbot on VPS deployment
bind: 127.0.0.1 only
```

The public internet must not reach port `18923` directly. Browser access goes through the app proxy.

## Proxy Behavior

`/api/codex-proxy/[[...path]]` should:

- Return `401` when there is no app session.
- Return `403` when the member lacks `ai_hub`.
- Strip any client-supplied internal member/workspace headers.
- Set server-owned member headers before proxying upstream.
- Bootstrap workspaces before serving the proxy root page.
- Forward requests to `http://127.0.0.1:18923`.
- Preserve method, query string, request body, and relevant content headers.
- Support WebSocket/upgrade traffic if Next route handlers can do so reliably.
- Rewrite root asset paths only if Codex Mobile requires it.

If Next route handlers cannot reliably proxy WebSocket/upgrade traffic, use the smallest fallback: a tiny internal Node proxy process behind the same app auth boundary. Do not switch the whole design to Nginx unless the API proxy path is proven unworkable.

## Error Handling

Member-facing states:

- Missing permission: show the existing locked-access style message.
- Codex not connected: show an admin-contact message; admins get a link to `/admin/ai-hub`.
- Runtime offline: show an offline message with retry; admins get restart action in `/admin/ai-hub`.
- Proxy unreachable: show retry and log the upstream failure.

Security logs should record member id, provider, workspace path, action, and timestamp for project open/start events.

## Testing

Minimum checks:

- `FEATURES` includes `ai_hub`.
- Permissions UI includes `AI Hub`.
- `/ai-hub` denies users without `ai_hub`.
- `/ai-hub` renders the iframe for users with `ai_hub`.
- Workspace bootstrap creates private + shared mappings idempotently.
- Internal workspace endpoint returns only the current member allowlist.
- Proxy strips spoofed `X-Internal-Member-Id`.
- Admin status endpoint handles `connected`, `not_connected`, `runtime offline`, and `proxy unreachable`.

## Out of Scope

- Per-member Linux users, containers, or hard OS isolation.
- Multiple Codex accounts.
- Team/project workspace hierarchy.
- A generic process manager.
- A non-Codex AI tool inside AI Hub.
- Nginx-first proxying.
