# AI Hub Codex Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an RBAC-gated AI Hub tab that embeds Codex Mobile through an authenticated app proxy and manages the shared Codex runtime from `/admin/ai-hub`.

**Architecture:** Follow the existing Auto Fulfill pattern: full-height `/ai-hub` page with an iframe pointed at `/api/codex-proxy/`. Keep runtime and workspace behavior in small server-side helpers: RBAC uses the existing `FEATURES` system, workspaces use two generic `ai_hub_*` tables, proxy/auth stays in Next route handlers, and PM2 manages the `mockupai-codex` process.

**Tech Stack:** Next.js App Router 16, React 19, TypeScript, Prisma/Postgres, PM2, `node:test` via `npx tsx --test`.

---

## Constraints

- Do not run `git add` or `git commit`; the repo owner handles staging and commits.
- Use top-level static imports only. No dynamic imports inside functions.
- Keep Phase 1 soft-isolated: one `codexbot`, one Codex account, workspace allowlist guard.
- Do not add a generic process manager, team/project model, or per-member OS/container isolation.
- Prefer source/unit tests that can run without a live Codex Mobile runtime.
- Next.js route handlers can stream normal HTTP responses, but WebSocket upgrade through route handlers is not guaranteed. If live verification proves WebSocket is required and broken, add the tiny fallback proxy as a follow-up task.

## File Map

- Modify: `prisma/schema.prisma`
  - Add generic AI Hub workspace models and tenant/user relations.
- Create: `prisma/migrations/20260630090000_ai_hub_workspaces/migration.sql`
  - Add `ai_hub_workspaces` and `ai_hub_member_workspaces`.
- Modify: `prisma/seeds/rbac-defaults.ts`
  - Add `ai_hub` to admin/operator defaults if the feature should be visible by default after seeding.
- Modify: `src/lib/auth/roles.ts`
  - Add `ai_hub` to `FEATURES`.
- Modify: `src/app/(authed)/AuthedShell.tsx`
  - Add sidebar item and full-height layout handling for `/ai-hub`.
- Modify: `src/app/(authed)/admin/acl/AclClient.tsx`
  - Add `AI Hub` to permission toggles.
- Create: `src/lib/ai-hub/workspaces.ts`
  - Idempotent workspace bootstrap and allowlist lookup.
- Create: `src/lib/ai-hub/proxy.ts`
  - Header filtering, upstream URL building, response header filtering, text content detection, root asset rewrite.
- Create: `src/lib/ai-hub/runtime.ts`
  - Minimal shell wrappers for Codex login status/device auth and PM2 status/restart.
- Create: `src/lib/ai-hub/admin-guard.ts`
  - Shared admin + `ai_hub` guard for API routes.
- Create: `src/app/(authed)/ai-hub/page.tsx`
  - RBAC-gated iframe page.
- Create: `src/app/(authed)/admin/ai-hub/page.tsx`
  - Admin runtime UI shell.
- Create: `src/app/(authed)/admin/ai-hub/AiHubAdminClient.tsx`
  - Buttons/status display for connect/check/restart.
- Create: `src/app/api/internal/ai-hub/workspaces/route.ts`
  - Token-protected workspace allowlist endpoint for Codex Mobile.
- Create: `src/app/api/codex-proxy/[[...path]]/route.ts`
  - Authenticated HTTP proxy to local Codex Mobile runtime.
- Create: `src/app/api/admin/ai-hub/status/route.ts`
  - Admin status endpoint.
- Create: `src/app/api/admin/ai-hub/connect/route.ts`
  - Admin device-auth endpoint.
- Create: `src/app/api/admin/ai-hub/restart/route.ts`
  - Admin PM2 restart endpoint.
- Modify: `ecosystem.config.js`
  - Add `mockupai-codex`.
- Modify: `docs/codex-mobile-integration.md`
  - Update decided table names and app routes.
- Tests:
  - Create `tests/ai-hub-rbac-source.test.ts`
  - Create `tests/ai-hub-schema-source.test.ts`
  - Create `tests/ai-hub-workspaces.test.ts`
  - Create `tests/ai-hub-proxy.test.ts`
  - Create `tests/ai-hub-routes-source.test.ts`
  - Create `tests/ai-hub-runtime-source.test.ts`
  - Create `tests/ai-hub-pm2-source.test.ts`

## Task 1: RBAC And Sidebar Entry

**Files:**
- Modify: `src/lib/auth/roles.ts`
- Modify: `src/app/(authed)/AuthedShell.tsx`
- Modify: `src/app/(authed)/admin/acl/AclClient.tsx`
- Modify: `prisma/seeds/rbac-defaults.ts`
- Create: `tests/ai-hub-rbac-source.test.ts`

- [ ] **Step 1: Write the source test**

Create `tests/ai-hub-rbac-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ai_hub is a first-class RBAC feature", () => {
  const roles = readFileSync("src/lib/auth/roles.ts", "utf8");
  const acl = readFileSync("src/app/(authed)/admin/acl/AclClient.tsx", "utf8");
  const seed = readFileSync("prisma/seeds/rbac-defaults.ts", "utf8");

  assert.match(roles, /"ai_hub"/);
  assert.match(acl, /\{\s*key:\s*"ai_hub",\s*label:\s*"AI Hub"\s*\}/);
  assert.match(seed, /"ai_hub"/);
});

test("sidebar exposes AI Hub and treats it as full-height embed", () => {
  const shell = readFileSync("src/app/(authed)/AuthedShell.tsx", "utf8");

  assert.match(shell, /label:\s*"AI Hub"/);
  assert.match(shell, /href:\s*"\/ai-hub"/);
  assert.match(shell, /feature:\s*"ai_hub"/);
  assert.match(shell, /pathname\.startsWith\("\/ai-hub"\)/);
  assert.match(shell, /isAiHubRoute/);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx tsx --test tests/ai-hub-rbac-source.test.ts
```

Expected: FAIL because `ai_hub` and the sidebar item do not exist.

- [ ] **Step 3: Add the RBAC feature**

In `src/lib/auth/roles.ts`, add `ai_hub` to `FEATURES`:

```ts
export const FEATURES = [
  "stores",
  "designs",
  "wizard",
  "listings",
  "auto_fulfill",
  "mockup_library",
  "ai_hub",
  "users",
  "pricing",
  "integrations",
  "ai_settings",
  "inkhub_config",
  "mailboxes",
] as const;
```

- [ ] **Step 4: Add default seed permissions**

In `prisma/seeds/rbac-defaults.ts`, add `ai_hub` to both default arrays:

```ts
const ADMIN_DEFAULTS = [
  "stores", "designs", "wizard", "listings", "auto_fulfill",
  "mockup_library", "ai_hub", "users", "pricing", "integrations", "ai_settings",
];

const OPERATOR_DEFAULTS = [
  "designs", "wizard", "listings", "auto_fulfill", "mockup_library", "ai_hub",
];
```

- [ ] **Step 5: Add ACL toggle**

In `src/app/(authed)/admin/acl/AclClient.tsx`, add `AI Hub` to `WORKSPACE_FEATURES`:

```ts
const WORKSPACE_FEATURES = [
  { key: "stores", label: "Stores" },
  { key: "designs", label: "Designs" },
  { key: "wizard", label: "Wizard" },
  { key: "listings", label: "Listings" },
  { key: "auto_fulfill", label: "Auto Fulfill" },
  { key: "mockup_library", label: "Mockup Library" },
  { key: "ai_hub", label: "AI Hub" },
] as const;
```

- [ ] **Step 6: Add sidebar item and full-height layout handling**

In `src/app/(authed)/AuthedShell.tsx`, add `TerminalSquare` or `Bot` to the existing `lucide-react` import. Reusing `Bot` is fine because it is already imported.

Add the nav item after Mailboxes:

```tsx
{
  label: "AI Hub",
  href: "/ai-hub",
  icon: <Bot size={18} />,
  feature: "ai_hub",
},
```

Add a route flag near `isMailboxRoute`:

```ts
const isMailboxRoute = pathname.startsWith("/mailboxes");
const isAiHubRoute = pathname.startsWith("/ai-hub");
```

Update the special shell branch so AI Hub gets the same full-height layout as Auto Fulfill:

```tsx
if (pathname.startsWith("/auto-fulfill") || isAiHubRoute) {
  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ backgroundColor: "var(--bg-primary)" }}
    >
      <aside
        className="w-14 flex-shrink-0 flex flex-col items-center pt-4 pb-4 gap-3"
        style={{
          backgroundColor: "var(--bg-sidebar)",
          borderRight: "1px solid var(--border-default)",
        }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "var(--color-wise-green)" }}
        >
          <Sparkles size={16} style={{ color: "var(--color-wise-dark-green)" }} />
        </div>
        <Link
          href="/dashboard"
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "var(--color-wise-green)" }}
          aria-label="Back to dashboard"
        >
          <ArrowLeft size={16} style={{ color: "var(--color-wise-dark-green)" }} />
        </Link>
      </aside>
      <main className="flex-1 min-w-0 h-full">
        <AuthedUserProvider role={userRole}>{children}</AuthedUserProvider>
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Verify task 1**

Run:

```bash
npx tsx --test tests/ai-hub-rbac-source.test.ts
```

Expected: PASS.

## Task 2: AI Hub Workspace Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260630090000_ai_hub_workspaces/migration.sql`
- Create: `tests/ai-hub-schema-source.test.ts`

- [ ] **Step 1: Write the schema source test**

Create `tests/ai-hub-schema-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("schema defines generic AI Hub workspace tables", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  assert.match(schema, /model AiHubWorkspace/);
  assert.match(schema, /@@map\("ai_hub_workspaces"\)/);
  assert.match(schema, /provider\s+String\s+@default\("codex"\)/);
  assert.match(schema, /type\s+String/);
  assert.match(schema, /path\s+String/);
  assert.match(schema, /@@unique\(\[tenantId,\s*provider,\s*path\]\)/);
  assert.match(schema, /model AiHubMemberWorkspace/);
  assert.match(schema, /@@map\("ai_hub_member_workspaces"\)/);
  assert.match(schema, /@@unique\(\[userId,\s*workspaceId\]\)/);
});

test("migration creates generic AI Hub workspace tables", () => {
  const migration = readFileSync(
    "prisma/migrations/20260630090000_ai_hub_workspaces/migration.sql",
    "utf8",
  );

  assert.match(migration, /CREATE TABLE "ai_hub_workspaces"/);
  assert.match(migration, /CREATE TABLE "ai_hub_member_workspaces"/);
  assert.match(migration, /"provider" TEXT NOT NULL DEFAULT 'codex'/);
  assert.match(migration, /"type" TEXT NOT NULL/);
  assert.match(migration, /ai_hub_workspaces_tenant_id_provider_path_key/);
  assert.match(migration, /ai_hub_member_workspaces_user_id_workspace_id_key/);
});
```

- [ ] **Step 2: Run the failing schema test**

Run:

```bash
npx tsx --test tests/ai-hub-schema-source.test.ts
```

Expected: FAIL because the models and migration do not exist.

- [ ] **Step 3: Update Prisma schema**

In `model Tenant`, add:

```prisma
  aiHubWorkspaces   AiHubWorkspace[]
```

In `model User`, add:

```prisma
  aiHubMemberWorkspaces     AiHubMemberWorkspace[]
```

Add these models after `TenantRolePermission`:

```prisma
model AiHubWorkspace {
  id        String   @id @default(cuid())
  tenantId  String   @map("tenant_id")
  name      String
  path      String
  type      String
  provider  String   @default("codex")
  createdAt DateTime @default(now()) @map("created_at")

  tenant  Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  members AiHubMemberWorkspace[]

  @@unique([tenantId, provider, path])
  @@index([tenantId, provider, type])
  @@map("ai_hub_workspaces")
}

model AiHubMemberWorkspace {
  id          String   @id @default(cuid())
  userId      String   @map("user_id")
  workspaceId String   @map("workspace_id")
  createdAt   DateTime @default(now()) @map("created_at")

  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace AiHubWorkspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([userId, workspaceId])
  @@index([workspaceId])
  @@map("ai_hub_member_workspaces")
}
```

- [ ] **Step 4: Add SQL migration**

Create `prisma/migrations/20260630090000_ai_hub_workspaces/migration.sql`:

```sql
CREATE TABLE "ai_hub_workspaces" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'codex',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_hub_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_hub_member_workspaces" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_hub_member_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_hub_workspaces_tenant_id_provider_path_key"
  ON "ai_hub_workspaces"("tenant_id", "provider", "path");

CREATE INDEX "ai_hub_workspaces_tenant_id_provider_type_idx"
  ON "ai_hub_workspaces"("tenant_id", "provider", "type");

CREATE UNIQUE INDEX "ai_hub_member_workspaces_user_id_workspace_id_key"
  ON "ai_hub_member_workspaces"("user_id", "workspace_id");

CREATE INDEX "ai_hub_member_workspaces_workspace_id_idx"
  ON "ai_hub_member_workspaces"("workspace_id");

ALTER TABLE "ai_hub_workspaces"
  ADD CONSTRAINT "ai_hub_workspaces_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_hub_member_workspaces"
  ADD CONSTRAINT "ai_hub_member_workspaces_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_hub_member_workspaces"
  ADD CONSTRAINT "ai_hub_member_workspaces_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "ai_hub_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Verify task 2**

Run:

```bash
npx tsx --test tests/ai-hub-schema-source.test.ts
npx prisma validate
```

Expected: both pass.

## Task 3: Workspace Bootstrap And Internal Endpoint

**Files:**
- Create: `src/lib/ai-hub/workspaces.ts`
- Create: `src/app/api/internal/ai-hub/workspaces/route.ts`
- Create: `tests/ai-hub-workspaces.test.ts`

- [ ] **Step 1: Write workspace helper tests**

Create `tests/ai-hub-workspaces.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMemberWorkspacePath,
  isPathAllowed,
  normalizeWorkspacePath,
} from "../src/lib/ai-hub/workspaces";

test("buildMemberWorkspacePath appends member id under root", () => {
  assert.equal(
    buildMemberWorkspacePath("/srv/ai-hub/members/", "user_123"),
    "/srv/ai-hub/members/user_123",
  );
});

test("normalizeWorkspacePath removes trailing slashes except root", () => {
  assert.equal(normalizeWorkspacePath("/srv/ai-hub/common/"), "/srv/ai-hub/common");
  assert.equal(normalizeWorkspacePath("/"), "/");
});

test("isPathAllowed accepts exact path and child path", () => {
  const allowlist = ["/srv/ai-hub/members/user_123", "/srv/ai-hub/common"];

  assert.equal(isPathAllowed("/srv/ai-hub/members/user_123", allowlist), true);
  assert.equal(isPathAllowed("/srv/ai-hub/members/user_123/project-a", allowlist), true);
  assert.equal(isPathAllowed("/srv/ai-hub/common", allowlist), true);
});

test("isPathAllowed rejects sibling prefix escape", () => {
  const allowlist = ["/srv/ai-hub/members/user_123"];

  assert.equal(isPathAllowed("/srv/ai-hub/members/user_1234", allowlist), false);
  assert.equal(isPathAllowed("/srv/ai-hub/members/user_1234/project", allowlist), false);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx tsx --test tests/ai-hub-workspaces.test.ts
```

Expected: FAIL because `src/lib/ai-hub/workspaces.ts` does not exist.

- [ ] **Step 3: Create workspace helper**

Create `src/lib/ai-hub/workspaces.ts`:

```ts
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

export const AI_HUB_PROVIDER_CODEX = "codex";
export const AI_HUB_PRIVATE_TYPE = "private";
export const AI_HUB_SHARED_TYPE = "shared";

export type AiHubWorkspaceListItem = {
  name: string;
  path: string;
};

export type AiHubSession = {
  id: string;
  tenantId: string;
};

export function normalizeWorkspacePath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

export function buildMemberWorkspacePath(root: string, userId: string): string {
  return normalizeWorkspacePath(path.posix.join(normalizeWorkspacePath(root), userId));
}

export function isPathAllowed(candidate: string, allowlist: string[]): boolean {
  const normalizedCandidate = normalizeWorkspacePath(candidate);
  return allowlist.some((allowed) => {
    const normalizedAllowed = normalizeWorkspacePath(allowed);
    return (
      normalizedCandidate === normalizedAllowed ||
      normalizedCandidate.startsWith(`${normalizedAllowed}/`)
    );
  });
}

export function getAiHubMembersRoot(): string {
  return normalizeWorkspacePath(process.env.AI_HUB_MEMBERS_ROOT ?? "/srv/ai-hub/members");
}

export function getAiHubSharedRoot(): string {
  return normalizeWorkspacePath(process.env.AI_HUB_SHARED_ROOT ?? "/srv/ai-hub/common");
}

export async function ensureAiHubWorkspaces(session: AiHubSession): Promise<AiHubWorkspaceListItem[]> {
  const privatePath = buildMemberWorkspacePath(getAiHubMembersRoot(), session.id);
  const sharedPath = getAiHubSharedRoot();

  await Promise.all([
    mkdir(privatePath, { recursive: true }),
    mkdir(sharedPath, { recursive: true }),
  ]);

  const [privateWorkspace, sharedWorkspace] = await prisma.$transaction(async (tx) => {
    const privateRow = await tx.aiHubWorkspace.upsert({
      where: {
        tenantId_provider_path: {
          tenantId: session.tenantId,
          provider: AI_HUB_PROVIDER_CODEX,
          path: privatePath,
        },
      },
      create: {
        tenantId: session.tenantId,
        provider: AI_HUB_PROVIDER_CODEX,
        name: "My workspace",
        path: privatePath,
        type: AI_HUB_PRIVATE_TYPE,
      },
      update: { name: "My workspace", type: AI_HUB_PRIVATE_TYPE },
    });

    const sharedRow = await tx.aiHubWorkspace.upsert({
      where: {
        tenantId_provider_path: {
          tenantId: session.tenantId,
          provider: AI_HUB_PROVIDER_CODEX,
          path: sharedPath,
        },
      },
      create: {
        tenantId: session.tenantId,
        provider: AI_HUB_PROVIDER_CODEX,
        name: "Common",
        path: sharedPath,
        type: AI_HUB_SHARED_TYPE,
      },
      update: { name: "Common", type: AI_HUB_SHARED_TYPE },
    });

    await tx.aiHubMemberWorkspace.createMany({
      data: [
        { userId: session.id, workspaceId: privateRow.id },
        { userId: session.id, workspaceId: sharedRow.id },
      ],
      skipDuplicates: true,
    });

    return [privateRow, sharedRow];
  });

  return [
    { name: privateWorkspace.name, path: privateWorkspace.path },
    { name: sharedWorkspace.name, path: sharedWorkspace.path },
  ];
}

export async function listAiHubWorkspacesForMember(
  tenantId: string,
  userId: string,
  provider = AI_HUB_PROVIDER_CODEX,
): Promise<AiHubWorkspaceListItem[]> {
  const rows = await prisma.aiHubMemberWorkspace.findMany({
    where: {
      userId,
      workspace: { tenantId, provider },
    },
    select: {
      workspace: {
        select: { name: true, path: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    name: row.workspace.name,
    path: row.workspace.path,
  }));
}
```

- [ ] **Step 4: Create internal workspace endpoint**

Create `src/app/api/internal/ai-hub/workspaces/route.ts`:

```ts
import { NextResponse } from "next/server";
import { AI_HUB_PROVIDER_CODEX, listAiHubWorkspacesForMember } from "@/lib/ai-hub/workspaces";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.AI_HUB_INTERNAL_TOKEN;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? AI_HUB_PROVIDER_CODEX;
  if (provider !== AI_HUB_PROVIDER_CODEX) {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }

  const userId = request.headers.get("x-internal-member-id");
  if (!userId) {
    return NextResponse.json({ error: "Missing member id" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tenantId: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const workspaces = await listAiHubWorkspacesForMember(user.tenantId, user.id, provider);
  return NextResponse.json(workspaces);
}
```

- [ ] **Step 5: Verify task 3**

Run:

```bash
npx tsx --test tests/ai-hub-workspaces.test.ts
```

Expected: PASS.

## Task 4: AI Hub Page

**Files:**
- Create: `src/app/(authed)/ai-hub/page.tsx`
- Create: `tests/ai-hub-routes-source.test.ts`

- [ ] **Step 1: Write page source test**

Create `tests/ai-hub-routes-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("AI Hub page validates session, checks feature, bootstraps workspaces, and renders iframe", () => {
  const source = readFileSync("src/app/(authed)/ai-hub/page.tsx", "utf8");

  assert.match(source, /validateSession/);
  assert.match(source, /hasFeature\(session\.tenantId,\s*session\.role,\s*"ai_hub"\)/);
  assert.match(source, /ensureAiHubWorkspaces/);
  assert.match(source, /src="\/api\/codex-proxy\/"/);
  assert.match(source, /title="AI Hub"/);
});

test("admin AI Hub routes exist and use admin guard", () => {
  const adminPage = readFileSync("src/app/(authed)/admin/ai-hub/page.tsx", "utf8");
  const statusRoute = readFileSync("src/app/api/admin/ai-hub/status/route.ts", "utf8");

  assert.match(adminPage, /validateSession/);
  assert.match(adminPage, /session\.role !== "ADMIN" && session\.role !== "SUPER_ADMIN"/);
  assert.match(statusRoute, /requireAiHubAdmin/);
});
```

- [ ] **Step 2: Run the failing route source test**

Run:

```bash
npx tsx --test tests/ai-hub-routes-source.test.ts
```

Expected: FAIL because the pages/routes do not exist yet.

- [ ] **Step 3: Create `/ai-hub` page**

Create `src/app/(authed)/ai-hub/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import { ensureAiHubWorkspaces } from "@/lib/ai-hub/workspaces";
import Link from "next/link";

export const metadata = {
  title: "AI Hub — MockupAI",
};

export default async function AiHubPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const canAccess = await hasFeature(session.tenantId, session.role, "ai_hub");
  if (!canAccess) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center" style={{ maxWidth: 400, padding: 40 }}>
          <div style={{ fontSize: "3rem", marginBottom: 16, opacity: 0.3 }}>🔒</div>
          <p className="text-body" style={{ color: "var(--text-secondary)" }}>
            Bạn không có quyền truy cập AI Hub.
          </p>
        </div>
      </div>
    );
  }

  try {
    await ensureAiHubWorkspaces({ id: session.id, tenantId: session.tenantId });
  } catch (error) {
    console.error("[AI_HUB] workspace bootstrap failed", error);
    const isAdmin = session.role === "ADMIN" || session.role === "SUPER_ADMIN";
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center" style={{ maxWidth: 480, padding: 40 }}>
          <div style={{ fontSize: "3rem", marginBottom: 16, opacity: 0.3 }}>⚠️</div>
          <p className="text-body" style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
            AI Hub chưa sẵn sàng. Vui lòng thử lại hoặc liên hệ admin.
          </p>
          {isAdmin && (
            <Link href="/admin/ai-hub" className="btn btn-primary">
              Mở AI Hub Admin
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <iframe
      src="/api/codex-proxy/"
      title="AI Hub"
      className="w-full h-full border-0 block"
    />
  );
}
```

- [ ] **Step 4: Leave route test partially failing until admin files exist**

Do not force the route test to pass yet. It should still fail on missing admin files. Task 6 completes that test.

## Task 5: Codex Proxy Helpers And Route

**Files:**
- Create: `src/lib/ai-hub/proxy.ts`
- Create: `src/app/api/codex-proxy/[[...path]]/route.ts`
- Create: `tests/ai-hub-proxy.test.ts`

- [ ] **Step 1: Write proxy helper tests**

Create `tests/ai-hub-proxy.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexUpstreamUrl,
  filterCodexRequestHeaders,
  filterCodexResponseHeaders,
  isAiHubTextContent,
  rewriteCodexRootAssets,
} from "../src/lib/ai-hub/proxy";

test("buildCodexUpstreamUrl preserves path and query", () => {
  assert.equal(
    buildCodexUpstreamUrl(["assets", "app.js"], "?v=1"),
    "http://127.0.0.1:18923/assets/app.js?v=1",
  );
});

test("filterCodexRequestHeaders strips spoofed internal headers", () => {
  const input = new Headers({
    "accept": "text/html",
    "x-internal-member-id": "spoof",
    "x-internal-workspace": "spoof",
    "cookie": "session=secret",
  });
  const output = filterCodexRequestHeaders(input, "real-user");

  assert.equal(output.get("accept"), "text/html");
  assert.equal(output.get("x-internal-member-id"), "real-user");
  assert.equal(output.has("x-internal-workspace"), false);
  assert.equal(output.has("cookie"), false);
});

test("filterCodexResponseHeaders removes frame blockers", () => {
  const input = new Headers({
    "content-type": "text/html",
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors none",
  });
  const output = filterCodexResponseHeaders(input);

  assert.equal(output.get("content-type"), "text/html");
  assert.equal(output.has("x-frame-options"), false);
  assert.equal(output.has("content-security-policy"), false);
});

test("text detection covers html, js, and css", () => {
  assert.equal(isAiHubTextContent("text/html"), true);
  assert.equal(isAiHubTextContent("application/javascript"), true);
  assert.equal(isAiHubTextContent("text/css"), true);
  assert.equal(isAiHubTextContent("image/png"), false);
});

test("root asset rewrite is narrow and idempotent", () => {
  const input = 'const logo = "/favicon.ico"; const existing = "/api/codex-proxy/app.js";';
  const output = rewriteCodexRootAssets(input);

  assert.match(output, /"\/api\/codex-proxy\/favicon\.ico"/);
  assert.match(output, /"\/api\/codex-proxy\/app\.js"/);
});
```

- [ ] **Step 2: Run the failing proxy test**

Run:

```bash
npx tsx --test tests/ai-hub-proxy.test.ts
```

Expected: FAIL because the proxy helper does not exist.

- [ ] **Step 3: Create proxy helper**

Create `src/lib/ai-hub/proxy.ts`:

```ts
export const CODEX_PROXY_BASE = "/api/codex-proxy";

export function getCodexUpstreamBase(): string {
  return (process.env.CODEX_APP_URL ?? "http://127.0.0.1:18923").replace(/\/$/, "");
}

export function buildCodexUpstreamUrl(pathSegments: string[] | undefined, search: string): string {
  const path = pathSegments?.length ? `/${pathSegments.map(encodeURIComponent).join("/")}` : "/";
  return `${getCodexUpstreamBase()}${path}${search}`;
}

export function filterCodexRequestHeaders(input: Headers, memberId: string): Headers {
  const output = new Headers();
  const allowed = ["accept", "accept-language", "content-type", "user-agent"];

  for (const key of allowed) {
    const value = input.get(key);
    if (value) output.set(key, value);
  }

  output.set("accept-encoding", "identity");
  output.set("x-internal-member-id", memberId);
  return output;
}

export function filterCodexResponseHeaders(input: Headers): Headers {
  const output = new Headers();
  const allowed = ["content-type", "cache-control", "etag", "last-modified"];

  for (const key of allowed) {
    const value = input.get(key);
    if (value) output.set(key, value);
  }

  return output;
}

export function isAiHubTextContent(contentType: string): boolean {
  return (
    contentType.includes("text/html") ||
    contentType.includes("text/javascript") ||
    contentType.includes("application/javascript") ||
    contentType.includes("text/css")
  );
}

export function rewriteCodexAbsolutePaths(html: string): string {
  return html
    .replace(/(src|href)="\/(?!\/)/g, `$1="${CODEX_PROXY_BASE}/`)
    .replace(/(src|href)='\/(?!\/)/g, `$1='${CODEX_PROXY_BASE}/`);
}

export function rewriteCodexRootAssets(body: string): string {
  return body.replace(
    /(["'])(\/(?!api\/)(?:[^"'?#]*\.)(?:ico|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot|otf|js|css)(?:\?[^"']*)?)\1/g,
    `$1${CODEX_PROXY_BASE}$2$1`,
  );
}
```

- [ ] **Step 4: Create HTTP proxy route**

Create `src/app/api/codex-proxy/[[...path]]/route.ts`:

```ts
import type { NextRequest } from "next/server";
import {
  buildCodexUpstreamUrl,
  filterCodexRequestHeaders,
  filterCodexResponseHeaders,
  isAiHubTextContent,
  rewriteCodexAbsolutePaths,
  rewriteCodexRootAssets,
} from "@/lib/ai-hub/proxy";
import { ensureAiHubWorkspaces } from "@/lib/ai-hub/workspaces";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const session = await validateSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const ok = await hasFeature(session.tenantId, session.role, "ai_hub");
  if (!ok) return new Response("Forbidden", { status: 403 });

  const { path } = await params;
  if (!path?.length) {
    await ensureAiHubWorkspaces({ id: session.id, tenantId: session.tenantId });
  }

  const upstreamUrl = buildCodexUpstreamUrl(path, request.nextUrl.search);
  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const upstream = await fetch(upstreamUrl, {
    method,
    headers: filterCodexRequestHeaders(request.headers, session.id),
    body: hasBody ? request.body : undefined,
    redirect: "manual",
    // Node fetch needs this when forwarding a streamed request body.
    duplex: hasBody ? "half" : undefined,
  } as RequestInit & { duplex?: "half" });

  const contentType = upstream.headers.get("content-type") ?? "";
  const responseHeaders = filterCodexResponseHeaders(upstream.headers);

  if (!isAiHubTextContent(contentType)) {
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  }

  let body = await upstream.text();
  if (contentType.includes("text/html")) {
    body = rewriteCodexAbsolutePaths(body);
  }
  body = rewriteCodexRootAssets(body);

  return new Response(body, { status: upstream.status, headers: responseHeaders });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
```

- [ ] **Step 5: Verify task 5**

Run:

```bash
npx tsx --test tests/ai-hub-proxy.test.ts
```

Expected: PASS.

## Task 6: Admin Runtime Helpers, API, And UI

**Files:**
- Create: `src/lib/ai-hub/runtime.ts`
- Create: `src/lib/ai-hub/admin-guard.ts`
- Create: `src/app/api/admin/ai-hub/status/route.ts`
- Create: `src/app/api/admin/ai-hub/connect/route.ts`
- Create: `src/app/api/admin/ai-hub/restart/route.ts`
- Create: `src/app/(authed)/admin/ai-hub/page.tsx`
- Create: `src/app/(authed)/admin/ai-hub/AiHubAdminClient.tsx`
- Modify: `src/app/(authed)/AuthedShell.tsx`
- Create: `tests/ai-hub-runtime-source.test.ts`

- [ ] **Step 1: Write runtime source test**

Create `tests/ai-hub-runtime-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("runtime helper only wraps codex and PM2 commands", () => {
  const source = readFileSync("src/lib/ai-hub/runtime.ts", "utf8");

  assert.match(source, /spawn/);
  assert.match(source, /codex/);
  assert.match(source, /login/);
  assert.match(source, /status/);
  assert.match(source, /pm2/);
  assert.match(source, /mockupai-codex/);
});

test("admin endpoints require AI Hub admin", () => {
  for (const file of [
    "src/app/api/admin/ai-hub/status/route.ts",
    "src/app/api/admin/ai-hub/connect/route.ts",
    "src/app/api/admin/ai-hub/restart/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /requireAiHubAdmin/);
  }
});

test("admin guard lives outside route files", () => {
  const source = readFileSync("src/lib/ai-hub/admin-guard.ts", "utf8");

  assert.match(source, /validateSession/);
  assert.match(source, /hasFeature\(session\.tenantId,\s*session\.role,\s*"ai_hub"\)/);
  assert.match(source, /session\.role !== "ADMIN" && session\.role !== "SUPER_ADMIN"/);
});

test("admin page renders AI Hub admin client", () => {
  const page = readFileSync("src/app/(authed)/admin/ai-hub/page.tsx", "utf8");
  const client = readFileSync("src/app/(authed)/admin/ai-hub/AiHubAdminClient.tsx", "utf8");
  const shell = readFileSync("src/app/(authed)/AuthedShell.tsx", "utf8");

  assert.match(page, /AiHubAdminClient/);
  assert.match(client, /\/api\/admin\/ai-hub\/status/);
  assert.match(client, /\/api\/admin\/ai-hub\/connect/);
  assert.match(client, /\/api\/admin\/ai-hub\/restart/);
  assert.match(shell, /href:\s*"\/admin\/ai-hub"/);
});
```

- [ ] **Step 2: Run the failing runtime test**

Run:

```bash
npx tsx --test tests/ai-hub-runtime-source.test.ts
```

Expected: FAIL because runtime/admin files do not exist.

- [ ] **Step 3: Create runtime helper**

Create `src/lib/ai-hub/runtime.ts`:

```ts
import { spawn } from "node:child_process";

const PROCESS_NAME = "mockupai-codex";
const COMMAND_TIMEOUT_MS = 15_000;

export type AiHubRuntimeStatus = {
  codexAccount: "not_connected" | "waiting_for_device_auth" | "connected";
  runtime: "stopped" | "online" | "errored" | "unknown";
  proxy: "reachable" | "unreachable";
  detail?: string;
};

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

function runCommand(command: string, args: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
}

export async function checkCodexLoginStatus(): Promise<AiHubRuntimeStatus["codexAccount"]> {
  const result = await runCommand("codex", ["login", "status"]);
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (result.code === 0 && text.includes("logged")) return "connected";
  if (text.includes("device") || text.includes("waiting")) return "waiting_for_device_auth";
  return "not_connected";
}

export async function startCodexDeviceAuth(): Promise<{ output: string }> {
  const result = await runCommand("codex", ["login", "--device-auth"], 60_000);
  return { output: `${result.stdout}\n${result.stderr}`.trim() };
}

export async function getCodexPm2Status(): Promise<AiHubRuntimeStatus["runtime"]> {
  const result = await runCommand("pm2", ["jlist"]);
  if (result.code !== 0) return "unknown";

  try {
    const processes = JSON.parse(result.stdout) as Array<{
      name?: string;
      pm2_env?: { status?: string };
    }>;
    const process = processes.find((item) => item.name === PROCESS_NAME);
    if (!process) return "stopped";
    if (process.pm2_env?.status === "online") return "online";
    if (process.pm2_env?.status === "errored") return "errored";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function restartCodexPm2(): Promise<{ ok: boolean; output: string }> {
  const result = await runCommand("pm2", ["restart", PROCESS_NAME], 30_000);
  return {
    ok: result.code === 0,
    output: `${result.stdout}\n${result.stderr}`.trim(),
  };
}

export async function checkCodexProxyReachable(): Promise<AiHubRuntimeStatus["proxy"]> {
  try {
    const res = await fetch(process.env.CODEX_APP_URL ?? "http://127.0.0.1:18923", {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok || res.status < 500 ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function getAiHubRuntimeStatus(): Promise<AiHubRuntimeStatus> {
  const [codexAccount, runtime, proxy] = await Promise.all([
    checkCodexLoginStatus(),
    getCodexPm2Status(),
    checkCodexProxyReachable(),
  ]);

  return { codexAccount, runtime, proxy };
}
```

- [ ] **Step 4: Create shared admin guard helper**

Create `src/lib/ai-hub/admin-guard.ts`:

```ts
import { NextResponse } from "next/server";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";

export async function requireAiHubAdmin() {
  const session = await validateSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.role !== "ADMIN" && session.role !== "SUPER_ADMIN") {
    return { session: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const ok = await hasFeature(session.tenantId, session.role, "ai_hub");
  if (!ok) {
    return { session: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, response: null };
}
```

- [ ] **Step 5: Create status route**

Create `src/app/api/admin/ai-hub/status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAiHubAdmin } from "@/lib/ai-hub/admin-guard";
import { getAiHubRuntimeStatus } from "@/lib/ai-hub/runtime";

export async function GET() {
  const { response } = await requireAiHubAdmin();
  if (response) return response;

  return NextResponse.json(await getAiHubRuntimeStatus());
}
```

- [ ] **Step 6: Create connect and restart routes**

Create `src/app/api/admin/ai-hub/connect/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAiHubAdmin } from "@/lib/ai-hub/admin-guard";
import { startCodexDeviceAuth } from "@/lib/ai-hub/runtime";

export async function POST() {
  const { response } = await requireAiHubAdmin();
  if (response) return response;

  const result = await startCodexDeviceAuth();
  return NextResponse.json(result);
}
```

Create `src/app/api/admin/ai-hub/restart/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAiHubAdmin } from "@/lib/ai-hub/admin-guard";
import { restartCodexPm2 } from "@/lib/ai-hub/runtime";

export async function POST() {
  const { response } = await requireAiHubAdmin();
  if (response) return response;

  const result = await restartCodexPm2();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
```

- [ ] **Step 7: Create admin page**

Create `src/app/(authed)/admin/ai-hub/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import AiHubAdminClient from "./AiHubAdminClient";

export const metadata = { title: "AI Hub Admin — MockupAI" };

export default async function AiHubAdminPage() {
  const session = await validateSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN" && session.role !== "SUPER_ADMIN") redirect("/dashboard");

  const ok = await hasFeature(session.tenantId, session.role, "ai_hub");
  if (!ok) redirect("/dashboard");

  return <AiHubAdminClient />;
}
```

Create `src/app/(authed)/admin/ai-hub/AiHubAdminClient.tsx`:

```tsx
"use client";

import { Bot, RefreshCcw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Status = {
  codexAccount: string;
  runtime: string;
  proxy: string;
};

export default function AiHubAdminClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [deviceOutput, setDeviceOutput] = useState("");
  const [pending, setPending] = useState(false);

  async function loadStatus() {
    const res = await fetch("/api/admin/ai-hub/status");
    if (!res.ok) {
      toast.error("Không thể tải AI Hub status");
      return;
    }
    setStatus(await res.json());
  }

  async function connect() {
    setPending(true);
    try {
      const res = await fetch("/api/admin/ai-hub/connect", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        toast.error("Không thể bắt đầu Codex login");
        return;
      }
      setDeviceOutput(body.output ?? "");
      await loadStatus();
    } finally {
      setPending(false);
    }
  }

  async function restart() {
    setPending(true);
    try {
      const res = await fetch("/api/admin/ai-hub/restart", { method: "POST" });
      if (!res.ok) {
        toast.error("Restart thất bại");
        return;
      }
      toast.success("Đã restart AI Hub runtime");
      await loadStatus();
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-section-heading" style={{ color: "var(--text-primary)" }}>
          <Bot size={22} style={{ display: "inline", marginRight: 8, verticalAlign: "text-bottom" }} />
          AI Hub Admin
        </h1>
        <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
          Quản lý Codex account và runtime dùng chung cho team.
        </p>
      </div>

      <div className="card card-lg" style={{ maxWidth: 760 }}>
        <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <StatusTile label="Codex account" value={status?.codexAccount ?? "unknown"} />
          <StatusTile label="Runtime" value={status?.runtime ?? "unknown"} />
          <StatusTile label="Proxy" value={status?.proxy ?? "unknown"} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={pending} onClick={connect} type="button">
            <Bot size={16} />
            Connect Codex
          </button>
          <button className="btn-secondary" disabled={pending} onClick={loadStatus} type="button">
            <RefreshCcw size={16} />
            Check status
          </button>
          <button className="btn-secondary" disabled={pending} onClick={restart} type="button">
            <RotateCw size={16} />
            Restart runtime
          </button>
        </div>

        {deviceOutput && (
          <pre
            className="mt-6"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              padding: 16,
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              fontSize: 13,
            }}
          >
            {deviceOutput}
          </pre>
        )}
      </div>
    </div>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 12, borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-tertiary)" }}>
      <div className="text-caption" style={{ color: "var(--text-secondary)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 8: Add admin sidebar item**

In `src/app/(authed)/AuthedShell.tsx`, add to `ADMIN_ITEMS`:

```tsx
{
  label: "AI Hub Admin",
  href: "/admin/ai-hub",
  icon: <Bot size={18} />,
  adminOnly: true,
  feature: "ai_hub",
},
```

- [ ] **Step 9: Verify task 6 and complete route source test**

Run:

```bash
npx tsx --test tests/ai-hub-runtime-source.test.ts
npx tsx --test tests/ai-hub-routes-source.test.ts
```

Expected: both pass.

## Task 7: PM2 Runtime Entry

**Files:**
- Modify: `ecosystem.config.js`
- Create: `tests/ai-hub-pm2-source.test.ts`

- [ ] **Step 1: Write PM2 source test**

Create `tests/ai-hub-pm2-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ecosystem config defines mockupai-codex runtime", () => {
  const source = readFileSync("ecosystem.config.js", "utf8");

  assert.match(source, /name:\s*"mockupai-codex"/);
  assert.match(source, /codexapp/);
  assert.match(source, /--no-tunnel/);
  assert.match(source, /--port/);
  assert.match(source, /18923/);
  assert.match(source, /CODEX_APP_HOST/);
});
```

- [ ] **Step 2: Run the failing PM2 test**

Run:

```bash
npx tsx --test tests/ai-hub-pm2-source.test.ts
```

Expected: FAIL because `mockupai-codex` is not configured.

- [ ] **Step 3: Add PM2 app entry**

In `ecosystem.config.js`, add this app object after `mockupai-worker`:

```js
    {
      name: "mockupai-codex",
      script: "npx",
      args: "codexapp --no-tunnel --port 18923",
      cwd: ".",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        CODEX_APP_HOST: "127.0.0.1",
        CODEX_APP_PORT: "18923",
      },
      error_file: "./logs/pm2/mockupai-codex-error.log",
      out_file: "./logs/pm2/mockupai-codex-out.log",
    },
```

- [ ] **Step 4: Verify task 7**

Run:

```bash
npx tsx --test tests/ai-hub-pm2-source.test.ts
```

Expected: PASS.

## Task 8: Update Research Doc And Final Verification

**Files:**
- Modify: `docs/codex-mobile-integration.md`

- [ ] **Step 1: Update docs with final app contract**

In `docs/codex-mobile-integration.md`, update the workspace table names and routes to match the approved spec:

```text
ai_hub_workspaces
  id
  tenant_id
  name
  path
  type        private | shared
  provider    codex

ai_hub_member_workspaces
  user_id
  workspace_id
```

Replace the internal endpoint with:

```http
GET /api/internal/ai-hub/workspaces?provider=codex
X-Internal-Member-Id: <member_id>
Authorization: Bearer <ai_hub_internal_token>
```

Add the chosen app routes:

```text
/ai-hub
  iframe -> /api/codex-proxy/

/admin/ai-hub
  Connect Codex
  Check status
  Restart runtime
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx tsx --test tests/ai-hub-rbac-source.test.ts
npx tsx --test tests/ai-hub-schema-source.test.ts
npx tsx --test tests/ai-hub-workspaces.test.ts
npx tsx --test tests/ai-hub-proxy.test.ts
npx tsx --test tests/ai-hub-routes-source.test.ts
npx tsx --test tests/ai-hub-runtime-source.test.ts
npx tsx --test tests/ai-hub-pm2-source.test.ts
```

Expected: all pass.

- [ ] **Step 3: Validate Prisma schema**

Run:

```bash
npx prisma validate
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Manual runtime smoke when VPS runtime is available**

With `mockupai-codex` running and `AI_HUB_INTERNAL_TOKEN` set:

```bash
curl -I http://127.0.0.1:18923
```

Expected: HTTP response from Codex Mobile.

Then in the app:

```text
1. Login as a user with ai_hub.
2. Open /ai-hub.
3. Confirm iframe loads Codex Mobile.
4. Open /admin/ai-hub as admin.
5. Confirm status returns codex account, runtime, and proxy states.
```

If iframe loads but Codex realtime features fail because WebSocket upgrade does not survive the Next route handler, implement the smallest fallback in a new follow-up task: a local Node HTTP proxy process on `127.0.0.1`, still reached only after app auth. Do not switch to direct Nginx proxy in this phase.
