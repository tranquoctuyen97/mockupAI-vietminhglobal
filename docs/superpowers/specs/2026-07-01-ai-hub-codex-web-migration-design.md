# AI Hub Codex Web Migration Design

## Goal

Move AI Hub from the current Codex Mobile runtime to `codex-web`, using the existing website auth, RBAC, workspace bootstrap, and iframe flow.

Target runtime fork:

```text
git@github.com:tranquoctuyen97/codex-web.git
```

The member flow should stay the same:

```text
member -> /ai-hub -> /api/codex-proxy -> codex-web fork -> Codex CLI
```

The visible UI/runtime changes from Codex Mobile to Codex Web. The website remains the permission source.

## Scope

In scope:

- Replace the AI Hub runtime from `codexapp` / Codex Mobile to the `codex-web` fork.
- Keep `/ai-hub`, `/admin/ai-hub`, `ai_hub` RBAC, workspace tables, and workspace bootstrap.
- Update the app proxy default upstream to `codex-web`.
- Patch the `codex-web` fork to fetch member workspace allowlists from the app.
- Reject project open/start requests in `codex-web` when the path is outside the member allowlist.
- Add a controlled sync helper for updating the fork from upstream.

Out of scope:

- Per-member Linux users, processes, or containers.
- A generic AI provider abstraction.
- A permission engine inside `codex-web`.
- Direct public exposure of `codex-web`.

## Architecture

`/ai-hub` remains an authenticated app page. It validates the website session, checks the `ai_hub` feature, bootstraps the member private workspace plus shared workspace, and renders an iframe pointed at `/api/codex-proxy/`.

`/api/codex-proxy/[[...path]]` remains the only browser-facing gateway to the Codex runtime. It validates the website session, checks `ai_hub`, strips spoofed internal headers, injects the real member id, and proxies to the internal `codex-web` runtime.

`codex-web` runs as the shared service runtime. It does not decide who has AI Hub access. It only uses the member id and internal token provided by the app proxy to fetch the workspace allowlist and reject paths outside that allowlist.

Security boundary stays the same as the current docs: a single shared Linux runtime user is a soft workspace guard, not hard OS isolation. Members share the service user's Codex credentials, MCP servers, skills, and filesystem capability.

## Runtime

PM2 `mockupai-codex` changes from:

```text
npx codexapp --no-tunnel --port 18923
```

to a pinned fork install:

```text
npx --yes git+ssh://git@github.com/tranquoctuyen97/codex-web.git#<pinned-commit-or-tag>
```

Production must pin a commit or tag, not a floating branch.

Runtime env:

```text
PORT=8214
CODEX_CLI_PATH=/path/to/codex
HOME=<AI_HUB_RUNTIME_HOME>
CODEX_HOME=<AI_HUB_RUNTIME_HOME>/.codex
AI_HUB_WORKSPACES_URL=<app-origin>/api/internal/ai-hub/workspaces?provider=codex
AI_HUB_INTERNAL_TOKEN=<secret>
```

The app proxy default upstream changes from `http://127.0.0.1:18923` to `http://127.0.0.1:8214`.

Codex auth stays scoped to `CODEX_HOME`. The service runtime should not use a developer's personal `~/.codex`.

## Proxy Behavior

The app proxy keeps the existing responsibilities:

- validate the website session;
- check `ai_hub`;
- strip spoofed internal headers;
- forward only safe request headers;
- inject `X-Internal-Member-Id`;
- keep `AI_HUB_INTERNAL_TOKEN` server-side;
- rewrite redirects and asset URLs when `codex-web` emits absolute paths.

If realtime or WebSocket traffic does not work through the Next route handler, the fallback is a small internal Node proxy behind website auth. Do not switch this phase to a public direct Nginx route.

## Codex Web Fork Patch

The fork patch should stay small.

Project/folder picker loads workspaces from:

```http
GET /api/internal/ai-hub/workspaces?provider=codex
X-Internal-Member-Id: <member_id>
Authorization: Bearer <AI_HUB_INTERNAL_TOKEN>
```

Response:

```json
[
  { "name": "My workspace", "path": "/srv/ai-hub/members/u_123" },
  { "name": "Common", "path": "/srv/ai-hub/common" }
]
```

`codex-web` should cache the allowlist for 30-60 seconds per member id.

Every route that opens or starts a project must reject paths outside the allowlist before calling Codex CLI. Path checks should use normalized paths and allow descendants of allowed roots.

Log only:

- member id;
- selected path;
- allow or reject;
- timestamp.

Do not log prompts, responses, file content, or secrets.

## Admin UI

Keep the existing admin concept:

```text
Codex account: not_connected | waiting_for_device_auth | connected
Runtime: stopped | online | errored | unknown
Proxy: reachable | unreachable
Actions: connect, disconnect, restart
```

Update labels or help text that still says Codex Mobile so they say Codex Web or AI Hub runtime.

Connect/disconnect/status still target the service `CODEX_HOME`.

## Fork Upgrade Helper

Add a controlled sync helper:

```bash
npm run ai-hub:codex-web:sync
```

The helper should:

1. fetch the fork `tranquoctuyen97/codex-web`;
2. fetch upstream `0xcaff/codex-web`;
3. merge or rebase upstream latest into the patch branch;
4. run the fork's minimal tests or smoke checks when available;
5. print the new commit SHA or tag.

It must not update the production pin, deploy, or restart PM2. Promotion remains manual after verification.

Upgrade flow:

```text
sync fork -> verify /ai-hub -> verify workspace allowlist -> verify path reject -> update pin -> restart PM2
```

## Testing

App tests:

- update source tests for the new PM2 command and port `8214`;
- keep route tests proving `/ai-hub` checks session, RBAC, workspace bootstrap, and renders iframe;
- keep workspace tests;
- update proxy tests for `codex-web` asset/API path shapes after the fork is inspected.

Fork smoke checks:

- member A sees private A plus shared workspace;
- member A does not see member B workspace;
- member A cannot open/start a project under member B's path;
- shared workspace still opens.

Manual verification:

- open `/ai-hub` as a member with `ai_hub`;
- confirm Codex Web UI renders in the iframe;
- confirm admin status sees account/runtime/proxy;
- restart runtime from `/admin/ai-hub`;
- run the controlled sync helper without changing production pin.

## Self Review

- No placeholder values are required beyond deployment pins and paths that must be environment-specific.
- Scope is a single migration from Codex Mobile runtime to Codex Web runtime plus the required fork patch.
- The app remains the permission source; `codex-web` remains a thin runtime UI.
- Production does not auto-track upstream latest.
