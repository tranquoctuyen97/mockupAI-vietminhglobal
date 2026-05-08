# Auto-Fulfill Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhúng toàn bộ UI của `inkhub.grabink.co` vào MockupAI qua reverse proxy, với auto-login seamless và credential ẩn hoàn toàn khỏi admin.

**Architecture:** Hai Next.js API routes proxy toàn bộ traffic: `/api/inkhub-proxy/` phục vụ UI (inject token vào localStorage qua script trong HTML), `/api/inkhub-api/` proxy API calls (spoof origin header, inject Bearer token). Token Manager singleton on-server tự login và cache JWT 30 ngày. Admin chỉ cần login vào MockupAI.

**Tech Stack:** Next.js App Router API routes, Node.js `node:fetch`, `node:buffer`, lucide-react (`Truck` icon), Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-05-05-auto-fulfill-embed-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/inkhub/token.ts` | Create | Singleton: login, cache JWT, expose `getToken()` |
| `src/lib/inkhub/token.test.ts` | Create | Tests for token caching, refresh, orgId parsing |
| `src/lib/inkhub/proxy-utils.ts` | Create | Pure fns: `isTextContent`, `rewriteApiUrls`, `injectTokenScript` |
| `src/lib/inkhub/proxy-utils.test.ts` | Create | Tests for all 3 utils |
| `src/app/api/inkhub-api/[...path]/route.ts` | Create | API proxy: forward to `api-inkhub-v2.grabink.co`, inject auth |
| `src/app/api/inkhub-proxy/[...path]/route.ts` | Create | UI proxy: forward to `inkhub.grabink.co`, inject token script |
| `src/app/(authed)/auto-fulfill/page.tsx` | Create | Full-height iframe pointing to `/api/inkhub-proxy/` |
| `src/app/(authed)/AuthedShell.tsx` | Modify | Add "Auto Fulfill" nav item + skip padding wrapper on `/auto-fulfill` |
| `.env.example` | Modify | Add `INKHUB_USERNAME`, `INKHUB_PASSWORD` |

---

## Task 1: Env Vars

**Files:**
- Modify: `.env.example`
- Modify: `.env.local`

- [ ] **Step 1: Add vars to `.env.example`**

Append to the end of `.env.example`:
```
# Inkhub auto-fulfill platform credentials
INKHUB_USERNAME=
INKHUB_PASSWORD=
```

- [ ] **Step 2: Add actual values to `.env.local`**

Append to `.env.local`:
```
INKHUB_USERNAME=inkhub@vietminhglobal.com
INKHUB_PASSWORD=<actual_password>
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add INKHUB_USERNAME/PASSWORD env vars"
```

---

## Task 2: Token Manager

**Files:**
- Create: `src/lib/inkhub/token.ts`
- Create: `src/lib/inkhub/token.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/inkhub/token.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { getToken, _resetForTest } from "./token";

function makeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: 1, exp: expSeconds })).toString("base64url");
  return `${header}.${payload}.signature`;
}

test("calls login once and caches token", async () => {
  _resetForTest();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return { ok: true, json: async () => ({ token: makeJwt(futureExp), organizations: [{ id: 1 }] }) } as Response;
  };
  await getToken();
  await getToken();
  assert.equal(callCount, 1);
});

test("returns correct orgId from organizations[0].id", async () => {
  _resetForTest();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ token: makeJwt(futureExp), organizations: [{ id: 42 }] }),
  } as Response);
  const { orgId } = await getToken();
  assert.equal(orgId, "42");
});

test("refreshes after _resetForTest simulates expiry", async () => {
  _resetForTest();
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return { ok: true, json: async () => ({ token: makeJwt(futureExp), organizations: [{ id: 1 }] }) } as Response;
  };
  await getToken();
  _resetForTest();
  await getToken();
  assert.equal(callCount, 2);
});

test("throws when login returns non-ok status", async () => {
  _resetForTest();
  globalThis.fetch = async () => ({ ok: false, status: 401 } as Response);
  await assert.rejects(() => getToken(), /Inkhub login failed: 401/);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd app && node --test --require tsx/cjs src/lib/inkhub/token.test.ts 2>&1
```

Expected: errors about missing module `./token`.

- [ ] **Step 3: Create `src/lib/inkhub/token.ts`**

```typescript
const LOGIN_URL = "https://api-inkhub-v2.grabink.co/api/auth/login";
const BUFFER_MS = 5 * 60 * 1000;

let cachedToken: string | null = null;
let cachedOrgId: string | null = null;
let expiresAt: number | null = null;
let loginPromise: Promise<void> | null = null;

function parseJwtExp(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf-8"));
  return payload.exp * 1000;
}

async function login(): Promise<void> {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.INKHUB_USERNAME,
      password: process.env.INKHUB_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Inkhub login failed: ${res.status}`);
  const data = (await res.json()) as { token: string; organizations: Array<{ id: number }> };
  cachedToken = data.token;
  cachedOrgId = String(data.organizations[0].id);
  expiresAt = parseJwtExp(data.token) - BUFFER_MS;
}

export async function getToken(): Promise<{ token: string; orgId: string }> {
  if (cachedToken && expiresAt && Date.now() < expiresAt) {
    return { token: cachedToken, orgId: cachedOrgId! };
  }
  if (!loginPromise) {
    loginPromise = login().finally(() => {
      loginPromise = null;
    });
  }
  await loginPromise;
  return { token: cachedToken!, orgId: cachedOrgId! };
}

export function _resetForTest(): void {
  cachedToken = null;
  cachedOrgId = null;
  expiresAt = null;
  loginPromise = null;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd app && node --test --require tsx/cjs src/lib/inkhub/token.test.ts 2>&1
```

Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inkhub/token.ts src/lib/inkhub/token.test.ts
git commit -m "feat: add InkhubTokenManager with JWT caching and auto-refresh"
```

---

## Task 3: Proxy Utils

**Files:**
- Create: `src/lib/inkhub/proxy-utils.ts`
- Create: `src/lib/inkhub/proxy-utils.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/inkhub/proxy-utils.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { isTextContent, rewriteApiUrls, injectTokenScript } from "./proxy-utils";

test("isTextContent: returns true for text types", () => {
  assert.equal(isTextContent("text/html; charset=utf-8"), true);
  assert.equal(isTextContent("text/javascript"), true);
  assert.equal(isTextContent("application/javascript"), true);
  assert.equal(isTextContent("text/css"), true);
});

test("isTextContent: returns false for binary types", () => {
  assert.equal(isTextContent("image/png"), false);
  assert.equal(isTextContent("font/woff2"), false);
  assert.equal(isTextContent("application/octet-stream"), false);
});

test("rewriteApiUrls: replaces all occurrences", () => {
  const input =
    'fetch("https://api-inkhub-v2.grabink.co/api/orders"); fetch("https://api-inkhub-v2.grabink.co/api/auth")';
  const result = rewriteApiUrls(input, "https://app.example.com");
  assert.ok(!result.includes("api-inkhub-v2.grabink.co"));
  assert.equal(result.match(/app\.example\.com\/api\/inkhub-api/g)?.length, 2);
});

test("rewriteApiUrls: leaves unrelated URLs unchanged", () => {
  const input = 'fetch("https://fonts.googleapis.com/css")';
  const result = rewriteApiUrls(input, "https://app.example.com");
  assert.equal(result, input);
});

test("injectTokenScript: injects before </head>", () => {
  const html = "<html><head><title>App</title></head><body></body></html>";
  const result = injectTokenScript(html, "tok123", "1");
  assert.ok(result.includes("localStorage.setItem('token','tok123')"));
  assert.ok(result.includes("localStorage.setItem('organizationId','1')"));
  assert.ok(result.indexOf("<script>") < result.indexOf("</head>"));
});

test("injectTokenScript: no-op when </head> absent", () => {
  const html = "<html><body>no head</body></html>";
  const result = injectTokenScript(html, "tok", "1");
  assert.equal(result, html);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd app && node --test --require tsx/cjs src/lib/inkhub/proxy-utils.test.ts 2>&1
```

Expected: errors about missing module `./proxy-utils`.

- [ ] **Step 3: Create `src/lib/inkhub/proxy-utils.ts`**

```typescript
export function isTextContent(contentType: string): boolean {
  return (
    contentType.includes("text/html") ||
    contentType.includes("text/javascript") ||
    contentType.includes("application/javascript") ||
    contentType.includes("text/css")
  );
}

export function rewriteApiUrls(body: string, host: string): string {
  return body.replaceAll("api-inkhub-v2.grabink.co", `${host}/api/inkhub-api`);
}

export function injectTokenScript(html: string, token: string, orgId: string): string {
  if (!html.includes("</head>")) return html;
  const script = `<script>localStorage.setItem('token','${token}');localStorage.setItem('organizationId','${orgId}');</script>`;
  return html.replace("</head>", `${script}</head>`);
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd app && node --test --require tsx/cjs src/lib/inkhub/proxy-utils.test.ts 2>&1
```

Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inkhub/proxy-utils.ts src/lib/inkhub/proxy-utils.test.ts
git commit -m "feat: add inkhub proxy utils (isTextContent, rewriteApiUrls, injectTokenScript)"
```

---

## Task 4: API Proxy Route

**Files:**
- Create: `src/app/api/inkhub-api/[...path]/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/inkhub-api/[...path]/route.ts`:

```typescript
import { getToken } from "@/lib/inkhub/token";
import type { NextRequest } from "next/server";

const UPSTREAM = "https://api-inkhub-v2.grabink.co";

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const upstreamUrl = `${UPSTREAM}/${path.join("/")}${request.nextUrl.search}`;

  const { token } = await getToken();

  const headers = new Headers();
  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("accept", request.headers.get("accept") ?? "application/json, text/plain, */*");
  headers.set("authorization", `Bearer ${token}`);
  headers.set("origin", "https://inkhub.grabink.co");
  headers.set("referer", "https://inkhub.grabink.co/");

  const body =
    request.method !== "GET" && request.method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined;

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body,
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("access-control-allow-origin", "*");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
```

- [ ] **Step 2: Smoke test with curl**

Start the dev server (`pnpm dev`) and test the login endpoint through the proxy:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/api/inkhub-api/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"test","password":"test"}'
```

Expected: `401` (bad credentials) or `200` (if real creds used). Not `500` or connection error.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/inkhub-api/[...path]/route.ts"
git commit -m "feat: add /api/inkhub-api proxy route for inkhub API calls"
```

---

## Task 5: UI Proxy Route

**Files:**
- Create: `src/app/api/inkhub-proxy/[...path]/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/inkhub-proxy/[...path]/route.ts`:

```typescript
import { getToken } from "@/lib/inkhub/token";
import { injectTokenScript, isTextContent, rewriteApiUrls } from "@/lib/inkhub/proxy-utils";
import type { NextRequest } from "next/server";

const UPSTREAM_UI = "https://inkhub.grabink.co";

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;
  const upstreamPath = path?.length ? `/${path.join("/")}` : "/";
  const upstreamUrl = `${UPSTREAM_UI}${upstreamPath}${request.nextUrl.search}`;

  const reqHeaders = new Headers();
  reqHeaders.set("accept", request.headers.get("accept") ?? "*/*");
  reqHeaders.set(
    "accept-language",
    request.headers.get("accept-language") ?? "en-US,en;q=0.9",
  );
  reqHeaders.set("accept-encoding", "identity"); // disable compression — we need to read and modify text
  reqHeaders.set(
    "user-agent",
    request.headers.get("user-agent") ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  );

  const upstream = await fetch(upstreamUrl, {
    method: "GET",
    headers: reqHeaders,
    redirect: "follow",
  });

  const contentType = upstream.headers.get("content-type") ?? "";
  const responseHeaders = new Headers();
  responseHeaders.set("content-type", contentType);

  if (!isTextContent(contentType)) {
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  }

  const host = request.nextUrl.origin;
  const { token, orgId } = await getToken();
  let body = await upstream.text();

  body = rewriteApiUrls(body, host);

  if (contentType.includes("text/html")) {
    body = injectTokenScript(body, token, orgId);
  }

  return new Response(body, { status: upstream.status, headers: responseHeaders });
}

export const GET = handler;
```

- [ ] **Step 2: Smoke test in browser**

With dev server running, open `http://localhost:3000/api/inkhub-proxy/` in the browser (must be logged into MockupAI first — the middleware blocks unauthenticated requests).

Check:
- Page loads without blank screen
- DevTools → Application → Local Storage → `http://localhost:3000` → has `token` and `organizationId` keys
- No login page visible (auto-logged in)

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/inkhub-proxy/[...path]/route.ts"
git commit -m "feat: add /api/inkhub-proxy UI reverse proxy with token injection"
```

---

## Task 6: Auto-Fulfill Page + Navigation

**Files:**
- Create: `src/app/(authed)/auto-fulfill/page.tsx`
- Modify: `src/app/(authed)/AuthedShell.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/(authed)/auto-fulfill/page.tsx`:

```tsx
export default function AutoFulfillPage() {
  return (
    <iframe
      src="/api/inkhub-proxy/"
      title="Auto Fulfill"
      className="w-full border-0 block h-[calc(100vh-56px)] lg:h-screen"
    />
  );
}
```

- [ ] **Step 2: Add nav item to `AuthedShell.tsx`**

In `src/app/(authed)/AuthedShell.tsx`, update the import at the top:

```tsx
// Before:
import {
  LayoutDashboard,
  Store,
  Palette,
  Wand2,
  ShoppingBag,
  Users,
  DollarSign,
  Bot,
  LogOut,
  Sparkles,
  Menu,
  X,
  ChevronRight,
  Puzzle,
} from "lucide-react";

// After:
import {
  LayoutDashboard,
  Store,
  Palette,
  Wand2,
  ShoppingBag,
  Truck,
  Users,
  DollarSign,
  Bot,
  LogOut,
  Sparkles,
  Menu,
  X,
  ChevronRight,
  Puzzle,
} from "lucide-react";
```

Then update `NAV_ITEMS`:

```tsx
// Before:
const NAV_ITEMS: NavItemConfig[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Stores", href: "/stores", icon: <Store size={18} /> },
  { label: "Designs", href: "/designs", icon: <Palette size={18} /> },
  { label: "Wizard", href: "/wizard", icon: <Wand2 size={18} /> },
  { label: "Listings", href: "/listings", icon: <ShoppingBag size={18} /> },
];

// After:
const NAV_ITEMS: NavItemConfig[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Stores", href: "/stores", icon: <Store size={18} /> },
  { label: "Designs", href: "/designs", icon: <Palette size={18} /> },
  { label: "Wizard", href: "/wizard", icon: <Wand2 size={18} /> },
  { label: "Listings", href: "/listings", icon: <ShoppingBag size={18} /> },
  { label: "Auto Fulfill", href: "/auto-fulfill", icon: <Truck size={18} /> },
];
```

- [ ] **Step 3: Skip padding wrapper on `/auto-fulfill`**

In `AuthedShell.tsx`, find the `{/* Page content */}` section (around line 229) and update:

```tsx
// Before:
{/* Page content */}
<div className="p-6 lg:p-8 max-w-7xl">
  <TokenExpiredBanner />
  {children}
</div>

// After:
{/* Page content */}
{pathname.startsWith("/auto-fulfill") ? (
  children
) : (
  <div className="p-6 lg:p-8 max-w-7xl">
    <TokenExpiredBanner />
    {children}
  </div>
)}
```

- [ ] **Step 4: Verify in browser**

1. Open `http://localhost:3000/auto-fulfill`
2. Check: sidebar visible, iframe fills full remaining width/height
3. Check: platform UI loaded and logged in (no login screen)
4. Check: clicking links/navigating inside iframe works
5. Check: other pages (e.g. `/dashboard`) still have correct padding

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/auto-fulfill/page.tsx" src/app/(authed)/AuthedShell.tsx
git commit -m "feat: add Auto Fulfill page with full-screen iframe embed"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Token Manager: Task 2
- ✅ UI Proxy with HTML injection + URL rewrite: Task 5
- ✅ API Proxy with origin spoof + Bearer token: Task 4
- ✅ Proxy utils (isTextContent, rewriteApiUrls, injectTokenScript): Task 3
- ✅ `/auto-fulfill` page with full-height iframe: Task 6
- ✅ Nav item "Auto Fulfill": Task 6
- ✅ Skip padding wrapper on `/auto-fulfill`: Task 6
- ✅ Env vars: Task 1
- ✅ Text responses (HTML + JS + CSS) have URL rewritten: proxy-utils handles all isTextContent types
- ✅ Binary responses streamed as-is: Task 5 Step 1 (`!isTextContent` branch)
- ✅ JWT exp parsed from token: Task 2, `parseJwtExp()`
- ✅ orgId from `organizations[0].id`: Task 2, token.ts + tests

**Placeholder scan:** None found.

**Type consistency:**
- `getToken()` returns `{ token: string; orgId: string }` — used correctly in both proxy routes
- `_resetForTest()` — only used in test files
- `injectTokenScript(html, token, orgId)` — signature consistent across utils and proxy route
- `rewriteApiUrls(body, host)` — `host` is `request.nextUrl.origin` in proxy route, e.g. `https://localhost:3000`
