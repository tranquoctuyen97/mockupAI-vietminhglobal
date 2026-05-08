# Dynamic RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded 2-role system with SUPER_ADMIN / ADMIN / OPERATOR where SUPER_ADMIN configures per-tenant feature permissions via a tab-based UI, and InkHub credentials move from env vars to an encrypted DB table.

**Architecture:** Feature-flag RBAC via `tenant_role_permissions` table. `hasFeature(tenantId, role, feature)` replaces all hardcoded role checks. SUPER_ADMIN is hardcoded full-access. ACL UI lets SUPER_ADMIN toggle features per role. InkHub credentials stored encrypted using the existing `src/lib/crypto/envelope.ts` (AES-256-GCM).

**Tech Stack:** Prisma + PostgreSQL, Next.js 15 App Router, React Server Components, `react.cache()` for per-request memoization, existing `encrypt`/`decrypt` from `src/lib/crypto/envelope.ts`.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `prisma/schema.prisma` | Add SUPER_ADMIN enum value, TenantRolePermission model, InkhubCredential model |
| Create | `prisma/seeds/rbac-defaults.ts` | One-time seed: insert default permissions for all existing tenants |
| Modify | `src/lib/auth/roles.ts` | FEATURES const, Feature type, hasFeature() with React.cache memoization |
| Modify | `src/lib/auth/roles.test.ts` | Tests for hasFeature (mocked DB) |
| Modify | `src/lib/auth/guards.ts` | requireFeature(), requireSuperAdmin() — replace requireAdminSession() |
| Modify | `src/lib/inkhub/token.ts` | Accept tenantId, read from InkhubCredential DB, fall back to env |
| Modify | `src/app/api/inkhub-proxy/[[...path]]/route.ts` | Pass session.tenantId to getToken() |
| Modify | `src/app/(authed)/layout.tsx` | Fetch permissions, pass to AuthedShell |
| Modify | `src/app/(authed)/AuthedShell.tsx` | Accept permissions prop, filter nav items |
| Modify | `src/app/(authed)/admin/layout.tsx` | Allow SUPER_ADMIN in addition to ADMIN |
| Modify | `src/app/(authed)/stores/StoresClient.tsx` | Use permissions prop instead of canManageStoreConfig |
| Modify | `src/app/(authed)/stores/new/layout.tsx` | Use hasFeature("stores") |
| Modify | `src/app/(authed)/stores/[id]/config/layout.tsx` | Use hasFeature("stores") |
| Modify | `src/app/(authed)/wizard/[draftId]/step-3/page.tsx` | Use permissions prop |
| Modify | `src/app/api/stores/route.ts` | requireFeature("stores") |
| Modify | `src/app/api/stores/[id]/route.ts` | requireFeature("stores") |
| Modify | `src/app/api/stores/[id]/test-connection/route.ts` | requireFeature("stores") |
| Modify | `src/app/api/stores/[id]/printify/route.ts` | requireFeature("stores") |
| Modify | `src/app/api/stores/[id]/mockup-templates/route.ts` | requireFeature("stores") |
| Modify | `src/app/api/stores/[id]/catalog/route.ts` | requireFeature("stores") |
| Modify | `src/app/api/stores/[id]/colors/route.ts` | requireFeature("stores") |
| Modify | `src/app/api/stores/[id]/template/route.ts` | requireFeature("stores") |
| Modify | `src/app/api/stores/[id]/variant-cache/refresh/route.ts` | requireFeature("stores") |
| Modify | `src/app/api/admin/users/route.ts` | requireFeature("users") |
| Modify | `src/app/api/admin/ai-settings/route.ts` | requireFeature("ai_settings") |
| Modify | `src/app/api/admin/ai-settings/models/route.ts` | requireFeature("ai_settings") |
| Modify | `src/app/api/admin/ai-settings/models/refresh/route.ts` | requireFeature("ai_settings") |
| Modify | `src/app/api/admin/ai-settings/test-provider/route.ts` | requireFeature("ai_settings") |
| Modify | `src/app/api/admin/pricing-templates/route.ts` | requireFeature("pricing") |
| Modify | `src/app/api/integrations/printify/accounts/route.ts` | requireFeature("integrations") |
| Modify | `src/app/api/integrations/printify/accounts/[id]/route.ts` | requireFeature("integrations") |
| Modify | `src/app/api/integrations/printify/accounts/[id]/sync/route.ts` | requireFeature("integrations") |
| Create | `src/app/api/admin/acl/route.ts` | GET + PATCH permissions for a role |
| Create | `src/app/(authed)/admin/acl/page.tsx` | Server component: load initial permissions |
| Create | `src/app/(authed)/admin/acl/AclClient.tsx` | Tab UI with toggle switches |
| Create | `src/app/api/admin/inkhub/route.ts` | PUT save InkHub credentials |
| Create | `src/app/api/admin/inkhub/test/route.ts` | POST test InkHub credentials |
| Create | `src/app/(authed)/admin/inkhub/page.tsx` | Server component: load existing config |
| Create | `src/app/(authed)/admin/inkhub/InkhubConfigClient.tsx` | Form UI |

---

## Task 1: Prisma Schema + Migration + Seed

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/seeds/rbac-defaults.ts`

- [ ] **Step 1: Add SUPER_ADMIN to UserRole enum and new models in schema.prisma**

In `prisma/schema.prisma`, find the existing `enum UserRole` block and `Tenant` model, replace/extend as shown:

```prisma
// In Tenant model, add two new relations:
model Tenant {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  users             User[]
  auditEvents       AuditEvent[]
  stores            Store[]
  wizardDrafts      WizardDraft[]
  rolePermissions   TenantRolePermission[]
  inkhubCredential  InkhubCredential?

  @@map("tenants")
}

// Replace UserRole enum:
enum UserRole {
  SUPER_ADMIN
  ADMIN
  OPERATOR
}

// Add after UserStatus enum:
model TenantRolePermission {
  id        String   @id @default(cuid())
  tenantId  String   @map("tenant_id")
  role      UserRole
  feature   String
  createdAt DateTime @default(now()) @map("created_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, role, feature])
  @@index([tenantId, role])
  @@map("tenant_role_permissions")
}

model InkhubCredential {
  id                String   @id @default(cuid())
  tenantId          String   @unique @map("tenant_id")
  username          String
  passwordEncrypted Bytes    @map("password_encrypted")
  updatedAt         DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@map("inkhub_credentials")
}
```

- [ ] **Step 2: Run Prisma migration**

```bash
cd /Users/tuyen.tq/Documents/freelancer/vietminhglobal/app
npx prisma migrate dev --name rbac_inkhub
```

Expected: Migration created and applied. If it fails due to existing `ADMIN`/`OPERATOR` enum values, check the migration SQL — Prisma handles adding new enum values.

- [ ] **Step 3: Create seed script for default permissions**

Create `prisma/seeds/rbac-defaults.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_DEFAULTS = [
  "stores", "designs", "wizard", "listings", "auto_fulfill",
  "users", "pricing", "integrations", "ai_settings",
];

const OPERATOR_DEFAULTS = [
  "stores", "designs", "wizard", "listings", "auto_fulfill",
];

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  console.log(`Seeding permissions for ${tenants.length} tenant(s)...`);

  for (const tenant of tenants) {
    for (const feature of ADMIN_DEFAULTS) {
      await prisma.tenantRolePermission.upsert({
        where: { tenantId_role_feature: { tenantId: tenant.id, role: "ADMIN", feature } },
        create: { tenantId: tenant.id, role: "ADMIN", feature },
        update: {},
      });
    }
    for (const feature of OPERATOR_DEFAULTS) {
      await prisma.tenantRolePermission.upsert({
        where: { tenantId_role_feature: { tenantId: tenant.id, role: "OPERATOR", feature } },
        create: { tenantId: tenant.id, role: "OPERATOR", feature },
        update: {},
      });
    }
    console.log(`  ✓ Tenant ${tenant.id}`);
  }
  console.log("Done.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

- [ ] **Step 4: Run seed script**

```bash
cd /Users/tuyen.tq/Documents/freelancer/vietminhglobal/app
npx tsx prisma/seeds/rbac-defaults.ts
```

Expected output:
```
Seeding permissions for 1 tenant(s)...
  ✓ Tenant <id>
Done.
```

- [ ] **Step 5: Verify in DB**

```bash
npx prisma studio
```

Open `TenantRolePermission` table — should have 9 ADMIN rows + 5 OPERATOR rows per tenant.

---

## Task 2: Core Auth Library

**Files:**
- Modify: `src/lib/auth/roles.ts`
- Modify: `src/lib/auth/roles.test.ts`
- Modify: `src/lib/auth/guards.ts`

- [ ] **Step 1: Write failing tests first**

Replace the entire contents of `src/lib/auth/roles.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "node:test";

// We'll mock prisma before importing roles
const mockFindUnique = mock.fn();
const mockFindMany = mock.fn();

// Mock the prisma module
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      tenantRolePermission: {
        findUnique: mockFindUnique,
        findMany: mockFindMany,
      },
    },
  },
});

// Import after mocking
const { hasFeature, FEATURES } = await import("./roles.js");

test("FEATURES contains all 10 expected keys", () => {
  assert.ok(FEATURES.includes("stores"));
  assert.ok(FEATURES.includes("designs"));
  assert.ok(FEATURES.includes("wizard"));
  assert.ok(FEATURES.includes("listings"));
  assert.ok(FEATURES.includes("auto_fulfill"));
  assert.ok(FEATURES.includes("users"));
  assert.ok(FEATURES.includes("pricing"));
  assert.ok(FEATURES.includes("integrations"));
  assert.ok(FEATURES.includes("ai_settings"));
  assert.ok(FEATURES.includes("inkhub_config"));
  assert.equal(FEATURES.length, 10);
});

test("SUPER_ADMIN always has access without DB hit", async () => {
  mockFindMany.mock.resetCalls();
  const result = await hasFeature("tenant1", "SUPER_ADMIN", "inkhub_config");
  assert.equal(result, true);
  assert.equal(mockFindMany.mock.callCount(), 0);
});

test("ADMIN with permission row returns true", async () => {
  mockFindMany.mock.mockImplementationOnce(async () => [
    { feature: "stores" }, { feature: "designs" },
  ]);
  const result = await hasFeature("tenant1", "ADMIN", "stores");
  assert.equal(result, true);
});

test("ADMIN without permission row returns false", async () => {
  mockFindMany.mock.mockImplementationOnce(async () => [
    { feature: "stores" },
  ]);
  const result = await hasFeature("tenant1", "ADMIN", "inkhub_config");
  assert.equal(result, false);
});

test("OPERATOR with feature returns true", async () => {
  mockFindMany.mock.mockImplementationOnce(async () => [
    { feature: "designs" },
  ]);
  const result = await hasFeature("tenant1", "OPERATOR", "designs");
  assert.equal(result, true);
});

test("Unknown role returns false", async () => {
  mockFindMany.mock.mockImplementationOnce(async () => []);
  const result = await hasFeature("tenant1", "UNKNOWN_ROLE", "stores");
  assert.equal(result, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/tuyen.tq/Documents/freelancer/vietminhglobal/app
npx tsx --test src/lib/auth/roles.test.ts
```

Expected: Tests fail with "hasFeature is not a function" or similar.

- [ ] **Step 3: Replace roles.ts**

Replace the entire contents of `src/lib/auth/roles.ts`:

```typescript
import { cache } from "react";
import { prisma } from "@/lib/db";

export const FEATURES = [
  "stores", "designs", "wizard", "listings", "auto_fulfill",
  "users", "pricing", "integrations", "ai_settings", "inkhub_config",
] as const;

export type Feature = typeof FEATURES[number];

// Per-request memoization: one DB query per (tenantId, role) per request
const getPermissionSet = cache(async (tenantId: string, role: string): Promise<Set<string>> => {
  const rows = await prisma.tenantRolePermission.findMany({
    where: { tenantId, role },
    select: { feature: true },
  });
  return new Set(rows.map((r) => r.feature));
});

export async function hasFeature(
  tenantId: string,
  role: string,
  feature: Feature,
): Promise<boolean> {
  if (role === "SUPER_ADMIN") return true;
  const perms = await getPermissionSet(tenantId, role);
  return perms.has(feature);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsx --test src/lib/auth/roles.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 5: Update guards.ts**

Replace the entire contents of `src/lib/auth/guards.ts`:

```typescript
import { NextResponse } from "next/server";
import { type Feature, hasFeature } from "./roles";
import { validateSession } from "./session";

export type AuthSession = NonNullable<Awaited<ReturnType<typeof validateSession>>>;

type GuardResult =
  | { session: AuthSession; response: null }
  | { session: null; response: NextResponse };

export async function requireFeature(feature: Feature): Promise<GuardResult> {
  const session = await validateSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const ok = await hasFeature(session.tenantId, session.role, feature);
  if (!ok) {
    return {
      session: null,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session, response: null };
}

export async function requireSuperAdmin(): Promise<GuardResult> {
  const session = await validateSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.role !== "SUPER_ADMIN") {
    return {
      session: null,
      response: NextResponse.json({ error: "Forbidden — SUPER_ADMIN only" }, { status: 403 }),
    };
  }
  return { session, response: null };
}

// Keep for backward compatibility — callers will be migrated in Tasks 4+5
export async function requireAdminSession(): Promise<GuardResult> {
  return requireFeature("stores");
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors related to `roles.ts` or `guards.ts`.

---

## Task 3: Layout + Sidebar Nav Filtering

**Files:**
- Modify: `src/app/(authed)/layout.tsx`
- Modify: `src/app/(authed)/AuthedShell.tsx`
- Modify: `src/app/(authed)/admin/layout.tsx`

- [ ] **Step 1: Update authed layout to fetch and pass permissions**

Replace `src/app/(authed)/layout.tsx`:

```typescript
import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { hasFeature, FEATURES, type Feature } from "@/lib/auth/roles";
import AuthedShell from "./AuthedShell";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await validateSession();
  if (!user) redirect("/login");

  // Fetch all permissions for this user in one pass
  const permissions: Feature[] = [];
  for (const feature of FEATURES) {
    if (await hasFeature(user.tenantId, user.role, feature)) {
      permissions.push(feature);
    }
  }

  return (
    <AuthedShell userRole={user.role} permissions={permissions}>
      {children}
    </AuthedShell>
  );
}
```

- [ ] **Step 2: Update AuthedShell to accept permissions and filter nav**

In `src/app/(authed)/AuthedShell.tsx`, make these changes:

**2a.** Update the `NavItemConfig` interface and arrays to include `feature`:

```typescript
interface NavItemConfig {
  label: string;
  href: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  badge?: string;
  feature?: string;
}

const NAV_ITEMS: NavItemConfig[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard size={18} /> },
  { label: "Stores", href: "/stores", icon: <Store size={18} />, feature: "stores" },
  { label: "Designs", href: "/designs", icon: <Palette size={18} />, feature: "designs" },
  { label: "Wizard", href: "/wizard", icon: <Wand2 size={18} />, feature: "wizard" },
  { label: "Listings", href: "/listings", icon: <ShoppingBag size={18} />, feature: "listings" },
  { label: "Auto Fulfill", href: "/auto-fulfill", icon: <Truck size={18} />, feature: "auto_fulfill" },
];

const ADMIN_ITEMS: NavItemConfig[] = [
  { label: "Users", href: "/admin/users", icon: <Users size={18} />, adminOnly: true, feature: "users" },
  { label: "Pricing", href: "/admin/pricing", icon: <DollarSign size={18} />, adminOnly: true, feature: "pricing" },
  { label: "AI Settings", href: "/admin/ai-settings", icon: <Bot size={18} />, adminOnly: true, feature: "ai_settings" },
  { label: "Permissions", href: "/admin/acl", icon: <Shield size={18} />, adminOnly: true },
];

const INTEGRATION_ITEMS: NavItemConfig[] = [
  { label: "Printify", href: "/integrations/printify", icon: <Puzzle size={18} />, adminOnly: true, feature: "integrations" },
  { label: "InkHub Config", href: "/admin/inkhub", icon: <Settings size={18} />, adminOnly: true, feature: "inkhub_config" },
];
```

**2b.** Add `Shield` and `Settings` to lucide imports:
```typescript
import {
  LayoutDashboard, Store, Palette, Wand2, ShoppingBag, Truck,
  Users, DollarSign, Bot, LogOut, Sparkles, Menu, X, ChevronRight,
  Puzzle, ArrowLeft, Shield, Settings,
} from "lucide-react";
```

**2c.** Update component props and filter logic:

```typescript
export default function AuthedShell({
  children,
  userRole,
  permissions,
}: {
  children: React.ReactNode;
  userRole: string;
  permissions: string[];
}) {
  // ... existing state ...

  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const isAdminOrAbove = userRole === "ADMIN" || isSuperAdmin;

  function canSee(item: NavItemConfig): boolean {
    if (item.adminOnly && !isAdminOrAbove) return false;
    if (item.feature && !isSuperAdmin && !permissions.includes(item.feature)) return false;
    return true;
  }
```

**2d.** In the nav render, filter items:

```tsx
{NAV_ITEMS.filter(canSee).map((item) => (
  <NavItem key={item.href} item={item} />
))}

{isAdminOrAbove && (
  <>
    <div className="px-5 mt-6 mb-2">...</div>
    {INTEGRATION_ITEMS.filter(canSee).map((item) => (
      <NavItem key={item.href} item={item} />
    ))}
  </>
)}

{isAdminOrAbove && (
  <>
    <div className="px-5 mt-6 mb-2">...</div>
    {ADMIN_ITEMS.filter(canSee).map((item) => (
      <NavItem key={item.href} item={item} />
    ))}
    {/* Permissions tab — SUPER_ADMIN only */}
    {isSuperAdmin && <NavItem item={{ label: "Permissions", href: "/admin/acl", icon: <Shield size={18} /> }} />}
  </>
)}
```

Note: "Permissions" is already in `ADMIN_ITEMS` without a `feature` key so `canSee` will show it for any admin. Remove it from ADMIN_ITEMS and render it explicitly only for SUPER_ADMIN in the JSX above, OR keep it in ADMIN_ITEMS but set `adminOnly: true` and gate it differently. The simplest approach: add a `superAdminOnly?: boolean` field and filter accordingly:

```typescript
interface NavItemConfig {
  // ...existing fields...
  superAdminOnly?: boolean;
}

// In canSee:
function canSee(item: NavItemConfig): boolean {
  if (item.superAdminOnly && !isSuperAdmin) return false;
  if (item.adminOnly && !isAdminOrAbove) return false;
  if (item.feature && !isSuperAdmin && !permissions.includes(item.feature)) return false;
  return true;
}

// In ADMIN_ITEMS:
{ label: "Permissions", href: "/admin/acl", icon: <Shield size={18} />, superAdminOnly: true },
```

- [ ] **Step 3: Update admin layout to allow SUPER_ADMIN**

Replace `src/app/(authed)/admin/layout.tsx`:

```typescript
import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await validateSession();

  if (!session || (session.role !== "ADMIN" && session.role !== "SUPER_ADMIN")) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors.

---

## Task 4: Swap Guards in Store API Routes

**Files:** All `src/app/api/stores/**` routes — replace `requireAdminSession()` with `requireFeature("stores")`.

Pattern to apply in every file listed below:
- Change: `import { requireAdminSession } from "@/lib/auth/guards";`
- To: `import { requireFeature } from "@/lib/auth/guards";`
- Change: `await requireAdminSession()`
- To: `await requireFeature("stores")`

- [ ] **Step 1: Update src/app/api/stores/route.ts**

```typescript
// Replace import line:
import { requireFeature } from "@/lib/auth/guards";
// Replace guard call:
const { session, response } = await requireFeature("stores");
```

- [ ] **Step 2: Update src/app/api/stores/[id]/route.ts** (has 2 calls)

```typescript
import { requireFeature } from "@/lib/auth/guards";
// Both GET and DELETE:
const { session, response } = await requireFeature("stores");
```

- [ ] **Step 3: Update remaining store routes** (same pattern)

Apply to each file — change the import and every `requireAdminSession()` call to `requireFeature("stores")`:
- `src/app/api/stores/[id]/test-connection/route.ts`
- `src/app/api/stores/[id]/printify/route.ts`
- `src/app/api/stores/[id]/mockup-templates/route.ts` (2 calls)
- `src/app/api/stores/[id]/catalog/route.ts`
- `src/app/api/stores/[id]/colors/route.ts`
- `src/app/api/stores/[id]/template/route.ts`
- `src/app/api/stores/[id]/variant-cache/refresh/route.ts`

- [ ] **Step 4: Update store layout files to use hasFeature**

`src/app/(authed)/stores/new/layout.tsx` — replace `canManageStoreConfig`:

```typescript
import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";

export default async function NewStoreLayout({ children }: { children: React.ReactNode }) {
  const session = await validateSession();
  if (!session || !(await hasFeature(session.tenantId, session.role, "stores"))) {
    redirect("/stores");
  }
  return <>{children}</>;
}
```

`src/app/(authed)/stores/[id]/config/layout.tsx` — same pattern:

```typescript
import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";

export default async function StoreConfigLayout({ children }: { children: React.ReactNode }) {
  const session = await validateSession();
  if (!session || !(await hasFeature(session.tenantId, session.role, "stores"))) {
    redirect("/stores");
  }
  return <>{children}</>;
}
```

- [ ] **Step 5: Update StoresClient.tsx and wizard step-3**

`src/app/(authed)/stores/StoresClient.tsx` — remove `canManageStoreConfig` import, receive `canManageStores: boolean` as a prop from the server page, pass it down. In the server `page.tsx` for stores, compute `canManageStores` via `hasFeature(...)` and pass as prop.

`src/app/(authed)/wizard/[draftId]/step-3/page.tsx` — same: remove `canManageStoreConfig` import, compute via `hasFeature` in the server component, pass boolean prop.

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: No errors about `canManageStoreConfig` or `requireAdminSession` in store files.

---

## Task 5: Swap Guards in Admin + Integrations API Routes

Pattern: In each file, replace the manual `validateSession()` + `role !== "ADMIN"` check with `requireFeature(key)`.

- [ ] **Step 1: Update src/app/api/admin/users/route.ts**

In this file there are two functions (GET and POST), each with:
```typescript
const currentUser = await validateSession();
if (!currentUser || currentUser.role !== "ADMIN") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

Replace both with:
```typescript
import { requireFeature } from "@/lib/auth/guards";

// In GET:
const { session: currentUser, response } = await requireFeature("users");
if (response) return response;

// In POST:
const { session: currentUser, response } = await requireFeature("users");
if (response) return response;
```

Also update the role dropdown in this file — the `z.enum(["ADMIN", "OPERATOR"])` schema stays as-is since SUPER_ADMIN is DB-only.

- [ ] **Step 2: Update admin/users/[id]/status and password routes**

`src/app/api/admin/users/[id]/status/route.ts` and `src/app/api/admin/users/[id]/password/route.ts` — replace manual ADMIN check with `requireFeature("users")`.

- [ ] **Step 3: Update AI settings routes**

Apply `requireFeature("ai_settings")` to:
- `src/app/api/admin/ai-settings/route.ts` (GET + PUT — both use `validateSession()` + manual ADMIN check)
- `src/app/api/admin/ai-settings/models/route.ts`
- `src/app/api/admin/ai-settings/models/refresh/route.ts`
- `src/app/api/admin/ai-settings/test-provider/route.ts`

Pattern (same for all):
```typescript
import { requireFeature } from "@/lib/auth/guards";

const { session, response } = await requireFeature("ai_settings");
if (response) return response;
```

- [ ] **Step 4: Update pricing route**

`src/app/api/admin/pricing-templates/route.ts`:
```typescript
import { requireFeature } from "@/lib/auth/guards";
const { session, response } = await requireFeature("pricing");
if (response) return response;
```

- [ ] **Step 5: Update Printify integrations routes**

Apply `requireFeature("integrations")` to:
- `src/app/api/integrations/printify/accounts/route.ts`
- `src/app/api/integrations/printify/accounts/[id]/route.ts`
- `src/app/api/integrations/printify/accounts/[id]/sync/route.ts`

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors in admin or integrations routes.

---

## Task 6: ACL API Routes

**Files:**
- Create: `src/app/api/admin/acl/route.ts`

- [ ] **Step 1: Create the ACL API route**

Create `src/app/api/admin/acl/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { FEATURES, type Feature } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";

// GET /api/admin/acl?role=ADMIN|OPERATOR
export async function GET(request: Request) {
  const { session, response } = await requireSuperAdmin();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");
  if (role !== "ADMIN" && role !== "OPERATOR") {
    return NextResponse.json({ error: "role must be ADMIN or OPERATOR" }, { status: 400 });
  }

  const rows = await prisma.tenantRolePermission.findMany({
    where: { tenantId: session.tenantId, role },
    select: { feature: true },
  });

  return NextResponse.json({ features: rows.map((r) => r.feature) });
}

// PATCH /api/admin/acl — replace all permissions for a role
export async function PATCH(request: Request) {
  const { session, response } = await requireSuperAdmin();
  if (response) return response;

  const body = await request.json();
  const { role, features } = body as { role: string; features: string[] };

  if (role !== "ADMIN" && role !== "OPERATOR") {
    return NextResponse.json({ error: "role must be ADMIN or OPERATOR" }, { status: 400 });
  }
  if (!Array.isArray(features)) {
    return NextResponse.json({ error: "features must be an array" }, { status: 400 });
  }

  const validFeatures = features.filter((f): f is Feature =>
    (FEATURES as readonly string[]).includes(f),
  );

  await prisma.$transaction([
    prisma.tenantRolePermission.deleteMany({
      where: { tenantId: session.tenantId, role },
    }),
    prisma.tenantRolePermission.createMany({
      data: validFeatures.map((feature) => ({
        tenantId: session.tenantId,
        role,
        feature,
      })),
    }),
  ]);

  return NextResponse.json({ ok: true, features: validFeatures });
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

---

## Task 7: ACL UI Page

**Files:**
- Create: `src/app/(authed)/admin/acl/page.tsx`
- Create: `src/app/(authed)/admin/acl/AclClient.tsx`

- [ ] **Step 1: Create the server page**

Create `src/app/(authed)/admin/acl/page.tsx`:

```typescript
import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import AclClient from "./AclClient";

export const metadata = { title: "Permissions — MockupAI" };

export default async function AclPage() {
  const session = await validateSession();
  if (!session || session.role !== "SUPER_ADMIN") redirect("/dashboard");

  const rows = await prisma.tenantRolePermission.findMany({
    where: { tenantId: session.tenantId, role: "ADMIN" },
    select: { feature: true },
  });
  const adminFeatures = rows.map((r) => r.feature);

  return <AclClient initialAdminFeatures={adminFeatures} />;
}
```

- [ ] **Step 2: Create AclClient component**

Create `src/app/(authed)/admin/acl/AclClient.tsx`:

```typescript
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Shield } from "lucide-react";

const WORKSPACE_FEATURES = [
  { key: "stores", label: "Stores" },
  { key: "designs", label: "Designs" },
  { key: "wizard", label: "Wizard" },
  { key: "listings", label: "Listings" },
  { key: "auto_fulfill", label: "Auto Fulfill" },
] as const;

const ADMIN_FEATURES = [
  { key: "users", label: "Users" },
  { key: "pricing", label: "Pricing" },
  { key: "integrations", label: "Integrations" },
  { key: "ai_settings", label: "AI Settings" },
  { key: "inkhub_config", label: "InkHub Config" },
] as const;

const OPERATOR_DEFAULTS = ["stores", "designs", "wizard", "listings", "auto_fulfill"];

interface Props {
  initialAdminFeatures: string[];
}

export default function AclClient({ initialAdminFeatures }: Props) {
  const [activeTab, setActiveTab] = useState<"ADMIN" | "OPERATOR">("ADMIN");
  const [adminFeatures, setAdminFeatures] = useState<Set<string>>(
    new Set(initialAdminFeatures),
  );
  const [operatorFeatures, setOperatorFeatures] = useState<Set<string>>(
    new Set(OPERATOR_DEFAULTS),
  );
  const [saving, setSaving] = useState(false);
  const [loadingOp, setLoadingOp] = useState(false);

  async function handleTabChange(tab: "ADMIN" | "OPERATOR") {
    setActiveTab(tab);
    if (tab === "OPERATOR" && !loadingOp) {
      setLoadingOp(true);
      try {
        const res = await fetch("/api/admin/acl?role=OPERATOR");
        const data = await res.json();
        setOperatorFeatures(new Set(data.features));
      } catch {
        toast.error("Không thể tải permissions");
      } finally {
        setLoadingOp(false);
      }
    }
  }

  function toggle(key: string) {
    const set = activeTab === "ADMIN" ? adminFeatures : operatorFeatures;
    const setter = activeTab === "ADMIN" ? setAdminFeatures : setOperatorFeatures;
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  function isEnabled(key: string) {
    return activeTab === "ADMIN"
      ? adminFeatures.has(key)
      : operatorFeatures.has(key);
  }

  async function handleSave() {
    setSaving(true);
    const features = activeTab === "ADMIN"
      ? Array.from(adminFeatures)
      : Array.from(operatorFeatures);
    try {
      const res = await fetch("/api/admin/acl", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: activeTab, features }),
      });
      if (res.ok) toast.success(`Đã lưu permissions cho ${activeTab}`);
      else toast.error("Lưu thất bại");
    } catch {
      toast.error("Lỗi kết nối");
    } finally {
      setSaving(false);
    }
  }

  const groups = [
    { label: "Workspace", items: WORKSPACE_FEATURES },
    { label: "Admin", items: ADMIN_FEATURES },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-section-heading" style={{ color: "var(--text-primary)" }}>
          <Shield size={22} style={{ display: "inline", marginRight: 8, verticalAlign: "text-bottom" }} />
          Permissions
        </h1>
        <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
          Cấu hình quyền truy cập theo role
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(["ADMIN", "OPERATOR"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={activeTab === tab ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Permission groups */}
      <div className="card card-lg" style={{ maxWidth: 520 }}>
        {groups.map((group) => (
          <div key={group.label} className="mb-6 last:mb-0">
            <div className="mb-3">
              <span className="text-caption" style={{
                color: "rgba(255,255,255,0.4)", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.08em",
              }}>
                {group.label}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {group.items.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between"
                  style={{
                    padding: "10px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--bg-tertiary)",
                  }}
                >
                  <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
                    {item.label}
                  </span>
                  <button
                    role="switch"
                    aria-checked={isEnabled(item.key)}
                    onClick={() => toggle(item.key)}
                    style={{
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      border: "none",
                      cursor: "pointer",
                      backgroundColor: isEnabled(item.key)
                        ? "var(--color-wise-green)"
                        : "var(--bg-surface)",
                      position: "relative",
                      transition: "background-color 0.15s",
                      flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: "absolute",
                      top: 3,
                      left: isEnabled(item.key) ? 23 : 3,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      backgroundColor: "white",
                      transition: "left 0.15s",
                    }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end mt-6">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

---

## Task 8: InkHub Credential Storage + API + Config UI

**Files:**
- Modify: `src/lib/inkhub/token.ts`
- Modify: `src/app/api/inkhub-proxy/[[...path]]/route.ts`
- Create: `src/app/api/admin/inkhub/route.ts`
- Create: `src/app/api/admin/inkhub/test/route.ts`
- Create: `src/app/(authed)/admin/inkhub/page.tsx`
- Create: `src/app/(authed)/admin/inkhub/InkhubConfigClient.tsx`

- [ ] **Step 1: Update token.ts to accept tenantId and read from DB**

Replace `src/lib/inkhub/token.ts`:

```typescript
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto/envelope";

const LOGIN_URL = "https://api-inkhub-v2.grabink.co/api/auth/login";
const BUFFER_MS = 5 * 60 * 1000;

interface TokenCache {
  token: string;
  orgId: string;
  expiresAt: number;
}

// Per-tenant token cache
const cache = new Map<string, TokenCache>();
let pendingLogin: Map<string, Promise<void>> = new Map();

function parseJwtExp(token: string): number {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64").toString("utf-8"),
  );
  return payload.exp * 1000;
}

async function getCredentials(tenantId: string): Promise<{ username: string; password: string }> {
  const row = await prisma.inkhubCredential.findUnique({
    where: { tenantId },
  });
  if (row) {
    return {
      username: row.username,
      password: decrypt(row.passwordEncrypted),
    };
  }
  // Fall back to env
  const username = process.env.INKHUB_USERNAME;
  const password = process.env.INKHUB_PASSWORD;
  if (!username || !password) throw new Error("No InkHub credentials configured");
  return { username, password };
}

async function login(tenantId: string): Promise<void> {
  const { username, password } = await getCredentials(tenantId);
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://inkhub.grabink.co",
      "referer": "https://inkhub.grabink.co/",
    },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Inkhub login failed: ${res.status}`);
  const data = (await res.json()) as {
    token: string;
    organizations: Array<{ id: number }>;
  };
  cache.set(tenantId, {
    token: data.token,
    orgId: String(data.organizations[0].id),
    expiresAt: parseJwtExp(data.token) - BUFFER_MS,
  });
}

export async function getToken(
  tenantId: string,
): Promise<{ token: string; orgId: string }> {
  const cached = cache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) {
    return { token: cached.token, orgId: cached.orgId };
  }

  if (!pendingLogin.has(tenantId)) {
    const promise = login(tenantId).finally(() => {
      pendingLogin.delete(tenantId);
    });
    pendingLogin.set(tenantId, promise);
  }
  await pendingLogin.get(tenantId)!;

  const result = cache.get(tenantId)!;
  return { token: result.token, orgId: result.orgId };
}

export function invalidateToken(tenantId: string): void {
  cache.delete(tenantId);
}

export function _resetForTest(): void {
  cache.clear();
  pendingLogin.clear();
}
```

- [ ] **Step 2: Update proxy route to pass tenantId to getToken**

In `src/app/api/inkhub-proxy/[[...path]]/route.ts`, add session validation and pass tenantId:

```typescript
import { getToken } from "@/lib/inkhub/token";
import { injectTokenScript, isTextContent, rewriteAbsolutePaths, rewriteApiUrls, rewriteRootAssets } from "@/lib/inkhub/proxy-utils";
import { validateSession } from "@/lib/auth/session";
import type { NextRequest } from "next/server";

const UPSTREAM_UI = "https://inkhub.grabink.co";

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const session = await validateSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { path } = await params;
  // ... rest of existing handler unchanged, except:
  const { token, orgId } = await getToken(session.tenantId);
  // ...
}

export const GET = handler;
```

- [ ] **Step 3: Create InkHub credential API routes**

Create `src/app/api/admin/inkhub/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto/envelope";
import { invalidateToken } from "@/lib/inkhub/token";

// GET — load current config (username only, never return password)
export async function GET() {
  const { session, response } = await requireFeature("inkhub_config");
  if (response) return response;

  const row = await prisma.inkhubCredential.findUnique({
    where: { tenantId: session.tenantId },
  });
  return NextResponse.json({ username: row?.username ?? "" });
}

// PUT — save new credentials
export async function PUT(request: Request) {
  const { session, response } = await requireFeature("inkhub_config");
  if (response) return response;

  const { username, password } = await request.json() as { username: string; password: string };
  if (!username || !password) {
    return NextResponse.json({ error: "username and password required" }, { status: 400 });
  }

  const { encrypted } = encrypt(password);

  await prisma.inkhubCredential.upsert({
    where: { tenantId: session.tenantId },
    create: { tenantId: session.tenantId, username, passwordEncrypted: encrypted },
    update: { username, passwordEncrypted: encrypted },
  });

  invalidateToken(session.tenantId);

  return NextResponse.json({ ok: true });
}
```

Create `src/app/api/admin/inkhub/test/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";

const LOGIN_URL = "https://api-inkhub-v2.grabink.co/api/auth/login";

export async function POST(request: Request) {
  const { response } = await requireFeature("inkhub_config");
  if (response) return response;

  const { username, password } = await request.json() as { username: string; password: string };
  if (!username || !password) {
    return NextResponse.json({ error: "username and password required" }, { status: 400 });
  }

  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://inkhub.grabink.co",
      "referer": "https://inkhub.grabink.co/",
    },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `Login failed: ${res.status}` });
  }

  const data = await res.json() as { organizations: Array<{ id: number }> };
  return NextResponse.json({
    ok: true,
    orgId: String(data.organizations[0]?.id ?? ""),
  });
}
```

- [ ] **Step 4: Create InkHub Config UI**

Create `src/app/(authed)/admin/inkhub/page.tsx`:

```typescript
import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import InkhubConfigClient from "./InkhubConfigClient";

export const metadata = { title: "InkHub Config — MockupAI" };

export default async function InkhubConfigPage() {
  const session = await validateSession();
  if (!session) redirect("/login");
  if (!(await hasFeature(session.tenantId, session.role, "inkhub_config"))) {
    redirect("/dashboard");
  }

  const row = await prisma.inkhubCredential.findUnique({
    where: { tenantId: session.tenantId },
  });

  return <InkhubConfigClient savedUsername={row?.username ?? ""} />;
}
```

Create `src/app/(authed)/admin/inkhub/InkhubConfigClient.tsx`:

```typescript
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Settings, CheckCircle, XCircle } from "lucide-react";

interface Props {
  savedUsername: string;
}

export default function InkhubConfigClient({ savedUsername }: Props) {
  const [username, setUsername] = useState(savedUsername);
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleTest() {
    if (!username || !password) {
      toast.error("Nhập đầy đủ username và password");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/inkhub/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      setTestResult({
        ok: data.ok,
        message: data.ok
          ? `Kết nối thành công — Org ID: ${data.orgId}`
          : data.error || "Kết nối thất bại",
      });
    } catch {
      setTestResult({ ok: false, message: "Lỗi kết nối" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!username || !password) {
      toast.error("Nhập đầy đủ username và password");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/inkhub", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        toast.success("Đã lưu InkHub credentials");
        setPassword("");
        setTestResult(null);
      } else {
        const data = await res.json();
        toast.error(data.error || "Lưu thất bại");
      }
    } catch {
      toast.error("Lỗi kết nối");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-section-heading" style={{ color: "var(--text-primary)" }}>
          <Settings size={22} style={{ display: "inline", marginRight: 8, verticalAlign: "text-bottom" }} />
          InkHub Config
        </h1>
        <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
          Tài khoản InkHub dùng để nhúng Auto Fulfill
        </p>
      </div>

      <div className="card card-lg" style={{ maxWidth: 460 }}>
        <div className="space-y-4">
          <div>
            <label className="block mb-1.5 text-caption" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Username
            </label>
            <input
              type="text"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="InkHub username"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block mb-1.5 text-caption" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={savedUsername ? "Để trống nếu không thay đổi password" : "InkHub password"}
              autoComplete="current-password"
            />
          </div>

          {testResult && (
            <div
              className="flex items-center gap-2 p-3 text-sm"
              style={{
                borderRadius: "var(--radius-sm)",
                backgroundColor: testResult.ok
                  ? "rgba(159,232,112,0.1)"
                  : "rgba(208,50,56,0.08)",
                color: testResult.ok ? "var(--color-wise-green)" : "var(--color-danger)",
              }}
            >
              {testResult.ok
                ? <CheckCircle size={16} />
                : <XCircle size={16} />}
              {testResult.message}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? "Đang test..." : "Test Connection"}
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Final TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Run all tests**

```bash
npx tsx --test src/lib/auth/roles.test.ts src/lib/inkhub/proxy-utils.test.ts
```

Expected: All tests pass.

- [ ] **Step 7: Start dev server and smoke test**

```bash
pnpm dev
```

Verify:
1. Login as SUPER_ADMIN → see "Permissions" and "InkHub Config" in sidebar
2. Go to `/admin/acl` → two tabs, toggles, save works
3. Go to `/admin/inkhub` → form loads, Test Connection works
4. Login as ADMIN → no "Permissions" or "InkHub Config" tabs visible
5. Login as OPERATOR → only workspace tabs visible

---

## Self-Review

**Spec coverage check:**
- ✓ SUPER_ADMIN role added (Task 1)
- ✓ TenantRolePermission table (Task 1)
- ✓ InkhubCredential table (Task 1)
- ✓ Default permissions seeded (Task 1 Step 3-4)
- ✓ hasFeature + requireFeature + requireSuperAdmin (Task 2)
- ✓ Per-request memoization via React.cache() (Task 2 Step 3)
- ✓ Admin layout allows SUPER_ADMIN (Task 3)
- ✓ Sidebar nav filtered by permissions (Task 3)
- ✓ Store API routes updated (Task 4)
- ✓ Admin/integrations API routes updated (Task 5)
- ✓ ACL GET + PATCH API (Task 6)
- ✓ ACL tab UI with Workspace / Admin groups (Task 7)
- ✓ token.ts reads from DB, falls back to env (Task 8)
- ✓ InkHub PUT + test API (Task 8)
- ✓ InkHub Config UI with Test Connection (Task 8)

**Note on `canManageStoreConfig` / `canReadStorePreset`:** These are removed from `roles.ts` in Task 2. All remaining call sites (StoresClient, layout files, wizard step-3) are handled in Task 4 Steps 4-5. After Task 4, `canManageStoreConfig` should have zero references in the codebase.
