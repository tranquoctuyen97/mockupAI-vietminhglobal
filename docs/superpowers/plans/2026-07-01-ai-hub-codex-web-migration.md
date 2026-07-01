# AI Hub Codex Web Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current AI Hub Codex Mobile runtime with the pinned `tranquoctuyen97/codex-web` fork while keeping the existing website auth, RBAC, iframe, workspace bootstrap, and admin flow.

**Architecture:** Keep the app contract stable: `/ai-hub` renders `/api/codex-proxy/`, the proxy validates website auth and injects member context, and `codex-web` runs as an internal service on port `8214`. The fork owns only UI/runtime workspace filtering and path rejection; MockupAI remains the source of permissions.

**Tech Stack:** Next.js 16 App Router, TypeScript, Node route handlers, PM2, Codex CLI, `codex-web` fork, `node:test`, pnpm scripts.

---

## File Map

- Modify `ecosystem.config.js`: run pinned `codex-web` fork on port `8214` instead of `codexapp` on `18923`.
- Modify `.env.example`: replace Codex Mobile env examples with Codex Web runtime/proxy/fork sync env.
- Modify `src/lib/ai-hub/proxy.ts`: update upstream default and rewrite helpers for Codex Web paths after inspecting the fork.
- Modify `src/lib/ai-hub/runtime.ts`: keep Codex login/status PM2 wrapper, update proxy default/status labels if needed.
- Modify `src/app/(authed)/admin/ai-hub/AiHubAdminClient.tsx`: remove Codex Mobile wording if present.
- Modify `tests/ai-hub-pm2-source.test.ts`: assert Codex Web runtime command/env.
- Modify `tests/ai-hub-proxy.test.ts`: assert new upstream port and Codex Web rewrite paths.
- Modify `tests/ai-hub-runtime-source.test.ts`: assert Codex Web admin/runtime wording where relevant.
- Create `scripts/sync-codex-web-fork.mjs`: controlled fork sync helper.
- Modify `package.json`: add `ai-hub:codex-web:sync`.
- Modify fork repo `git@github.com:tranquoctuyen97/codex-web.git`: add workspace allowlist fetch/cache and path guard.

## Task 1: Update App Runtime Contract Tests

**Files:**
- Modify: `tests/ai-hub-pm2-source.test.ts`
- Modify: `tests/ai-hub-proxy.test.ts`

- [ ] **Step 1: Update PM2 source test for Codex Web**

Replace `tests/ai-hub-pm2-source.test.ts` with:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ecosystem config defines mockupai-codex codex-web runtime", () => {
  const source = readFileSync("ecosystem.config.js", "utf8");

  assert.match(source, /name:\s*"mockupai-codex"/);
  assert.match(source, /git\+ssh:\/\/git@github\.com\/tranquoctuyen97\/codex-web\.git#/);
  assert.match(source, /PORT:\s*"8214"/);
  assert.match(source, /CODEX_CLI_PATH/);
  assert.match(source, /AI_HUB_WORKSPACES_URL/);
  assert.match(source, /AI_HUB_INTERNAL_TOKEN/);
  assert.match(source, /AI_HUB_RUNTIME_HOME/);
  assert.match(source, /HOME:\s*AI_HUB_RUNTIME_HOME/);
  assert.match(source, /CODEX_HOME/);
  assert.doesNotMatch(source, /codexapp/);
  assert.doesNotMatch(source, /18923/);
});
```

- [ ] **Step 2: Update proxy source test for port 8214**

In `tests/ai-hub-proxy.test.ts`, change expected upstream URLs from `18923` to `8214`:

```ts
assert.equal(
  buildCodexUpstreamUrl(["assets", "app.js"], "?v=1"),
  "http://127.0.0.1:8214/assets/app.js?v=1",
);
```

Change the location header upstream expectation:

```ts
assert.equal(
  rewriteCodexLocationHeader("http://127.0.0.1:8214/thread/abc"),
  "/api/codex-proxy/thread/abc",
);
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
pnpm exec tsx --test tests/ai-hub-pm2-source.test.ts tests/ai-hub-proxy.test.ts
```

Expected: FAIL because `ecosystem.config.js` still uses `codexapp` and proxy default still uses `18923`.

## Task 2: Switch PM2 Runtime to Codex Web

**Files:**
- Modify: `ecosystem.config.js`
- Modify: `.env.example`

- [ ] **Step 1: Update PM2 app config**

In `ecosystem.config.js`, replace the top constants with:

```js
const AI_HUB_RUNTIME_HOME = process.env.AI_HUB_RUNTIME_HOME || "/tmp/ai-hub/codex-runtime/home";
const AI_HUB_CODEX_WEB_REF =
  process.env.AI_HUB_CODEX_WEB_REF ||
  "git+ssh://git@github.com/tranquoctuyen97/codex-web.git#mockupai-workspace-allowlist";
const AI_HUB_CODEX_WEB_PORT = process.env.AI_HUB_CODEX_WEB_PORT || "8214";
```

Replace the `mockupai-codex` app block with:

```js
    {
      name: "mockupai-codex",
      script: "npx",
      args: `--yes ${AI_HUB_CODEX_WEB_REF}`,
      cwd: ".",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: AI_HUB_CODEX_WEB_PORT,
        CODEX_CLI_PATH: process.env.CODEX_CLI_PATH || "/home/codexbot/.local/bin/codex",
        HOME: AI_HUB_RUNTIME_HOME,
        CODEX_HOME: `${AI_HUB_RUNTIME_HOME}/.codex`,
        AI_HUB_WORKSPACES_URL:
          process.env.AI_HUB_WORKSPACES_URL ||
          "http://127.0.0.1:3001/api/internal/ai-hub/workspaces?provider=codex",
        AI_HUB_INTERNAL_TOKEN: process.env.AI_HUB_INTERNAL_TOKEN || "",
        NPM_CONFIG_CACHE: process.env.AI_HUB_NPM_CACHE || `${process.env.HOME}/.npm`,
        npm_config_cache: process.env.AI_HUB_NPM_CACHE || `${process.env.HOME}/.npm`,
      },
      error_file: "./logs/pm2/mockupai-codex-error.log",
      out_file: "./logs/pm2/mockupai-codex-out.log",
    },
```

- [ ] **Step 2: Update env example**

In `.env.example`, keep existing AI Hub variables and add:

```env
CODEX_APP_URL="http://127.0.0.1:8214"
AI_HUB_CODEX_WEB_REF="git+ssh://git@github.com/tranquoctuyen97/codex-web.git#mockupai-workspace-allowlist"
AI_HUB_CODEX_WEB_PORT="8214"
CODEX_CLI_PATH="/home/codexbot/.local/bin/codex"
AI_HUB_WORKSPACES_URL="http://127.0.0.1:3001/api/internal/ai-hub/workspaces?provider=codex"
```

Remove or update comments that say `Codex Mobile`.

- [ ] **Step 3: Run PM2 source test**

Run:

```bash
pnpm exec tsx --test tests/ai-hub-pm2-source.test.ts
```

Expected: PASS.

## Task 3: Update App Proxy Defaults

**Files:**
- Modify: `src/lib/ai-hub/proxy.ts`
- Modify: `src/lib/ai-hub/runtime.ts`
- Modify: `tests/ai-hub-proxy.test.ts`

- [ ] **Step 1: Change upstream default port**

In `src/lib/ai-hub/proxy.ts`, change:

```ts
return (process.env.CODEX_APP_URL ?? "http://127.0.0.1:18923").replace(/\/$/, "");
```

to:

```ts
return (process.env.CODEX_APP_URL ?? "http://127.0.0.1:8214").replace(/\/$/, "");
```

In `src/lib/ai-hub/runtime.ts`, change:

```ts
const res = await fetch(process.env.CODEX_APP_URL ?? "http://127.0.0.1:18923", {
```

to:

```ts
const res = await fetch(process.env.CODEX_APP_URL ?? "http://127.0.0.1:8214", {
```

- [ ] **Step 2: Keep rewrite helper minimal**

Leave `rewriteCodexProxyPaths()` as-is until the fork is inspected live. Only add Codex Web-specific path patterns if an asset/API route bypasses `/api/codex-proxy/` during smoke.

- [ ] **Step 3: Run proxy test**

Run:

```bash
pnpm exec tsx --test tests/ai-hub-proxy.test.ts
```

Expected: PASS.

## Task 4: Add Fork Sync Helper

**Files:**
- Create: `scripts/sync-codex-web-fork.mjs`
- Modify: `package.json`
- Create: `tests/ai-hub-codex-web-sync-source.test.ts`

- [ ] **Step 1: Write source test**

Create `tests/ai-hub-codex-web-sync-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("codex-web sync helper is controlled and does not deploy", () => {
  const pkg = readFileSync("package.json", "utf8");
  const script = readFileSync("scripts/sync-codex-web-fork.mjs", "utf8");

  assert.match(pkg, /"ai-hub:codex-web:sync":\s*"node scripts\/sync-codex-web-fork\.mjs"/);
  assert.match(script, /tranquoctuyen97\/codex-web\.git/);
  assert.match(script, /0xcaff\/codex-web\.git/);
  assert.match(script, /mockupai-workspace-allowlist/);
  assert.match(script, /git fetch upstream/);
  assert.match(script, /git merge upstream\/main/);
  assert.match(script, /git rev-parse HEAD/);
  assert.doesNotMatch(script, /pm2 restart/);
  assert.doesNotMatch(script, /ecosystem\.config/);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm exec tsx --test tests/ai-hub-codex-web-sync-source.test.ts
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Add package script**

In `package.json`, add under `scripts`:

```json
"ai-hub:codex-web:sync": "node scripts/sync-codex-web-fork.mjs"
```

- [ ] **Step 4: Create sync helper**

Create `scripts/sync-codex-web-fork.mjs`:

```js
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const forkUrl = process.env.CODEX_WEB_FORK_URL || "git@github.com:tranquoctuyen97/codex-web.git";
const upstreamUrl = process.env.CODEX_WEB_UPSTREAM_URL || "git@github.com:0xcaff/codex-web.git";
const branch = process.env.CODEX_WEB_BRANCH || "mockupai-workspace-allowlist";
const workdir = process.env.CODEX_WEB_SYNC_DIR || "/tmp/mockupai-codex-web";

function run(command, args, cwd = workdir) {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

await mkdir(path.dirname(workdir), { recursive: true });

if (!existsSync(path.join(workdir, ".git"))) {
  run("git", ["clone", forkUrl, workdir], path.dirname(workdir));
}

run("git", ["remote", "set-url", "origin", forkUrl]);
try {
  run("git", ["remote", "add", "upstream", upstreamUrl]);
} catch {
  run("git", ["remote", "set-url", "upstream", upstreamUrl]);
}

run("git", ["fetch", "origin"]);
run("git", ["fetch", "upstream"]);
run("git", ["checkout", branch]);
run("git", ["merge", "upstream/main"]);

try {
  run("npm", ["test"]);
} catch {
  console.warn("codex-web test command failed or is unavailable; run manual smoke before promoting.");
}

const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workdir, encoding: "utf8" }).trim();
console.log(`Synced codex-web fork branch ${branch}`);
console.log(`Pin candidate: git+ssh://git@github.com/tranquoctuyen97/codex-web.git#${sha}`);
```

- [ ] **Step 5: Run source test**

Run:

```bash
pnpm exec tsx --test tests/ai-hub-codex-web-sync-source.test.ts
```

Expected: PASS.

## Task 5: Patch Codex Web Fork Workspace Allowlist

**Files:**
- Modify in fork repo: route/component that lists or opens projects.
- Create in fork repo if absent: `src/ai-hub-workspaces.*` or the smallest equivalent helper near the project picker/open route.

- [ ] **Step 1: Clone or enter fork**

Run:

```bash
git clone git@github.com:tranquoctuyen97/codex-web.git /tmp/mockupai-codex-web
cd /tmp/mockupai-codex-web
git checkout -B mockupai-workspace-allowlist
```

Expected: local fork checkout on `mockupai-workspace-allowlist`.

- [ ] **Step 2: Inspect project picker and open/start routes**

Run:

```bash
rg -n "workspace|directory|project|open|start|cwd|path" .
```

Expected: identify the smallest files that populate folder choices and start/open a Codex session.

- [ ] **Step 3: Add allowlist helper**

Create the smallest helper in the fork, adapted to its source layout:

```ts
export type AiHubWorkspace = {
  name: string;
  path: string;
};

const cache = new Map<string, { expiresAt: number; workspaces: AiHubWorkspace[] }>();

function normalizeWorkspacePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized || "/";
}

export function isPathAllowed(candidate: string, allowlist: AiHubWorkspace[]): boolean {
  const normalizedCandidate = normalizeWorkspacePath(candidate);
  return allowlist.some((workspace) => {
    const allowed = normalizeWorkspacePath(workspace.path);
    return normalizedCandidate === allowed || normalizedCandidate.startsWith(`${allowed}/`);
  });
}

export async function getAiHubWorkspaces(memberId: string): Promise<AiHubWorkspace[]> {
  const now = Date.now();
  const cached = cache.get(memberId);
  if (cached && cached.expiresAt > now) return cached.workspaces;

  const url = process.env.AI_HUB_WORKSPACES_URL;
  const token = process.env.AI_HUB_INTERNAL_TOKEN;
  if (!url || !token) return [];

  const res = await fetch(url, {
    headers: {
      "X-Internal-Member-Id": memberId,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return [];

  const workspaces = (await res.json()) as AiHubWorkspace[];
  cache.set(memberId, { expiresAt: now + 60_000, workspaces });
  return workspaces;
}
```

- [ ] **Step 4: Wire picker to allowlist**

Replace the default project/folder choices for requests with `X-Internal-Member-Id` so the UI shows only:

```ts
const memberId = request.headers.get("x-internal-member-id");
const workspaces = memberId ? await getAiHubWorkspaces(memberId) : [];
```

Use the fork's existing response shape, mapping each item to its current project/folder option shape.

- [ ] **Step 5: Guard open/start project route**

Before calling Codex CLI or opening a project path:

```ts
const memberId = request.headers.get("x-internal-member-id");
if (memberId) {
  const workspaces = await getAiHubWorkspaces(memberId);
  if (!isPathAllowed(projectPath, workspaces)) {
    console.warn("[AI_HUB] rejected project path", {
      memberId,
      projectPath,
      timestamp: new Date().toISOString(),
    });
    return new Response("Forbidden workspace", { status: 403 });
  }
}
```

- [ ] **Step 6: Run fork tests or build**

Run whichever exists in the fork:

```bash
npm test
npm run build
```

Expected: tests/build pass, or document the exact missing command and run a local manual smoke.

- [ ] **Step 7: Commit fork patch**

Run:

```bash
git status --short
git add .
git commit -m "feat: add MockupAI workspace allowlist"
git rev-parse HEAD
```

Expected: commit SHA printed for PM2 pin.

## Task 6: App Verification

**Files:**
- Existing tests only.

- [ ] **Step 1: Run focused AI Hub tests**

Run:

```bash
pnpm exec tsx --test tests/ai-hub-pm2-source.test.ts tests/ai-hub-proxy.test.ts tests/ai-hub-runtime-source.test.ts tests/ai-hub-routes-source.test.ts tests/ai-hub-workspaces.test.ts tests/ai-hub-codex-web-sync-source.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run build if environment supports it**

Run:

```bash
pnpm run build
```

Expected: PASS. If it fails on font/network sandboxing, record the exact error and treat that as environment verification gap, not a code pass.

- [ ] **Step 3: Manual runtime smoke**

With app and PM2 runtime running:

```bash
pm2 restart mockupai-codex
curl -I http://127.0.0.1:8214
curl -I http://127.0.0.1:3001/api/codex-proxy/
```

Expected: `8214` responds from Codex Web, `/api/codex-proxy/` responds only with a valid website session in the browser.

- [ ] **Step 4: Manual UI smoke**

Open as a member with `ai_hub`:

```text
/ai-hub
```

Expected:

- Codex Web UI renders in iframe.
- Member sees own private workspace and shared workspace.
- Member does not see another member's private workspace.
- Opening another member path returns forbidden.

Open as admin:

```text
/admin/ai-hub
```

Expected:

- account/runtime/proxy statuses render;
- restart action restarts `mockupai-codex`;
- connect/disconnect still operate against service `CODEX_HOME`.

## Self Review

- Spec coverage: runtime switch, proxy default, fork allowlist, path guard, admin continuity, sync helper, upgrade process, and tests are covered.
- Placeholder scan: deployment values remain explicit env/pin values; no task says to implement an undefined future abstraction.
- Type consistency: app-side names match existing `ai-hub` helpers; fork-side helper defines its own minimal `AiHubWorkspace` shape.
