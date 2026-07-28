# ADMIN MCP Connection Guide

The public MCP endpoint is:

```text
${APP_PUBLIC_URL}/mcp
```

`SUPER_ADMIN` grants or removes the role-level `mcp_access` permission. Each eligible
`ADMIN` then opens **Account → MCP** and owns their own profile, defaults, OAuth grants,
and personal access tokens. A permission restoration never resumes a suspended profile;
the ADMIN must select **Resume MCP**.

## Production runtime

The deployment has two application origins:

- Next.js: `http://127.0.0.1:${PORT}` for the UI and OAuth routes.
- MCP: `http://127.0.0.1:${MCP_PORT}` for exact path `/mcp`.

Nginx exposes both through `APP_PUBLIC_URL`. Keep the MCP process bound to
`127.0.0.1`; do not expose port `3101` directly. Required environment values:

```dotenv
APP_PUBLIC_URL="https://app.example.com"
MCP_HOST="127.0.0.1"
MCP_PORT="3101"
MCP_ALLOWED_HOSTS="app.example.com,127.0.0.1:3101"
MCP_ALLOWED_ORIGINS="https://app.example.com"
MCP_REVISION_SECRET="<at-least-32-random-bytes>"
DATABASE_URL="<same-database-as-next-and-worker>"
REDIS_URL="<same-writable-redis-as-worker>"
UPLOAD_DIR="/absolute/writable/path/uploads"
```

After deployment:

```bash
pm2 status
pm2 logs mockupai-mcp --lines 100
curl -i https://app.example.com/mcp
```

An unauthenticated protocol response is expected from the last command; a connection
refusal or Nginx 404 is not.

## Personal access token

From **Account → MCP**, choose **Personal access token**, keep all effective tool groups
selected or narrow them, create the credential, and copy the one-time secret.

Claude-style HTTP configuration:

```text
URL: https://app.example.com/mcp
Authorization: Bearer <YOUR_PERSONAL_TOKEN>
```

Codex configuration:

```toml
[mcp_servers.mockupai]
url = "https://app.example.com/mcp"
bearer_token_env_var = "MOCKUPAI_MCP_TOKEN"
```

Set `MOCKUPAI_MCP_TOKEN` in the Codex process environment. Do not paste a live token into
repository config.

n8n configuration:

```text
MCP URL: https://app.example.com/mcp
Authorization: Bearer {{ $env.MOCKUPAI_MCP_TOKEN }}
```

## OAuth 2.1 with PKCE

Clients that support MCP OAuth discovery should use the public MCP URL and dynamic client
registration. The app exposes registration, authorization, and token routes on the same
public Next.js origin:

```text
POST /api/mcp/oauth/register
GET|POST /api/mcp/oauth/authorize
POST /api/mcp/oauth/token
```

The public client must use authorization code plus `S256` PKCE. Redirect URIs are exact
matches. The ADMIN grants only scopes currently inherited from their role; later role
grants do not silently expand an existing OAuth grant.

Example registration metadata:

```json
{
  "client_name": "Claude Desktop",
  "redirect_uris": ["http://127.0.0.1:<client-callback-port>/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

## Local development with ngrok

To expose the app and its `/mcp` endpoint through one public origin, run the Next app and
MCP process, proxy `/mcp` locally as in `setup-nginx.sh`, then expose that proxy port. If
you are testing without a local reverse proxy, expose the app for OAuth/UI and the raw MCP
port separately and configure the client with the MCP tunnel URL.

Common app-origin setup:

```bash
pnpm dev
pnpm mcp
ngrok http 3000
```

Set the resulting HTTPS hostname in `APP_PUBLIC_URL`, `MCP_ALLOWED_HOSTS`, and
`MCP_ALLOWED_ORIGINS`, then restart both processes. The recommended local parity setup is
to put Nginx/Caddy on port `3000` and route exact `/mcp` to `3101`.

To import a local design or custom mockup file by URL, serve image bytes from another
local port and expose that server:

```bash
python3 -m http.server 8080 --directory /absolute/path/to/images
ngrok http 8080
```

Pass the exact URL such as `https://<image-tunnel>/design.png`. Verify it returns raw PNG
or JPEG bytes:

```bash
curl -I https://<image-tunnel>/design.png
```

The response must be the image itself, not an ngrok browser-warning/interstitial HTML
page. Imported URL assets remain private and draft-scoped; they do not appear in Design
Library or Mockup Library.

## Tool documentation

An eligible ADMIN can open **Account → Tools** before activating a profile. The UI is
generated from the same 16-entry runtime catalog and includes each parameter description,
required feature, annotations, structured output, common errors, and redacted examples.
The approved human-readable catalog is
`docs/superpowers/specs/2026-07-24-admin-mcp-tools-catalog.md`.
