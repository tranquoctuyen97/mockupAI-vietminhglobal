# Dynamic RBAC — Design Spec

**Goal:** Replace the hardcoded 2-role system (ADMIN / OPERATOR) with a 3-role system (SUPER_ADMIN / ADMIN / OPERATOR) where SUPER_ADMIN can dynamically configure which features each role can access, per tenant.

**Architecture:** Feature-flag RBAC stored in a `tenant_role_permissions` table. SUPER_ADMIN is hardcoded (always full access). ADMIN and OPERATOR start with sensible defaults; SUPER_ADMIN adjusts via a tab-based ACL UI. InkHub credentials move from env variables to an encrypted DB table, configurable via a dedicated UI page.

**Tech Stack:** Prisma (PostgreSQL), Next.js App Router, AES-256-GCM encryption (Node.js `crypto`), React server components + client components.

---

## 1. Role Hierarchy

| Role | Description |
|------|-------------|
| `SUPER_ADMIN` | Hardcoded full access — cannot be restricted by ACL config |
| `ADMIN` | Configurable — defaults to most features except `inkhub_config` |
| `OPERATOR` | Configurable — defaults to workspace features only |

SUPER_ADMIN cannot be assigned via the normal Users page. It must be set directly in the database (seed/migration) to prevent privilege escalation.

---

## 2. Feature Keys

Ten feature keys cover all pages and capabilities:

| Key | Label | Group | Default ADMIN | Default OPERATOR |
|-----|-------|-------|:---:|:---:|
| `stores` | Stores | Workspace | ✓ | ✓ |
| `designs` | Designs | Workspace | ✓ | ✓ |
| `wizard` | Wizard | Workspace | ✓ | ✓ |
| `listings` | Listings | Workspace | ✓ | ✓ |
| `auto_fulfill` | Auto Fulfill | Workspace | ✓ | ✓ |
| `users` | Users | Admin | ✓ | ✗ |
| `pricing` | Pricing | Admin | ✓ | ✗ |
| `integrations` | Integrations | Admin | ✓ | ✗ |
| `ai_settings` | AI Settings | Admin | ✓ | ✗ |
| `inkhub_config` | InkHub Config | Admin | ✗ | ✗ |

---

## 3. Data Model

### 3a. UserRole enum

```prisma
enum UserRole {
  SUPER_ADMIN
  ADMIN
  OPERATOR
}
```

### 3b. TenantRolePermission table

```prisma
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
```

One row = one (tenant, role, feature) triple is **enabled**. Absence of a row means the feature is disabled for that role.

### 3c. InkhubCredential table

```prisma
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

Password encrypted with AES-256-GCM. Key sourced from `ENCRYPTION_KEY` env var (same pattern as Shopify token encryption already in codebase).

### 3d. Migration seed

The Prisma migration inserts default `TenantRolePermission` rows for all existing tenants using the defaults table in Section 2. New tenants get defaults inserted when the first SUPER_ADMIN of that tenant is created.

---

## 4. Enforcement

### 4a. `src/lib/auth/roles.ts`

Replace `canManageStoreConfig` / `canReadStorePreset` with a single async function:

```typescript
export const FEATURES = [
  "stores", "designs", "wizard", "listings", "auto_fulfill",
  "users", "pricing", "integrations", "ai_settings", "inkhub_config",
] as const;

export type Feature = typeof FEATURES[number];

export async function hasFeature(
  tenantId: string,
  role: string,
  feature: Feature,
): Promise<boolean> {
  if (role === "SUPER_ADMIN") return true;
  const row = await prisma.tenantRolePermission.findUnique({
    where: { tenantId_role_feature: { tenantId, role, feature } },
  });
  return row !== null;
}
```

Memoized per request using `React.cache()` to avoid repeated DB hits on the same page load.

### 4b. `src/lib/auth/guards.ts`

```typescript
export async function requireFeature(feature: Feature): Promise<
  | { session: AuthSession; response: null }
  | { session: null; response: NextResponse }
> {
  const session = await validateSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const ok = await hasFeature(session.tenantId, session.role, feature);
  if (!ok) {
    return { session: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, response: null };
}

export async function requireSuperAdmin(): Promise<...> {
  const session = await validateSession();
  if (!session || session.role !== "SUPER_ADMIN") {
    return { session: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, response: null };
}
```

### 4c. API route migration

Each existing route replaces `requireAdminSession()` with `requireFeature(key)`:

| Route | Feature key |
|-------|-------------|
| `/api/admin/ai-settings` | `ai_settings` |
| `/api/admin/users` | `users` |
| `/api/admin/pricing-templates` | `pricing` |
| `/api/integrations/printify/**` | `integrations` |
| `/api/admin/acl` | SUPER_ADMIN only |
| `/api/admin/inkhub` | `inkhub_config` |

### 4d. Admin layout

`src/app/(authed)/admin/layout.tsx` — gate changes from `role !== "ADMIN"` to `role !== "ADMIN" && role !== "SUPER_ADMIN"`.

Individual sub-pages (`ai-settings`, `users`, etc.) already protected at API level; layout just prevents blank-page confusion.

### 4e. Sidebar nav

`AuthedShell.tsx` receives a `permissions: Feature[]` prop from the server layout. Each `NAV_ITEMS` and `ADMIN_ITEMS` entry gains an optional `feature?: Feature` field. Items are filtered client-side before render. SUPER_ADMIN always sees all items.

---

## 5. ACL UI

**Route:** `/admin/acl` (SUPER_ADMIN only — added to sidebar as "Permissions")

**Component:** `src/app/(authed)/admin/acl/page.tsx` (server) + `AclClient.tsx` (client)

**Behaviour:**
- Two tabs: **ADMIN** | **OPERATOR**
- Each tab shows two groups: Workspace / Admin
- Each feature row has a toggle switch
- Toggling updates local state only — no auto-save
- **Save** button calls `PATCH /api/admin/acl` with `{ role, features: string[] }` — replaces all permissions for that role for the current tenant
- Toast success / error after save
- Switching tabs re-fetches permissions for the selected role from `GET /api/admin/acl?role=ADMIN`

**API:**
- `GET /api/admin/acl?role=ADMIN|OPERATOR` → `{ features: string[] }`
- `PATCH /api/admin/acl` body `{ role, features: string[] }` → delete all rows for (tenantId, role) then insert new set

---

## 6. InkHub Config UI

**Route:** `/admin/inkhub` (gated by `inkhub_config` feature — SUPER_ADMIN by default)

**Component:** `src/app/(authed)/admin/inkhub/page.tsx` (server) + `InkhubConfigClient.tsx` (client)

**Form fields:** Username, Password (masked input)

**Buttons:**
- **Test Connection** — calls `POST /api/admin/inkhub/test` with `{ username, password }`, hits InkHub login API, returns success/failure without saving
- **Save** — calls `PUT /api/admin/inkhub` with `{ username, password }`, encrypts password, upserts `InkhubCredential`, invalidates in-memory token cache

**`src/lib/inkhub/token.ts` changes:**
- `login()` reads credentials from `InkhubCredential` DB row for the current tenant first
- Falls back to `process.env.INKHUB_USERNAME` / `INKHUB_PASSWORD` if no DB row exists
- Token cache invalidated when credentials are updated (exported `_resetForTest()` already exists)

---

## 7. Files Changed / Created

| Action | Path |
|--------|------|
| Modify | `prisma/schema.prisma` |
| Create | `prisma/migrations/..._rbac_inkhub` |
| Modify | `src/lib/auth/roles.ts` |
| Modify | `src/lib/auth/guards.ts` |
| Modify | `src/lib/auth/roles.test.ts` |
| Modify | `src/lib/inkhub/token.ts` |
| Create | `src/lib/crypto/encrypt.ts` (AES-256-GCM helpers) |
| Modify | `src/app/(authed)/layout.tsx` (pass permissions to shell) |
| Modify | `src/app/(authed)/AuthedShell.tsx` (filter nav by permissions) |
| Modify | `src/app/(authed)/admin/layout.tsx` (allow SUPER_ADMIN) |
| Create | `src/app/(authed)/admin/acl/page.tsx` |
| Create | `src/app/(authed)/admin/acl/AclClient.tsx` |
| Create | `src/app/(authed)/admin/inkhub/page.tsx` |
| Create | `src/app/(authed)/admin/inkhub/InkhubConfigClient.tsx` |
| Create | `src/app/api/admin/acl/route.ts` |
| Create | `src/app/api/admin/inkhub/route.ts` |
| Create | `src/app/api/admin/inkhub/test/route.ts` |
| Modify | `src/app/api/admin/ai-settings/route.ts` (swap guard) |
| Modify | `src/app/api/admin/users/route.ts` (swap guard) |
| Modify | `src/app/api/admin/pricing-templates/route.ts` (swap guard) |
| Modify | `src/app/api/integrations/printify/**` (swap guard) |
