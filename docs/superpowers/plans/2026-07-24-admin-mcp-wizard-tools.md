# Admin MCP Wizard Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ADMIN-owned remote MCP server whose documented tools create, review, and submit the existing listing wizard without giving SUPER_ADMIN control of another ADMIN's MCP credentials and without changing the current publish worker contract.

**Architecture:** A dedicated `mockupai-mcp` HTTP process authenticates ADMIN-owned PAT or OAuth credentials, resolves current app permissions on every call, applies Redis rate limits and database idempotency, then calls shared wizard/publish application services directly. Browser routes and MCP tools share the same checklist and publish-submission service; only the existing `PublishOutbox` dispatcher enqueues `publish-jobs`.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, `@modelcontextprotocol/sdk` 1.x Streamable HTTP, Zod 4, Redis/ioredis, BullMQ, Sharp, Node `http`, `node:test` through `tsx --test`, PM2, Nginx.

**Approved specs:**

- `docs/superpowers/specs/2026-07-23-admin-mcp-wizard-tools-design.md`
- `docs/superpowers/specs/2026-07-23-admin-mcp-wizard-tools-stitch-design.md`
- `docs/superpowers/specs/2026-07-24-admin-mcp-tools-catalog.md`

## Global Constraints

- SUPER_ADMIN only grants or removes the normal `mcp_access` role permission. SUPER_ADMIN never creates, displays, rotates, revokes, or configures another ADMIN's MCP profile or credential.
- The persisted feature key follows the repo's lowercase convention as `mcp_access`; user-facing copy and MCP documentation display `MCP_ACCESS`.
- Only an active `ADMIN` with current `mcp_access` may create or resume a profile. One profile belongs to one ADMIN; the profile may have multiple independent PAT/OAuth credentials.
- Removing `mcp_access`, disabling the user, or moving the user away from `ADMIN` suspends the profile immediately. Restoring permission does not reactivate it; the owner must use `Resume MCP`.
- There is no per-user store ACL in this phase. An authenticated MCP ADMIN may list and use every store inside their tenant. A default store is convenience state, not authorization state.
- Effective tool permission is the intersection of current app features, enabled profile state, active credential scope snapshot, and tenant-bound resource resolution. Credential scope can narrow but never expand app permissions and never auto-expands after later grants.
- MCP accepts design/mockup URL inputs only. No multipart, base64, upload session, or client filesystem path is added.
- URL imports intentionally allow public, localhost, private, link-local, and internal HTTP/HTTPS sources. This is an accepted blind-SSRF risk. Import is image-only, `GET`/`HEAD` only, no caller headers/cookies/credentials, PNG/JPEG magic bytes, 100 MB maximum, five redirects, and 30-second total timeout.
- URL designs and custom mockups are draft-scoped temporary assets. They never appear in Design Library or Mockup Library.
- Template `defaultMockupSource` is the only authority for `PRINTIFY` versus `CUSTOM`. Do not add another MCP mockup-source field.
- `review_wizard` produces a revision token. `publish_listing` requires the current token, repeats permission/readiness validation, and is registered with `destructiveHint: true`.
- The MCP process never calls internal Next.js routes, never publishes to Shopify/Printify directly, never calls `Queue.add()` for publish, never creates a second publish queue, and never changes `publish-jobs` payload `{ listingId, draftId, tenantId, publishAttemptId }`.
- Existing worker retry, cooldown, merchant lock, concurrency, attempt, job, and outbox behavior remains unchanged.
- No application feature flag is introduced. Operational shutdown is permission removal, profile suspension, stopping `mockupai-mcp`, or removing the Nginx `/mcp` location.
- Use top-level static imports. Do not add dynamic `import()` in application functions.
- Do not `git add` or commit during execution. The user stages and commits changes.

## Delivery Sequence And Hard Gates

| Phase | Deliverable | Gate before next phase |
| --- | --- | --- |
| 1 | Shared checklist and publish submission service | Existing UI publish characterization and worker contract tests pass |
| 2 | MCP profile, credential, OAuth, permission, rate-limit, idempotency, transport | PAT and OAuth protocol tests pass; `/mcp` has no wizard mutations yet |
| 3 | Temporary URL assets and discovery/wizard tools | URL, tenant, library exclusion, custom coverage, and cleanup tests pass |
| 4 | Review token, publish/status tools, all 16 runtime registrations | UI/MCP publish-equivalence and stale-revision tests pass |
| 5 | ADMIN self-service UI, Tool Reference, PM2/Nginx/deploy | Build, source tests, MCP Inspector smoke, and existing worker smoke pass |

Do not enable the production `/mcp` proxy before Phase 4 passes.

## File Structure

### Shared application services

- Create `src/lib/wizard/checklist.ts` — route-independent readiness checklist.
- Create `src/lib/wizard/publish-submission.ts` — sole UI/MCP publish transaction entry.
- Create `src/lib/wizard/revision.ts` — canonical reviewed-state hash and signed revision token.
- Create `src/lib/wizard/query.ts` — normalized draft/config/status reads used by browser and MCP adapters.
- Modify `src/app/api/wizard/drafts/[id]/checklist.ts` — compatibility re-export only.
- Modify `src/app/api/wizard/drafts/[id]/publish/route.ts` — thin browser adapter.

### MCP identity and runtime

- Create `src/lib/mcp/contracts.ts` — auth context, scopes, stable result/error types.
- Create `src/lib/mcp/profile-service.ts` — owner lifecycle and suspension/resume rules.
- Create `src/lib/mcp/credential-service.ts` — PAT create/verify/revoke/rotate.
- Create `src/lib/mcp/oauth-service.ts` — dynamic client registration, PKCE codes, access/refresh grants.
- Create `src/lib/mcp/permission-service.ts` — current app feature and credential-scope intersection.
- Create `src/lib/mcp/rate-limit.ts` — Redis buckets by profile/tool class.
- Create `src/lib/mcp/idempotency.ts` — request hash and stored result replay.
- Create `src/lib/mcp/http-server.ts` — authenticated stateless Streamable HTTP entry.
- Create `src/lib/mcp/server.ts` — one `McpServer` registry per authenticated request.
- Create `start-mcp.ts` — standalone process bootstrap and shutdown.

### Temporary asset and wizard tools

- Create `src/lib/mcp/assets/fetch-image.ts` — bounded HTTP/HTTPS image fetcher.
- Create `src/lib/mcp/assets/temporary-design.ts` — Design-compatible temporary record.
- Create `src/lib/mcp/assets/temporary-mockup.ts` — draft custom COMPOSITE sources.
- Create `src/lib/mcp/assets/cleanup.ts` — 24-hour/7-day/30-day retention.
- Create `src/lib/mcp/tools/catalog.ts` — runtime title, description, schemas, permissions, annotations.
- Create `src/lib/mcp/tools/discovery.ts` — list/search/config reads.
- Create `src/lib/mcp/tools/wizard.ts` — draft and wizard mutation handlers.
- Create `src/lib/mcp/tools/review-publish.ts` — review/publish/status handlers.
- Modify `src/lib/mockup/generation.ts`, `src/lib/mockup/source.ts`, and `src/lib/mockup/source-url.ts` — consume temporary custom mockups through the existing COMPOSITE flow.

### Browser self-service and operations

- Create `src/app/(authed)/account/layout.tsx` and account MCP pages/components.
- Create `src/app/api/account/mcp/**/route.ts` — owner-only profile/credential/default APIs.
- Create `src/app/.well-known/oauth-authorization-server/route.ts`.
- Create `src/app/.well-known/oauth-protected-resource/route.ts`.
- Create `src/app/api/mcp/oauth/register/route.ts`, `authorize/route.ts`, and `token/route.ts`.
- Modify ADMIN ACL and users routes/pages for `mcp_access` and read-only MCP status.
- Modify `package.json`, `biome.json`, `ecosystem.config.js`, `ops/deploy-vps.sh`, and `setup-nginx.sh`.

---

## Phase 1 — Preserve The Existing Wizard And Publish Worker

### Task 1: Freeze the current publish contract with characterization tests

**Files:**

- Modify: `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`
- Create: `src/lib/wizard/publish-contract.test.ts`
- Read only: `src/lib/publish/queue.ts`
- Read only: `src/lib/publish/outbox.ts`
- Read only: `src/lib/jobs/workers/publish-worker.ts`

**Interfaces:**

- Consumes: current browser publish route.
- Produces: regression assertions that every later task must preserve.

- [ ] **Step 1: Add the worker-boundary source test**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/wizard/drafts/[id]/publish/route.ts", "utf8");
const queue = readFileSync("src/lib/publish/queue.ts", "utf8");
const outbox = readFileSync("src/lib/publish/outbox.ts", "utf8");

test("publish submission persists outbox work and never enqueues inline", () => {
  assert.match(route, /publishOutbox\.create/);
  assert.doesNotMatch(route, /\.add\(/);
  assert.match(queue, /PUBLISH_QUEUE_NAME = "publish-jobs"/);
  assert.match(outbox, /listingId[\s\S]*draftId[\s\S]*tenantId[\s\S]*publishAttemptId/);
});
```

- [ ] **Step 2: Run the baseline tests**

Run:

```bash
./node_modules/.bin/tsx --test \
  'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts' \
  'src/app/api/wizard/drafts/[id]/publish-pair-source.test.ts' \
  src/lib/jobs/workers/publish-worker.test.ts \
  src/lib/publish/outbox.test.ts \
  src/lib/publish/queue.test.ts \
  src/lib/wizard/publish-contract.test.ts
```

Expected: PASS. If the new assertion does not match the current source, correct the test to capture the current persisted contract before extraction; do not change production behavior in this step.

- [ ] **Step 3: Record the immutable payload in the test**

Assert this exact type in `src/lib/wizard/publish-contract.test.ts`:

```ts
type PublishQueuePayload = {
  listingId: string;
  draftId: string;
  tenantId: string;
  publishAttemptId: string;
};

const payload: PublishQueuePayload = {
  listingId: "listing_1",
  draftId: "draft_1",
  tenantId: "tenant_1",
  publishAttemptId: "attempt_1",
};
assert.deepEqual(Object.keys(payload), [
  "listingId",
  "draftId",
  "tenantId",
  "publishAttemptId",
]);
```

- [ ] **Step 4: Re-run the baseline command**

Expected: all listed tests pass with zero production changes.

- [ ] **Step 5: Checkpoint without staging or committing**

Run `git status --short` and retain the output for the phase handoff.

### Task 2: Move the readiness checklist into a shared library

**Files:**

- Create: `src/lib/wizard/checklist.ts`
- Modify: `src/app/api/wizard/drafts/[id]/checklist.ts`
- Modify: `src/app/api/wizard/drafts/[id]/route.test.ts`
- Create: `src/lib/wizard/checklist.test.ts`

**Interfaces:**

- Produces:

```ts
export type WizardChecklist = {
  mockupsMatchColors: boolean;
  contentComplete: boolean;
  placementValid: boolean;
  mockupsNotStale: boolean;
  colorGroupsBalanced: boolean;
  readyToPublish: boolean;
};

export async function buildChecklist(draft: any): Promise<WizardChecklist>;
```

Keep `any` in this extraction task because the current checklist's route-loaded object and
focused test fixtures are intentionally partial. Replacing it with a shared Prisma payload
type is a separate refactor and is not required for MCP correctness.

- [ ] **Step 1: Move the existing implementation without behavioral edits**

Copy the complete current body and its static imports from
`src/app/api/wizard/drafts/[id]/checklist.ts` into `src/lib/wizard/checklist.ts`. Export the
`WizardChecklist` return type and keep all six current checks.

- [ ] **Step 2: Leave a compatibility re-export**

Replace the route-local file with:

```ts
export { buildChecklist } from "@/lib/wizard/checklist";
export type { WizardChecklist } from "@/lib/wizard/checklist";
```

- [ ] **Step 3: Move direct checklist tests to the library**

Move the `describe("buildChecklist", ...)` cases from
`src/app/api/wizard/drafts/[id]/route.test.ts` into `src/lib/wizard/checklist.test.ts` and
change the import to:

```ts
import { buildChecklist } from "./checklist";
```

- [ ] **Step 4: Run checklist and route tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/wizard/checklist.test.ts \
  'src/app/api/wizard/drafts/[id]/route.test.ts'
```

Expected: all existing readiness cases pass unchanged.

- [ ] **Step 5: Check static imports**

```bash
rg -n 'await import|import\(' src/lib/wizard/checklist.ts
```

Expected: no output.

### Task 3: Extract the browser publish transaction into one shared service

**Files:**

- Create: `src/lib/wizard/publish-submission.ts`
- Create: `src/lib/wizard/publish-submission.test.ts`
- Modify: `src/app/api/wizard/drafts/[id]/publish/route.ts`
- Modify: `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`
- Modify: `src/app/api/wizard/drafts/[id]/publish-pair-source.test.ts`

**Interfaces:**

- Produces:

```ts
export type PublishSubmissionInput = {
  tenantId: string;
  actorUserId: string;
  draftId: string;
  priceUsd?: number | string | null;
};

export type PublishSubmission = {
  listingId: string;
  publishAttemptId: string | null;
  pairId: string | null;
  draftDesignId: string | null;
  designId: string;
  designName: string;
  status: string;
  alreadyPublished: boolean;
};

export class PublishSubmissionError extends Error {
  constructor(
    public readonly code:
      | "RESOURCE_NOT_FOUND"
      | "VALIDATION_FAILED"
      | "CHECKLIST_NOT_READY",
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function submitWizardPublish(
  input: PublishSubmissionInput,
): Promise<{ draftId: string; submissions: PublishSubmission[] }>;

export function createPublishSubmissionService(deps: {
  loadDraft(input: PublishSubmissionInput): Promise<any | null>;
  buildChecklist(draft: any): Promise<WizardChecklist>;
  executeTransaction(
    input: PublishSubmissionInput,
    draft: any,
  ): Promise<PublishSubmission[]>;
}): typeof submitWizardPublish;
```

- [ ] **Step 1: Write failing service tests**

Cover these observable cases using an injected transaction adapter or a small repository
interface defined in the test:

```ts
test("rejects before transaction when checklist is not ready", async () => {
  let transactionCalls = 0;
  const submit = createPublishSubmissionService({
    loadDraft: async () => ({ id: "draft_1" }),
    buildChecklist: async () => ({
      mockupsMatchColors: false,
      contentComplete: true,
      placementValid: true,
      mockupsNotStale: true,
      colorGroupsBalanced: true,
      readyToPublish: false,
    }),
    executeTransaction: async () => {
      transactionCalls += 1;
      return [];
    },
  });

  await assert.rejects(
    () =>
      submit({
        tenantId: "tenant_1",
        actorUserId: "user_1",
        draftId: "draft_1",
      }),
    (error: unknown) =>
      error instanceof PublishSubmissionError &&
      error.code === "CHECKLIST_NOT_READY",
  );
  assert.equal(transactionCalls, 0);
});

test("returns one publishAttemptId per created listing", async () => {
  const submit = createPublishSubmissionService({
    loadDraft: async () => ({ id: "draft_1" }),
    buildChecklist: async () => ({
      mockupsMatchColors: true,
      contentComplete: true,
      placementValid: true,
      mockupsNotStale: true,
      colorGroupsBalanced: true,
      readyToPublish: true,
    }),
    executeTransaction: async () => [
      {
        listingId: "listing_1",
        publishAttemptId: "attempt_1",
        pairId: null,
        draftDesignId: "draft_design_1",
        designId: "design_1",
        designName: "Design 1",
        status: "PUBLISHING",
        alreadyPublished: false,
      },
      {
        listingId: "listing_2",
        publishAttemptId: "attempt_2",
        pairId: "pair_1",
        draftDesignId: "draft_design_2",
        designId: "design_2",
        designName: "Pair 1",
        status: "PUBLISHING",
        alreadyPublished: false,
      },
    ],
  });
  const result = await submit({
    tenantId: "tenant_1",
    actorUserId: "user_1",
    draftId: "draft_1",
  });
  assert.equal(result.submissions.length, 2);
  assert.ok(result.submissions.every((item) => item.publishAttemptId));
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
./node_modules/.bin/tsx --test src/lib/wizard/publish-submission.test.ts
```

Expected: FAIL because the shared service does not exist.

- [ ] **Step 3: Move the route logic into the service**

The service must perform this order:

```ts
const draft = await loadPublishDraft(input.draftId, input.tenantId);
if (!draft) throw new PublishSubmissionError("RESOURCE_NOT_FOUND", "Draft not found", 404);

const checklist = await buildChecklist(draft);
if (!checklist.readyToPublish) {
  throw new PublishSubmissionError(
    "CHECKLIST_NOT_READY",
    "Wizard is not ready to publish",
    409,
    { checklist },
  );
}

return prisma.$transaction(async (tx) => {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.tenantId}), hashtext(${input.draftId}))`,
  );
  // Preserve the current pair loop, independent-design loop, retry rules,
  // PublishAttempt rows, two stage jobs, PublishOutbox row, and active pointer.
});
```

Every created/retried listing must return the attempt created in the same transaction:

```ts
const attempt = await createPublishAttemptForListing(...);
createdListings.push({
  listingId: listing.id,
  publishAttemptId: attempt.id,
  pairId: pair.id,
  draftDesignId: listing.wizardDraftDesignId,
  designId: pair.lightDesign.designId,
  designName: pair.baseName,
  status: "PUBLISHING",
  alreadyPublished: false,
});
```

For an already-active listing where no new attempt is created, resolve its current
`activePublishAttemptId` and return that ID or `null`.

- [ ] **Step 4: Reduce the route to an adapter**

The route keeps session parsing and HTTP mapping only:

```ts
import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import {
  PublishSubmissionError,
  submitWizardPublish,
} from "@/lib/wizard/publish-submission";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: draftId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    priceUsd?: number | string | null;
  };

  try {
    const result = await submitWizardPublish({
      tenantId: session.tenantId,
      actorUserId: session.id,
      draftId,
      priceUsd: body.priceUsd,
    });
    return NextResponse.json({ listings: result.submissions });
  } catch (error) {
    if (error instanceof PublishSubmissionError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    throw error;
  }
}
```

- [ ] **Step 5: Run the Phase 1 gate**

```bash
./node_modules/.bin/tsx --test \
  src/lib/wizard/checklist.test.ts \
  src/lib/wizard/publish-submission.test.ts \
  'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts' \
  'src/app/api/wizard/drafts/[id]/publish-pair-source.test.ts' \
  src/lib/jobs/workers/publish-worker.test.ts \
  src/lib/publish/outbox.test.ts \
  src/lib/publish/queue.test.ts
```

Expected: PASS. Source tests must now assert that the route calls
`submitWizardPublish`; transaction/outbox assertions move to the service test.

---

## Phase 2 — MCP Identity, Permission, Rate Limits, And Transport

### Task 4: Add the MCP permission key and persistence schema

**Files:**

- Modify: `src/lib/auth/roles.ts`
- Modify: `src/lib/auth/roles.test.ts`
- Modify: `src/app/(authed)/admin/acl/AclClient.tsx`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260724090000_admin_mcp_profile_and_credentials/migration.sql`
- Create: `src/lib/mcp/schema-contract.test.ts`

**Interfaces:**

- Produces Prisma models `McpProfile`, `McpCredential`, global `McpOAuthClient`,
  `McpOAuthAuthorizationCode`, `McpOAuthGrant`, `McpIdempotencyRecord`, and the internal
  (not client-visible) `McpAssetTransfer`.

- [ ] **Step 1: Add a failing feature test**

```ts
test("FEATURES exposes the MCP master gate", () => {
  assert.ok(FEATURES.includes("mcp_access"));
});
```

Update the expected feature count rather than retaining the old literal `11`.

- [ ] **Step 2: Add `mcp_access` to role configuration**

Append `"mcp_access"` to `FEATURES` and add:

```ts
{ key: "mcp_access", label: "MCP Access" }
```

to the ADMIN permission group. Do not add it to operator defaults.

- [ ] **Step 3: Add Prisma enums and models**

Use these exact lifecycle values:

```prisma
enum McpProfileStatus {
  SETUP_INCOMPLETE
  ENABLED
  DISABLED
  SUSPENDED
}

enum McpCredentialStatus {
  ACTIVE
  REVOKED
}

enum McpIdempotencyStatus {
  IN_PROGRESS
  SUCCEEDED
}

enum McpAssetTransferStatus {
  FETCHING
  READY
  ATTACHED
  FAILED
}

enum McpAssetKind {
  DESIGN
  MOCKUP
}

model McpProfile {
  id                  String           @id @default(cuid())
  tenantId            String           @map("tenant_id")
  ownerUserId         String           @unique @map("owner_user_id")
  status              McpProfileStatus @default(SETUP_INCOMPLETE)
  suspensionReason    String?          @map("suspension_reason")
  version             Int              @default(1)
  defaultStoreId      String?          @map("default_store_id")
  toolPreferences     Json?            @map("tool_preferences")
  enabledAt           DateTime?        @map("enabled_at")
  resumedAt           DateTime?        @map("resumed_at")
  createdAt           DateTime         @default(now()) @map("created_at")
  updatedAt           DateTime         @updatedAt @map("updated_at")

  tenant              Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  owner               User             @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  defaultStore        Store?           @relation(fields: [defaultStoreId], references: [id], onDelete: SetNull)
  credentials         McpCredential[]
  oauthGrants         McpOAuthGrant[]
  authorizationCodes  McpOAuthAuthorizationCode[]
  idempotencyRecords  McpIdempotencyRecord[]
  assetTransfers      McpAssetTransfer[]

  @@index([tenantId, status])
  @@map("mcp_profiles")
}

model McpCredential {
  id          String              @id @default(cuid())
  profileId   String              @map("profile_id")
  label       String
  tokenHash   String              @unique @map("token_hash")
  tokenPrefix String              @map("token_prefix")
  scopes      String[]
  status      McpCredentialStatus @default(ACTIVE)
  expiresAt   DateTime            @map("expires_at")
  lastUsedAt  DateTime?           @map("last_used_at")
  revokedAt   DateTime?           @map("revoked_at")
  createdAt   DateTime            @default(now()) @map("created_at")

  profile McpProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, status])
  @@map("mcp_credentials")
}
```

Add the OAuth and operation tables with these fields:

```prisma
model McpOAuthClient {
  id                      String   @id @default(cuid())
  clientId                String   @unique @map("client_id")
  clientName              String   @map("client_name")
  redirectUris            String[] @map("redirect_uris")
  grantTypes              String[] @map("grant_types")
  responseTypes           String[] @map("response_types")
  tokenEndpointAuthMethod String   @default("none") @map("token_endpoint_auth_method")
  createdAt               DateTime @default(now()) @map("created_at")
  updatedAt               DateTime @updatedAt @map("updated_at")

  authorizationCodes McpOAuthAuthorizationCode[]
  grants             McpOAuthGrant[]

  @@map("mcp_oauth_clients")
}

model McpOAuthAuthorizationCode {
  id                  String    @id @default(cuid())
  profileId           String    @map("profile_id")
  oauthClientId       String    @map("oauth_client_id")
  codeHash            String    @unique @map("code_hash")
  redirectUri         String    @map("redirect_uri")
  codeChallenge       String    @map("code_challenge")
  codeChallengeMethod String    @default("S256") @map("code_challenge_method")
  scopes              String[]
  expiresAt           DateTime  @map("expires_at")
  consumedAt          DateTime? @map("consumed_at")
  createdAt           DateTime  @default(now()) @map("created_at")

  profile McpProfile     @relation(fields: [profileId], references: [id], onDelete: Cascade)
  client  McpOAuthClient @relation(fields: [oauthClientId], references: [id], onDelete: Cascade)

  @@index([profileId, expiresAt])
  @@map("mcp_oauth_authorization_codes")
}

model McpOAuthGrant {
  id               String    @id @default(cuid())
  profileId        String    @map("profile_id")
  oauthClientId    String    @map("oauth_client_id")
  accessTokenHash  String    @unique @map("access_token_hash")
  refreshTokenHash String    @unique @map("refresh_token_hash")
  tokenPrefix      String    @map("token_prefix")
  scopes           String[]
  expiresAt        DateTime  @map("expires_at")
  refreshExpiresAt DateTime  @map("refresh_expires_at")
  lastUsedAt       DateTime? @map("last_used_at")
  revokedAt        DateTime? @map("revoked_at")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  profile McpProfile     @relation(fields: [profileId], references: [id], onDelete: Cascade)
  client  McpOAuthClient @relation(fields: [oauthClientId], references: [id], onDelete: Cascade)

  @@index([profileId, revokedAt])
  @@map("mcp_oauth_grants")
}

model McpIdempotencyRecord {
  id             String               @id @default(cuid())
  profileId      String               @map("profile_id")
  toolName       String               @map("tool_name")
  idempotencyKey String               @map("idempotency_key")
  requestHash    String               @map("request_hash")
  status         McpIdempotencyStatus @default(IN_PROGRESS)
  response       Json?
  expiresAt      DateTime             @map("expires_at")
  createdAt      DateTime             @default(now()) @map("created_at")
  updatedAt      DateTime             @updatedAt @map("updated_at")

  profile McpProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@unique([profileId, toolName, idempotencyKey])
  @@index([expiresAt])
  @@map("mcp_idempotency_records")
}

model McpAssetTransfer {
  id                 String                 @id @default(cuid())
  tenantId           String                 @map("tenant_id")
  profileId          String?                @map("profile_id")
  draftId            String?                @map("wizard_draft_id")
  kind               McpAssetKind
  status             McpAssetTransferStatus @default(FETCHING)
  storagePath        String?                @map("storage_path")
  previewPath        String?                @map("preview_path")
  sourceUrlRedacted  String                 @map("source_url_redacted")
  attachedResourceId String?                @map("attached_resource_id")
  expiresAt          DateTime               @map("expires_at")
  createdAt          DateTime               @default(now()) @map("created_at")
  updatedAt          DateTime               @updatedAt @map("updated_at")

  tenant  Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile McpProfile?  @relation(fields: [profileId], references: [id], onDelete: SetNull)
  draft   WizardDraft? @relation(fields: [draftId], references: [id], onDelete: SetNull)

  @@index([status, expiresAt])
  @@index([tenantId, draftId])
  @@map("mcp_asset_transfers")
}
```

`McpOAuthClient` is deliberately global because unauthenticated dynamic registration occurs
before a user selects an account. Tenant authority is introduced only by the profile-bound
authorization code and grant.

- [ ] **Step 4: Add relation fields to `Tenant`, `User`, and `Store`**

Use:

```prisma
// Tenant
mcpProfiles McpProfile[]
mcpAssetTransfers McpAssetTransfer[]

// User
mcpProfile McpProfile?

// Store
mcpDefaultForProfiles McpProfile[]

// WizardDraft
mcpAssetTransfers McpAssetTransfer[]
```

- [ ] **Step 5: Validate schema and feature tests**

```bash
pnpm exec prisma validate
./node_modules/.bin/tsx --test src/lib/auth/roles.test.ts src/lib/mcp/schema-contract.test.ts
```

Expected: Prisma validation succeeds and the MCP feature/schema assertions pass.

### Task 5: Implement current-permission resolution and profile lifecycle

**Files:**

- Create: `src/lib/mcp/contracts.ts`
- Create: `src/lib/mcp/permission-service.ts`
- Create: `src/lib/mcp/profile-service.ts`
- Create: `src/lib/mcp/permission-service.test.ts`
- Create: `src/lib/mcp/profile-service.test.ts`
- Modify: `src/app/api/admin/acl/route.ts`
- Modify: `src/app/api/admin/users/[id]/status/route.ts`
- Modify: `src/app/api/admin/users/[id]/role/route.ts`

**Interfaces:**

```ts
export const MCP_TOOL_GROUPS = [
  "store_discovery",
  "design_library",
  "mockup_library",
  "wizard",
  "publish",
] as const;
export type McpToolGroup = (typeof MCP_TOOL_GROUPS)[number];

export type McpAuthContext = {
  tenantId: string;
  userId: string;
  profileId: string;
  credentialId: string;
  credentialKind: "PAT" | "OAUTH";
  scopes: ReadonlySet<McpToolGroup>;
};

export async function getEffectiveMcpToolGroups(
  tenantId: string,
  role: string,
): Promise<Set<McpToolGroup>>;

export async function assertMcpToolAccess(
  auth: McpAuthContext,
  requiredGroup: McpToolGroup,
): Promise<void>;
```

- [ ] **Step 1: Write permission matrix tests**

Test the exact mapping:

```ts
const cases = [
  [["mcp_access"], ["store_discovery"]],
  [["mcp_access", "designs"], ["store_discovery", "design_library"]],
  [["mcp_access", "mockup_library"], ["store_discovery", "mockup_library"]],
  [["mcp_access", "wizard"], ["store_discovery", "wizard"]],
  [["mcp_access", "wizard", "listings"], ["store_discovery", "wizard", "publish"]],
] as const;
```

Also assert `SUPER_ADMIN`, `OPERATOR`, inactive users, disabled/suspended profiles, revoked
credentials, expired credentials, disabled profile tool preferences, and missing credential
scope are denied. `assertMcpToolAccess` computes:

```ts
const effective = new Set(
  [...currentAppGroups].filter(
    (group) => enabledProfilePreferences.has(group) && auth.scopes.has(group),
  ),
);
```

Treat `toolPreferences === null` as all current app groups enabled; preferences can only
narrow and cannot grant a group absent from current app permissions.

- [ ] **Step 2: Implement profile transitions**

Expose:

```ts
createOwnMcpProfile(userId: string): Promise<McpProfile>;
enableOwnMcpProfile(userId: string): Promise<McpProfile>;
disableOwnMcpProfile(userId: string): Promise<McpProfile>;
resumeOwnMcpProfile(userId: string): Promise<McpProfile>;
suspendMcpProfilesForRoleChange(tenantId: string, role: UserRole, reason: string): Promise<number>;
suspendMcpProfileForUser(userId: string, reason: string): Promise<void>;
```

`resumeOwnMcpProfile` must re-check `role === "ADMIN"`, `status === "ACTIVE"`, and current
`mcp_access`, then clear the reason and set `ENABLED`; no permission-grant route calls it.

- [ ] **Step 3: Make upstream permission changes suspend immediately**

After ACL replacement, if ADMIN no longer has `mcp_access`, call:

```ts
await suspendMcpProfilesForRoleChange(
  session.tenantId,
  "ADMIN",
  "MCP_ACCESS_REMOVED",
);
```

After disabling or changing one user away from ADMIN, call
`suspendMcpProfileForUser(userId, "ACCOUNT_DISABLED")` or `"ROLE_CHANGED"`.

- [ ] **Step 4: Add audit events**

Use existing `logAudit()` with actions:

```text
mcp.profile.created
mcp.profile.enabled
mcp.profile.disabled
mcp.profile.suspended
mcp.profile.resumed
mcp.permission.changed
```

Never include token values or URL query strings in metadata.

- [ ] **Step 5: Run lifecycle tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/permission-service.test.ts \
  src/lib/mcp/profile-service.test.ts \
  src/lib/auth/roles.test.ts
```

Expected: all matrix and non-auto-resume cases pass.

### Task 6: Add PAT credentials and owner-only account APIs

**Files:**

- Create: `src/lib/mcp/credential-service.ts`
- Create: `src/lib/mcp/credential-service.test.ts`
- Create: `src/app/api/account/mcp/profile/route.ts`
- Create: `src/app/api/account/mcp/credentials/route.ts`
- Create: `src/app/api/account/mcp/credentials/[credentialId]/route.ts`
- Create: `src/lib/auth/require-mcp-owner.ts`

**Interfaces:**

```ts
export type CreatePatInput = {
  userId: string;
  label: string;
  scopes: McpToolGroup[];
  expiresAt: Date;
};

export type CreatedPat = {
  credential: {
    id: string;
    label: string;
    tokenPrefix: string;
    scopes: McpToolGroup[];
    expiresAt: Date;
  };
  plaintextToken: string;
};

export async function createPersonalAccessToken(input: CreatePatInput): Promise<CreatedPat>;
export async function verifyPersonalAccessToken(token: string): Promise<McpAuthContext>;
export async function revokeOwnCredential(userId: string, credentialId: string): Promise<void>;
```

- [ ] **Step 1: Write token tests**

Assert:

- token format is `mcp_pat_<base64url>`;
- stored value is SHA-256 of the full high-entropy token;
- plaintext is returned once only;
- default scope equals all currently effective groups;
- requested scope can narrow but cannot add unavailable groups;
- expiry/revoke/profile suspension/current role/current permission are checked on every verification.

- [ ] **Step 2: Implement high-entropy token creation**

```ts
const plaintextToken = `mcp_pat_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(plaintextToken).digest("hex");
const tokenPrefix = plaintextToken.slice(0, 16);
```

Do not use reversible encryption and do not log `plaintextToken`.

- [ ] **Step 3: Add owner-only route schemas**

Use Zod:

```ts
const CreateCredentialSchema = z.object({
  label: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(MCP_TOOL_GROUPS)).min(1).optional(),
  expiresInDays: z.number().int().min(1).max(365),
});
```

POST returns the one-time secret. GET returns only prefix, label, scope snapshot, expiry,
status, createdAt, and lastUsedAt. DELETE only revokes a credential whose profile owner is
the current browser session user.

- [ ] **Step 4: Add redacted audit tests**

Assert audit metadata contains credential ID/prefix/scope but does not contain the
plaintext token or `Authorization`.

- [ ] **Step 5: Run credential tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/credential-service.test.ts \
  src/lib/mcp/profile-service.test.ts
```

Expected: all one-time-secret, scope, expiry, revoke, and suspension cases pass.

### Task 7: Add OAuth Authorization Code + PKCE

**Files:**

- Create: `src/lib/mcp/oauth-service.ts`
- Create: `src/lib/mcp/oauth-service.test.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`
- Create: `src/app/api/mcp/oauth/register/route.ts`
- Create: `src/app/api/mcp/oauth/authorize/route.ts`
- Create: `src/app/api/mcp/oauth/token/route.ts`
- Create: `src/app/(authed)/account/mcp/authorize/page.tsx`

**Interfaces:**

```ts
registerPublicOAuthClient(input: {
  clientName: string;
  redirectUris: string[];
}): Promise<{ clientId: string }>;

createAuthorizationCode(input: {
  ownerUserId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: McpToolGroup[];
  state?: string;
}): Promise<{ code: string; redirectTo: string }>;

exchangeAuthorizationCode(input: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenResponse>;
```

- [ ] **Step 1: Add PKCE failure tests**

Cover invalid redirect URI, unsupported `plain`, missing/incorrect verifier, expired code,
reused code, unavailable scope, suspended profile, and revoked refresh token.

- [ ] **Step 2: Publish discovery metadata**

Authorization server metadata must advertise:

```json
{
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"]
}
```

Protected-resource metadata identifies the `/mcp` resource and the same authorization
server origin. Build all URLs from `APP_PUBLIC_URL`; never trust request Host for issuer
identity.

- [ ] **Step 3: Implement public-client registration**

Accept HTTPS redirect URIs plus loopback `http://127.0.0.1`, `http://[::1]`, and
`http://localhost` callbacks for desktop clients. Store exact redirect URIs and require
exact equality during authorization and exchange. Rate-limit dynamic registration by
source IP and reject oversized client metadata.

- [ ] **Step 4: Implement one-time S256 codes and hashed tokens**

The authorize GET validates client/redirect/challenge/scope, stores no grant, and sends the
logged-in ADMIN to `/account/mcp/authorize`. That page shows client name and scope snapshot;
only its explicit Allow action calls the authorization POST that creates the code. The
owner may narrow scopes but cannot add unavailable groups. During first-time setup the
profile may be `SETUP_INCOMPLETE`; successful grant creation enables it. A suspended or
disabled profile cannot authorize.

```ts
const expected = createHash("sha256").update(codeVerifier).digest("base64url");
if (!timingSafeEqual(Buffer.from(expected), Buffer.from(codeChallenge))) {
  throw new OAuthProtocolError("invalid_grant");
}
```

Consume the code in a transaction. Generate high-entropy access and refresh tokens, store
only SHA-256 hashes, and return `token_type: "Bearer"`, `expires_in`, `scope`, and
`refresh_token`. Refresh rotates both tokens transactionally and revokes the previous
refresh hash so replay fails.

- [ ] **Step 5: Run OAuth protocol tests**

```bash
./node_modules/.bin/tsx --test src/lib/mcp/oauth-service.test.ts
```

Expected: valid S256 exchange and refresh pass; all redirect/replay/scope failures return
the correct OAuth error.

### Task 8: Add Redis rate limits and database idempotency

**Files:**

- Create: `src/lib/mcp/rate-limit.ts`
- Create: `src/lib/mcp/rate-limit.test.ts`
- Create: `src/lib/mcp/idempotency.ts`
- Create: `src/lib/mcp/idempotency.test.ts`
- Modify: `.env.example`

**Interfaces:**

```ts
export type McpRateClass =
  | "discovery"
  | "wizard_mutation"
  | "url_import"
  | "generation"
  | "publish";

export const DEFAULT_MCP_LIMITS = {
  discovery: { limit: 120, windowSeconds: 60 },
  wizard_mutation: { limit: 60, windowSeconds: 60 },
  url_import: { limit: 10, windowSeconds: 60 },
  generation: { limit: 6, windowSeconds: 60 },
  publish: { limit: 6, windowSeconds: 60 },
} as const;

export async function consumeMcpRateLimit(
  profileId: string,
  rateClass: McpRateClass,
): Promise<{ remaining: number; retryAfterSeconds: number | null }>;

export async function runIdempotent<T>(
  input: {
    profileId: string;
    toolName: string;
    idempotencyKey: string;
    normalizedRequest: unknown;
  },
  handler: () => Promise<T>,
): Promise<T>;
```

- [ ] **Step 1: Test bucket isolation and retry time**

Use an injected Redis-like object and assert separate profile IDs and tool classes do not
share counters. The over-limit result must expose `retryAfterSeconds`.

- [ ] **Step 2: Implement an atomic Redis counter**

Use one Lua `EVAL` that performs `INCR`, sets `PEXPIRE` only when the value becomes `1`,
and returns both count and `PTTL`. Prefix keys with
`mockupai:mcp:rate:<profileId>:<class>:<window>`.

- [ ] **Step 3: Test idempotency replay and conflict**

```ts
let handlerCalls = 0;
const input = {
  profileId: "profile_1",
  toolName: "set_wizard_content",
  idempotencyKey: "idem_1",
  normalizedRequest: { draftId: "draft_1", title: "Title" },
};
const handler = async () => {
  handlerCalls += 1;
  return { ok: true, data: { saved: true } };
};

const first = await runIdempotent(input, handler);
const replay = await runIdempotent(input, handler);
assert.deepEqual(replay, first);
assert.equal(handlerCalls, 1);

await assert.rejects(
  () => runIdempotent({ ...input, normalizedRequest: { different: true } }, handler),
  /IDEMPOTENCY_CONFLICT/,
);
```

- [ ] **Step 4: Implement normalized SHA-256 request hashing**

Canonicalize object keys recursively before hashing. Store `IN_PROGRESS`, then `SUCCEEDED`
plus structured response. A matching completed record replays; a different hash conflicts;
an unexpired `IN_PROGRESS` record returns a retryable conflict. Records expire after 24
hours; an expired row is deleted and the key may be reused. Concurrent inserts rely on the
unique `(profileId, toolName, idempotencyKey)` constraint; the loser reloads and follows the
same replay/conflict path.

- [ ] **Step 5: Run rate/idempotency tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/rate-limit.test.ts \
  src/lib/mcp/idempotency.test.ts
```

Expected: all isolation, expiry, replay, and conflict tests pass.

### Task 9: Bootstrap an authenticated Streamable HTTP MCP process

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `biome.json`
- Create: `src/lib/mcp/http-server.ts`
- Create: `src/lib/mcp/server.ts`
- Create: `src/lib/mcp/http-server.test.ts`
- Create: `start-mcp.ts`

**Interfaces:**

```ts
export function createMcpServer(auth: McpAuthContext): McpServer;
export function startMcpHttpServer(input?: { port?: number; host?: string }): {
  close(): Promise<void>;
};
```

- [ ] **Step 1: Install and pin the direct SDK dependency**

Run:

```bash
pnpm add @modelcontextprotocol/sdk@^1.29.0
```

Then confirm:

```bash
node -p 'require("./node_modules/@modelcontextprotocol/sdk/package.json").version'
```

Expected: a `1.x` version at or above `1.29.0`. Keep v1 import paths:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
```

- [ ] **Step 2: Write transport authentication tests**

Assert missing/malformed/unknown/expired/revoked tokens return `401` with
`WWW-Authenticate: Bearer`; insufficient scope returns structured tool error; valid PAT
and OAuth token produce `McpAuthContext` without accepting `tenantId` from the request.
Also assert an unexpected Host or a present-but-unapproved Origin is rejected before JSON
parsing.

- [ ] **Step 3: Implement one stateless transport per POST**

Use `sessionIdGenerator: undefined`. Authenticate before constructing the tool server,
limit JSON request bodies to 1 MB, connect, call `handleRequest`, and close server/transport
when the response closes. Reject non-POST `/mcp` requests with `405`. Derive the allowed
public Host from `APP_PUBLIC_URL` plus `MCP_ALLOWED_HOSTS`; allow a missing Origin for
non-browser MCP clients, but when Origin is present require it in `MCP_ALLOWED_ORIGINS`.
Production startup rejects wildcard host/origin values.

The initial `createMcpServer` registers only a read-only `server_status` smoke tool; remove
that smoke tool in Task 16 when all catalog tools are registered.

- [ ] **Step 4: Add standalone startup**

`start-mcp.ts` uses only top-level static imports:

```ts
import "dotenv/config";
import { startMcpHttpServer } from "./src/lib/mcp/http-server";

const runtime = startMcpHttpServer({
  host: process.env.MCP_HOST ?? "127.0.0.1",
  port: Number(process.env.MCP_PORT ?? "3101"),
});

async function shutdown() {
  await runtime.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
```

Add scripts:

```json
"mcp": "tsx start-mcp.ts"
```

and add `start-mcp.ts` to Biome includes.

- [ ] **Step 5: Run the Phase 2 gate**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/schema-contract.test.ts \
  src/lib/mcp/permission-service.test.ts \
  src/lib/mcp/profile-service.test.ts \
  src/lib/mcp/credential-service.test.ts \
  src/lib/mcp/oauth-service.test.ts \
  src/lib/mcp/rate-limit.test.ts \
  src/lib/mcp/idempotency.test.ts \
  src/lib/mcp/http-server.test.ts
```

Expected: PASS. `/mcp` is still not exposed by Nginx.

---

## Phase 3 — Temporary URL Assets And Wizard Tools

### Task 10: Add temporary asset schema without exposing it in Libraries

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260724091000_mcp_temporary_wizard_assets/migration.sql`
- Create: `src/lib/mcp/assets/library-visibility.test.ts`
- Modify: `src/app/api/designs/route.ts`
- Modify: `src/app/(authed)/designs/page.tsx`
- Modify: `src/lib/analytics/queries.ts`

**Interfaces:**

```prisma
enum DesignScope {
  LIBRARY
  TEMPORARY_MCP
}
```

- [ ] **Step 1: Add temporary fields to `Design`**

```prisma
scope             DesignScope @default(LIBRARY)
expiresAt         DateTime?   @map("expires_at")
sourceUrlRedacted String?     @map("source_url_redacted")

@@index([tenantId, scope, status])
@@index([scope, expiresAt])
```

Keep `WizardDraftDesign.designId` unchanged so mockup and publish code still read the same
Design relation.

- [ ] **Step 2: Add `WizardDraftMockupSource`**

```prisma
model WizardDraftMockupSource {
  id                   String            @id @default(cuid())
  draftId              String            @map("wizard_draft_id")
  name                 String
  storagePath          String?           @map("storage_path")
  sourceUrlRedacted    String?           @map("source_url_redacted")
  mockupLibraryItemId  String?           @map("mockup_library_item_id")
  view                 MockupLibraryView
  appliesToColorIds    String[]          @map("applies_to_color_ids")
  appliesToAll         Boolean           @default(false) @map("applies_to_all")
  compositeRegionPx    Json?             @map("composite_region_px")
  width                Int
  height               Int
  mimeType             String            @map("mime_type")
  fileSizeBytes        Int               @map("file_size_bytes")
  isPrimary            Boolean           @default(false) @map("is_primary")
  sortOrder            Int               @default(0) @map("sort_order")
  expiresAt            DateTime?         @map("expires_at")
  createdAt            DateTime          @default(now()) @map("created_at")

  draft             WizardDraft       @relation(fields: [draftId], references: [id], onDelete: Cascade)
  mockupLibraryItem MockupLibraryItem? @relation(fields: [mockupLibraryItemId], references: [id], onDelete: Restrict)

  @@index([draftId, sortOrder])
  @@index([expiresAt])
  @@index([mockupLibraryItemId])
  @@map("wizard_draft_mockup_sources")
}
```

Add `draftSources WizardDraftMockupSource[]` to `MockupLibraryItem`. In migration SQL add
`CHECK (num_nonnulls(storage_path, mockup_library_item_id) = 1)`. URL sources own a
temporary `storagePath`, redacted URL, and expiry; Library sources keep only a direct
`mockupLibraryItemId` reference and no expiry/copy.

- [ ] **Step 3: Filter Library queries**

Add `scope: "LIBRARY"` to Design Library API/page counts and dashboard design counts.
Do not apply the filter when loading a draft by ID because temporary designs must remain
usable by the wizard.

- [ ] **Step 4: Add source assertions**

Assert `/api/designs` and the Designs page include `scope: "LIBRARY"` and that
`src/lib/wizard/state.ts` permits `TEMPORARY_MCP` only when the design is already attached
to the same draft/tenant/store by the temporary-design service.

- [ ] **Step 5: Validate and test**

```bash
pnpm exec prisma validate
./node_modules/.bin/tsx --test src/lib/mcp/assets/library-visibility.test.ts
```

Expected: schema valid; temporary rows are excluded from library surfaces.

### Task 11: Build the bounded URL image importer

**Files:**

- Create: `src/lib/mcp/assets/fetch-image.ts`
- Create: `src/lib/mcp/assets/fetch-image.test.ts`
- Modify: `src/lib/images/probe.ts`

**Interfaces:**

```ts
export type ImportedImage = {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  extension: "png" | "jpg";
  width: number;
  height: number;
  dpi: number | null;
  previewBuffer: Buffer;
  normalizedBuffer: Buffer | null;
  fileSizeBytes: number;
  redactedSourceUrl: string;
};

export async function fetchMcpImage(
  rawUrl: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<ImportedImage>;

export async function createMcpAssetTransfer(input: {
  tenantId: string;
  profileId: string;
  draftId: string;
  kind: "DESIGN" | "MOCKUP";
  sourceUrlRedacted: string;
}): Promise<{ id: string; expiresAt: Date }>;
```

- [ ] **Step 1: Add importer tests**

Cover PNG/JPEG magic bytes, misleading Content-Type, HTML rejection, 100 MB Content-Length
rejection, streamed overflow, five-redirect cap, 30-second abort, HTTP and HTTPS,
localhost/private/link-local acceptance, no forwarded auth/cookies/custom headers, and
redacted query strings in errors/audit metadata.

- [ ] **Step 2: Add a buffer probe helper**

Extract a `probeAndPreviewBuffer(buffer: Buffer)` sibling in `src/lib/images/probe.ts` that
applies the same Sharp dimension, normalization, DPI, and preview rules as file upload.
Keep `probeAndPreview(filePath)` working.

- [ ] **Step 3: Implement manual redirect handling**

Call fetch with:

```ts
{
  method: "GET",
  redirect: "manual",
  signal,
  headers: { Accept: "image/png,image/jpeg" },
}
```

Do not pass client-provided headers. Resolve relative `Location`, stop after five redirects,
and accept every HTTP/HTTPS hostname/IP class by approved design.

Before fetching, create an internal `McpAssetTransfer` with `FETCHING` and a 24-hour
expiry. After validated storage succeeds, mark it `READY` with storage paths. Attachment
services mark it `ATTACHED` plus `attachedResourceId` in the same transaction that creates
the Design or `WizardDraftMockupSource`. This record is internal cleanup state, not an
upload session and is never returned as a client upload handle.

- [ ] **Step 4: Validate magic bytes before Sharp**

PNG begins `89 50 4e 47 0d 0a 1a 0a`; JPEG begins `ff d8 ff`. Reject everything else with
`UNSUPPORTED_IMAGE`. Accumulate stream chunks while enforcing 100 MB.

- [ ] **Step 5: Run importer tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/assets/fetch-image.test.ts \
  src/lib/storage/local-disk.test.ts
```

Expected: all security/limit tests pass, including approved private hosts.

### Task 12: Materialize URL designs and automatic light/dark pairs

**Files:**

- Create: `src/lib/mcp/assets/temporary-design.ts`
- Create: `src/lib/mcp/assets/temporary-design.test.ts`
- Modify: `src/lib/wizard/state.ts`
- Reuse: `src/lib/designs/design-pairing.ts`

**Interfaces:**

```ts
export async function attachTemporaryDesignUrl(input: {
  tenantId: string;
  profileId: string;
  ownerUserId: string;
  draftId: string;
  url: string;
  name?: string;
  pairingMode: "AUTO" | "NONE";
}): Promise<{
  draftDesignId: string;
  designId: string;
  name: string;
  expiresAt: Date;
  pairs: Array<{ id: string; baseName: string }>;
}>;
```

- [ ] **Step 1: Test tenant/store binding and rollback**

Assert the draft exists in the tenant, has a selected store, storage keys are removed if DB
creation fails, and another tenant cannot attach/read the result.

- [ ] **Step 2: Save Design-compatible files**

Use keys:

```text
temporary/mcp/<tenantId>/<draftId>/designs/<designId>.<ext>
temporary/mcp/<tenantId>/<draftId>/previews/<designId>.webp
```

Create `Design` with `scope: TEMPORARY_MCP`, `storeId: draft.storeId`,
`ownerUserId`, and `expiresAt = now + 30 days`; create `WizardDraftDesign` in the same
transaction. The same transaction changes the internal transfer from `READY` to `ATTACHED`
and writes `attachedResourceId: design.id`.

- [ ] **Step 3: Reuse current pairing logic**

Name precedence is explicit `name`, then decoded URL basename. When `pairingMode ===
"AUTO"`, call `syncDraftDesignPairs`/the current `pairDesigns` path. Return proposed pairs
so MCP clients can inspect and correct them.

- [ ] **Step 4: Mark mockups stale**

Set:

```ts
{
  mockupsStale: true,
  mockupsStaleReason: "designs_changed",
  currentStep: { set: Math.max(draft.currentStep, 2) }
}
```

Use the actual Prisma update shape accepted by the current state service.

- [ ] **Step 5: Run design tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/assets/temporary-design.test.ts \
  src/lib/designs/design-pairing.test.ts \
  src/lib/wizard/design-selection.test.ts \
  src/lib/wizard/design-pairs.test.ts
```

Expected: temporary assets attach, auto-pair, remain hidden from Library, and preserve
current pairing behavior.

### Task 13: Add temporary custom COMPOSITE mockups to the current generation path

**Files:**

- Create: `src/lib/mcp/assets/temporary-mockup.ts`
- Create: `src/lib/mcp/assets/temporary-mockup.test.ts`
- Create: `src/lib/wizard/custom-mockup-contracts.ts`
- Modify: `src/lib/mockup/source-url.ts`
- Modify: `src/lib/mockup/source.ts`
- Modify: `src/lib/mockup/generation.ts`
- Modify: `src/lib/mockup/printify-poll-worker.ts`
- Create: `src/lib/mockup/mcp-temporary-source.test.ts`

**Interfaces:**

```ts
export type WizardCustomMockupInput = {
  source: { url: string } | { mockupLibraryItemId: string };
  name?: string;
  view: MockupLibraryView;
  appliesToColorRefs: string[] | ["all"];
  compositeRegionPx?: CompositeRegionPx;
  isPrimary?: boolean;
  sortOrder?: number;
};

export async function setWizardCustomMockups(input: {
  tenantId: string;
  profileId: string;
  draftId: string;
  mockups: WizardCustomMockupInput[];
}): Promise<{
  sources: SerializedDraftMockupSource[];
  coveredColorIds: string[];
  missingColorIds: string[];
}>;
```

- [ ] **Step 1: Add coverage tests**

Assert explicit colors resolve within draft store, `["all"]` expands to current selected
colors, missing colors are returned, PRINTIFY template rejects custom sources, and CUSTOM
template accepts a mix of Library references, current UI Library picks, and temporary URL
sources. A Library item must belong to the same tenant/store and remain a reference; it
must not create or alter a reusable `TemplateMockupItem`.

- [ ] **Step 2: Store temporary COMPOSITE metadata**

Partition the submitted entries. Materialize each URL under:

```text
temporary/mcp/<tenantId>/<draftId>/mockups/<sourceId>.<ext>
```

If `compositeRegionPx` is absent, call the current Smart Fit computation and persist the
computed region before returning. Replace the draft's old temporary source rows only after
all new URL fetches succeed. Mark each internal transfer `ATTACHED` with the new
`WizardDraftMockupSource.id` in the same replacement transaction; failed/unattached
transfers remain eligible for the 24-hour cleanup rule.

For Library inputs, create `WizardDraftMockupSource` with `mockupLibraryItemId` and no
storage copy/expiry. Copy view/dimensions only into the structured response; the database
relation remains the source of truth.

- [ ] **Step 3: Re-enable draft-scope source resolution**

`buildCustomMockupSourceUrl(source.id, "DRAFT", "COMPOSITE")` is already the canonical URL.
Update `resolveMockupSourceBuffer` so `parsed.kind === "custom"` and
`parsed.scope === "draft"` loads either `WizardDraftMockupSource.storagePath` or its
related `MockupLibraryItem.storagePath`. Keep legacy template custom sources rejected.

- [ ] **Step 4: Merge temporary sources with Library picks**

In `loadMockupGenerationContext`, include `draftMockupSources`. In coverage and
`createCustomMockupJobForDraftDesign`, expand each temporary source to its applicable color
IDs and pass it to `buildCustomMockupImageRows` with `scope: "DRAFT"`. Temporary rows take
priority; Library rows fill uncovered `(colorId, view)` slots. Do not read
`draft.mockupSourceMode` as authority.

- [ ] **Step 5: Run custom generation tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/assets/temporary-mockup.test.ts \
  src/lib/mockup/mcp-temporary-source.test.ts \
  src/lib/mockup/custom-library-region.test.ts \
  src/lib/mockup/custom-source-selection.test.ts \
  src/lib/mockup/source.test.ts \
  src/lib/mockup/printify-poll-worker-custom.test.ts
```

Expected: temporary and Library backgrounds use the same COMPOSITE jobs and complete
selected-color coverage.

### Task 14: Add retention cleanup without touching active jobs

**Files:**

- Create: `src/lib/mcp/assets/cleanup.ts`
- Create: `src/lib/mcp/assets/cleanup.test.ts`
- Modify: `src/lib/mcp/http-server.ts`

**Interfaces:**

```ts
export async function cleanupMcpTemporaryAssets(now?: Date): Promise<{
  designsDeleted: number;
  mockupsDeleted: number;
  storageErrors: string[];
}>;
```

- [ ] **Step 1: Add retention matrix tests**

Cover:

- unattached materialization older than 24 hours: delete;
- DRAFT abandoned for 30 days: delete;
- terminal publish older than seven days: delete;
- active `GENERATING`, publish `PENDING/RUNNING/RETRY_SCHEDULED`, or non-terminal listing:
  retain regardless of age;
- storage deletion failure: retain DB row and report the error for retry.

- [ ] **Step 2: Implement query-first cleanup**

Load candidates with draft, latest mockup jobs, listings, attempts/jobs, and attachment
relations. Classify with a pure `shouldDeleteTemporaryAsset()` function tested separately.
Delete storage first, then DB row.

- [ ] **Step 3: Start a single cleanup interval**

The MCP process runs cleanup once after startup and every hour. The interval uses
`unref()` and is closed during SIGINT/SIGTERM. Concurrent ticks are prevented by a local
promise guard.

- [ ] **Step 4: Audit deletions**

Write `mcp.temporary_asset.purged` with asset type, ID, and retention reason; never write
the full source URL.

- [ ] **Step 5: Run cleanup tests**

```bash
./node_modules/.bin/tsx --test src/lib/mcp/assets/cleanup.test.ts
```

Expected: all retention branches pass and active work is never removed.

### Task 15: Build route-independent wizard query and mutation services

**Files:**

- Create: `src/lib/wizard/query.ts`
- Create: `src/lib/wizard/query.test.ts`
- Create: `src/lib/wizard/mutations.ts`
- Create: `src/lib/wizard/mutations.test.ts`
- Create: `src/lib/wizard/contracts.ts`
- Modify: browser routes only where necessary to call these services.

**Interfaces:**

```ts
export type ResourceRef = { id: string } | { name: string };
export type StoreFilter = { query?: string; status?: string; limit: number };
export type TenantStoreRef = { tenantId: string; storeRef: ResourceRef };
export type TenantDraftRef = { tenantId: string; draftId: string };
export type SearchDesignInput = TenantStoreRef & { query?: string; limit: number };
export type SearchMockupInput = TenantStoreRef & {
  query?: string;
  view?: string;
  limit: number;
};
export type StoreSummary = {
  id: string;
  name: string;
  shopifyDomain: string;
  status: string;
};
export type DesignSummary = {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number | null;
};
export type MockupSummary = {
  id: string;
  name: string;
  view: string;
  width: number;
  height: number;
  hasCompositeRegion: boolean;
};
export type NormalizedWizard = {
  draft: Record<string, unknown>;
  designs: Array<Record<string, unknown>>;
  designPairs: Array<Record<string, unknown>>;
  customMockups: Array<Record<string, unknown>>;
  checklist: WizardChecklist;
  jobs: Array<Record<string, unknown>>;
  warnings: string[];
};

export type CreateWizardInput = {
  tenantId: string;
  actorUserId: string;
  profileId?: string;
  storeRef: ResourceRef;
  designRefs?: ResourceRef[];
  designUrls?: Array<{ url: string; name?: string }>;
  templateRef?: ResourceRef;
  productConfig?: Omit<SetProductConfigInput, "tenantId" | "draftId">;
  customMockups?: WizardCustomMockupInput[];
  contentSeed?: {
    targets: Array<{
      target:
        | { type: "DESIGN_NAME"; value: string }
        | { type: "PAIR_BASE_NAME"; value: string };
      content: SetContentInput["content"];
    }>;
  };
  pairingMode: "AUTO" | "NONE";
};
export type SetWizardDesignsInput = TenantDraftRef & {
  designs: Array<{ designRef: ResourceRef } | { draftDesignId: string }>;
  pairingMode: "AUTO" | "NONE";
};
export type SetProductConfigInput = TenantDraftRef & {
  templateRef?: ResourceRef;
  enabledColorIds?: string[];
  enabledSizes?: string[];
  enabledSizesByColor?: Record<string, string[]>;
  enabledVariantIdsOverride?: number[];
  priceBySizeOverride?: Record<string, number>;
  placementOverride?: Record<string, unknown>;
};
export type SetContentInput = TenantDraftRef & {
  target:
    | { type: "DESIGN"; draftDesignId: string }
    | { type: "PAIR"; pairId: string };
  content: {
    title?: string;
    description?: string;
    tags?: string[];
    organizationCollections?: string[];
  };
};
export type GenerateAssetsInput = TenantDraftRef & {
  assetTypes: Array<"MOCKUPS" | "CONTENT">;
};
export type WizardJobSummary = {
  id: string;
  type: "MOCKUPS" | "CONTENT";
  status: string;
};
export type StoreWizardConfig = Record<string, unknown>;

export async function listTenantStores(tenantId: string, filter: StoreFilter): Promise<StoreSummary[]>;
export async function searchLibraryDesigns(input: SearchDesignInput): Promise<DesignSummary[]>;
export async function searchLibraryMockups(input: SearchMockupInput): Promise<MockupSummary[]>;
export async function getStoreWizardConfig(input: TenantStoreRef): Promise<StoreWizardConfig>;
export async function getNormalizedWizard(input: TenantDraftRef): Promise<NormalizedWizard>;
export async function createWizardDraft(input: CreateWizardInput): Promise<NormalizedWizard>;
export async function setWizardDesigns(input: SetWizardDesignsInput): Promise<NormalizedWizard>;
export async function setWizardProductConfig(input: SetProductConfigInput): Promise<NormalizedWizard>;
export async function setWizardContent(input: SetContentInput): Promise<NormalizedWizard>;
export async function generateWizardAssets(input: GenerateAssetsInput): Promise<WizardJobSummary[]>;
```

- [ ] **Step 1: Test tenant-bound reference resolution**

ID and exact/partial name resolution must always include `tenantId`. Zero matches return
`RESOURCE_NOT_FOUND`; multiple name matches return `AMBIGUOUS_REFERENCE` plus safe
candidates; cross-tenant IDs return the same not-found error.

- [ ] **Step 2: Extract read logic**

Reuse existing Prisma select/include shapes from stores, designs, mockups, draft GET, and
status routes. Design search adds `scope: "LIBRARY"`. Store listing has no owner/user filter.

- [ ] **Step 3: Extract mutation logic**

Reuse `createDraft`, `updateDraft`, current pair sync, content routes, and
`createMockupJobForDraftDesign`/`createCustomMockupJobForDraftDesign`. Preserve current
stale flags, template defaults, colors, sizes, variants, placement, prices, and content
normalization.

`setWizardDesigns` partitions inputs: Library `designRef` resolves only `scope: LIBRARY`
inside the tenant/store; `draftDesignId` resolves only an already attached row in the same
draft and may point at a temporary Design. When a temporary design is detached and no
longer referenced, cleanup treats it as an unattached asset and removes it after 24 hours.

- [ ] **Step 4: Keep browser adapters behavior-compatible**

Where browser routes are changed, they parse session/body and map service errors only.
Response keys consumed by current pages must remain unchanged.

- [ ] **Step 5: Run wizard regression tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/wizard/query.test.ts \
  src/lib/wizard/mutations.test.ts \
  src/lib/wizard/state.test.ts \
  src/lib/wizard/design-pairs.test.ts \
  src/lib/wizard/publish-units.test.ts \
  'src/app/api/wizard/drafts/[id]/route.test.ts'
```

Expected: shared services and current browser flow pass.

### Task 16: Register discovery and wizard mutation tools from one catalog

**Files:**

- Create: `src/lib/mcp/tools/catalog.ts`
- Create: `src/lib/mcp/tools/catalog.test.ts`
- Create: `src/lib/mcp/tools/discovery.ts`
- Create: `src/lib/mcp/tools/wizard.ts`
- Modify: `src/lib/mcp/server.ts`

**Interfaces:**

- Produces the first 13 tools:

```text
list_stores
search_designs
search_mockups
get_store_wizard_config
get_listing_wizard
create_listing_wizard
attach_wizard_design_url
set_wizard_designs
set_wizard_custom_mockups
set_wizard_product_config
set_wizard_content
generate_wizard_assets
get_wizard_status
```

- [ ] **Step 1: Encode schemas from the approved catalog**

Use Zod 4 schemas with descriptions for every field. Shared refs are strict unions:

```ts
export const StoreRefSchema = z.union([
  z.object({ id: z.string().min(1) }).strict(),
  z.object({ name: z.string().trim().min(1) }).strict(),
]);
```

Repeat the catalog's exact required/optional fields, enums, limits, and result shapes. Do
not add `tenantId`, local paths, base64, upload IDs, or a second mockup-source mode.

- [ ] **Step 2: Encode runtime metadata**

Every entry contains `name`, `title`, `description`, `requiredToolGroup`, `rateClass`,
`inputSchema`, `outputSchema`, and:

```ts
annotations: {
  readOnlyHint: boolean;
  destructiveHint: false;
  idempotentHint: true;
}
```

Mutation entries set `idempotencyKey` required and use `runIdempotent`.

- [ ] **Step 3: Implement permission-aware handlers**

Each handler receives `McpAuthContext` from the server closure, calls
`assertMcpToolAccess`, consumes its rate bucket, resolves resources inside `auth.tenantId`,
then calls the shared service. Library refs trigger their additional current feature/scope
check.

- [ ] **Step 4: Return structured content**

Use:

```ts
const response = { ok: true, data, warnings, nextActions };
return {
  content: [{ type: "text", text: JSON.stringify(response) }],
  structuredContent: response,
};
```

Define `WizardCustomMockupInput` in `src/lib/wizard/custom-mockup-contracts.ts`;
MCP asset/tool adapters import that shared type rather than making the wizard service depend
on an MCP-only module.

Map known errors to the stable codes in the approved catalog without returning cross-tenant
existence, response bodies, token values, or detailed internal network errors.

- [ ] **Step 5: Run the Phase 3 gate**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/tools/catalog.test.ts \
  src/lib/mcp/assets/fetch-image.test.ts \
  src/lib/mcp/assets/temporary-design.test.ts \
  src/lib/mcp/assets/temporary-mockup.test.ts \
  src/lib/mcp/assets/cleanup.test.ts \
  src/lib/wizard/query.test.ts \
  src/lib/wizard/mutations.test.ts \
  src/lib/mockup/mcp-temporary-source.test.ts
```

Expected: all 13 tools have one registration, exact permissions/annotations, and passing
asset/wizard behavior.

---

## Phase 4 — Revision-Safe Review, Publish, And Status Tools

### Task 17: Create a canonical wizard revision token

**Files:**

- Create: `src/lib/wizard/revision.ts`
- Create: `src/lib/wizard/revision.test.ts`
- Modify: `.env.example`

**Interfaces:**

```ts
export type WizardRevisionPayload = {
  version: 1;
  tenantId: string;
  draftId: string;
  stateHash: string;
  reviewedAt: string;
};

export async function createWizardRevisionToken(
  tenantId: string,
  draftId: string,
): Promise<{ token: string; payload: WizardRevisionPayload }>;

export async function assertWizardRevisionToken(
  token: string,
  tenantId: string,
  draftId: string,
): Promise<void>;
```

- [ ] **Step 1: Write state-change tests**

Token must become stale when any reviewed field changes: selected designs/order/pairs,
design or pair content, template, colors, sizes, variants, placement, prices, custom
mockups/regions/color coverage, mockup stale flag, latest job/image include state, or draft
updated timestamp. Unrelated audit events must not change it.

- [ ] **Step 2: Build a canonical snapshot**

Load only reviewed fields, convert dates to ISO, sort maps/object keys, preserve meaningful
array ordering, and hash canonical JSON with SHA-256.

- [ ] **Step 3: Sign the opaque token**

Use `MCP_REVISION_SECRET` and HMAC-SHA256:

```ts
const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
const signature = createHmac("sha256", secret).update(payloadPart).digest("base64url");
return `v1.${payloadPart}.${signature}`;
```

Verify signature with `timingSafeEqual`, tenant/draft identity, and recomputed `stateHash`.

- [ ] **Step 4: Add environment validation**

Production startup fails if `MCP_REVISION_SECRET` is missing or shorter than 32 bytes.
Development may use an explicit value in `.env.local`; do not hard-code a fallback.

- [ ] **Step 5: Run revision tests**

```bash
./node_modules/.bin/tsx --test src/lib/wizard/revision.test.ts
```

Expected: valid token passes and every reviewed-state mutation returns
`REVISION_CONFLICT`.

### Task 18: Register review, publish, and publish-status tools

**Files:**

- Create: `src/lib/mcp/tools/review-publish.ts`
- Create: `src/lib/mcp/tools/review-publish.test.ts`
- Modify: `src/lib/mcp/tools/catalog.ts`
- Modify: `src/lib/mcp/server.ts`

**Interfaces:**

- Produces:

```text
review_wizard
publish_listing
get_publish_status
```

- [ ] **Step 1: Add failing review/publish tests**

Assert review returns checklist, previews, publish units, and token. Publish rejects
permission loss, scope loss, suspended profile, stale token, incomplete checklist, reused
idempotency key with different input, and cross-tenant draft. Status polling never creates
jobs or attempts.

- [ ] **Step 2: Implement `review_wizard`**

Load normalized draft, run `buildChecklist`, build preview/publish units from current pair
and independent-design logic, then create the revision token. It is read-only and does not
write a server approval row.

- [ ] **Step 3: Implement `publish_listing` in strict order**

```ts
await assertMcpToolAccess(auth, "publish");
await consumeMcpRateLimit(auth.profileId, "publish");
await assertWizardRevisionToken(input.revisionToken, auth.tenantId, input.draftId);
return runIdempotent(..., () =>
  submitWizardPublish({
    tenantId: auth.tenantId,
    actorUserId: auth.userId,
    draftId: input.draftId,
  }),
);
```

`submitWizardPublish` runs the checklist again before its transaction. Return
`submissions[]` with one `publishAttemptId` per listing. Do not call a queue.

- [ ] **Step 4: Implement persisted status aggregation**

`get_publish_status` accepts exactly one of `draftId`, `listingId`, or
`publishAttemptId`, tenant-binds the lookup, and returns:

```ts
{
  overallStatus: "PUBLISHING" | "ACTIVE" | "PARTIAL_FAILURE" | "FAILED";
  listings: ListingStatus[];
  attempts: AttemptStatus[];
  jobs: Array<{
    stage: "SHOPIFY" | "PRINTIFY";
    status: "PENDING" | "RUNNING" | "RETRY_SCHEDULED" | "SUCCEEDED" | "FAILED";
  }>;
  nextRetryAt: string | null;
}
```

- [ ] **Step 5: Run tool tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/tools/catalog.test.ts \
  src/lib/mcp/tools/review-publish.test.ts \
  src/lib/wizard/revision.test.ts \
  src/lib/wizard/publish-submission.test.ts
```

Expected: all 16 catalog tools are registered once; only publish is destructive.

### Task 19: Prove UI and MCP create identical publish records

**Files:**

- Create: `src/lib/mcp/publish-equivalence.test.ts`
- Modify: `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`
- Read only: `src/lib/publish/outbox.ts`
- Read only: `src/lib/publish/queue.ts`

**Interfaces:**

- Consumes: `submitWizardPublish`.
- Produces: hard regression gate for the worker boundary.

- [ ] **Step 1: Build one reviewed fixture**

Use a fixture containing one light/dark pair and one independent design, complete content,
selected colors, completed included mockups, valid placement, and non-stale state.

- [ ] **Step 2: Exercise both adapters**

Call the browser route adapter with a mocked session and call the MCP
`publish_listing` handler with an `McpAuthContext`. Both must delegate exactly once to
`submitWizardPublish` with the same tenant, actor, draft, and normalized price.

- [ ] **Step 3: Compare persisted shape**

For each adapter, inspect captured transaction calls and compare:

```ts
{
  listings,
  attempts,
  jobsByStage,
  outbox,
  activePublishAttemptIds,
  draftStatus,
}
```

There must be one attempt and one outbox per listing and exactly SHOPIFY/PRINTIFY jobs per
attempt.

- [ ] **Step 4: Assert forbidden calls are absent**

```ts
assert.doesNotMatch(mcpSource, /getPublishQueue|PUBLISH_QUEUE_NAME|\.add\(/);
assert.doesNotMatch(routeSource, /runPublishWorker|runPublishWorkersWithConcurrency/);
```

- [ ] **Step 5: Run the Phase 4 gate**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/publish-equivalence.test.ts \
  src/lib/mcp/tools/review-publish.test.ts \
  src/lib/wizard/publish-submission.test.ts \
  src/lib/jobs/workers/publish-worker.test.ts \
  src/lib/publish/outbox.test.ts \
  src/lib/publish/queue.test.ts
```

Expected: PASS with unchanged queue name/payload and no direct MCP enqueue.

---

## Phase 5 — ADMIN Self-Service UI, Tool Reference, And Deployment

### Task 20: Add read-only MCP status to SUPER_ADMIN surfaces

**Files:**

- Modify: `src/app/api/admin/users/route.ts`
- Modify: `src/app/(authed)/admin/users/page.tsx`
- Modify: `src/app/(authed)/admin/acl/AclClient.tsx`
- Create: `src/lib/mcp/status.ts`
- Create: `src/lib/mcp/status.test.ts`
- Create: `src/app/(authed)/admin/users/mcp-status-source.test.ts`

**Interfaces:**

```ts
export type McpUserStatus =
  | "NOT_ALLOWED"
  | "AVAILABLE"
  | "SELF_ENABLED"
  | "SETUP_INCOMPLETE"
  | "CONNECTION_ISSUE"
  | "ACCESS_REVOKED";
```

- [ ] **Step 1: Test all status derivations**

Derive from role/status/current role permission/profile status/usable credential. A
previously configured suspended profile with lost permission is `ACCESS_REVOKED`; granted
permission with no profile is `AVAILABLE`.

- [ ] **Step 2: Return status only**

The users API may include `mcpStatus`; it must not select token hashes, OAuth token hashes,
credential configuration, or default settings.

- [ ] **Step 3: Add the users-table column**

Use the approved labels:

```text
Not allowed
Available
Self-enabled
Setup incomplete
Connection issue
Access revoked
```

No row action navigates to another ADMIN's MCP profile.

- [ ] **Step 4: Add ACL confirmation copy**

After granting, show:

```text
MCP access granted. This admin can now set up their own MCP connection.
```

After removal, warn that current MCP calls stop immediately; do not show credential
controls.

- [ ] **Step 5: Run status/source tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/status.test.ts \
  src/app/'(authed)'/admin/users/mcp-status-source.test.ts
```

Expected: ownership-safe status only.

### Task 21: Build the ADMIN-owned account MCP experience

**Files:**

- Modify: `src/app/(authed)/AuthedShell.tsx`
- Create: `src/app/(authed)/account/layout.tsx`
- Create: `src/app/(authed)/account/page.tsx`
- Create: `src/app/(authed)/account/permissions/page.tsx`
- Create: `src/app/(authed)/account/stores/page.tsx`
- Create: `src/app/(authed)/account/mcp/page.tsx`
- Create: `src/app/(authed)/account/mcp/McpSettingsClient.tsx`
- Create: `src/app/(authed)/account/mcp/tools/page.tsx`
- Create: `src/app/(authed)/account/mcp/audit/page.tsx`
- Create: `src/app/api/account/mcp/defaults/route.ts`
- Create: `src/app/api/account/mcp/test-connection/route.ts`
- Create: `src/app/(authed)/account/mcp/mcp-ui-source.test.ts`

**Interfaces:**

- Consumes owner-only account APIs from Tasks 5-7.
- Produces no SUPER_ADMIN cross-user configuration route.

- [ ] **Step 1: Add account navigation and guard**

Show Account to logged-in users. The MCP tab is interactive only when the current user is
`ADMIN`; SUPER_ADMIN and OPERATOR receive a read-only role explanation. Missing
`mcp_access` shows the exact permission and no setup/token controls.

- [ ] **Step 2: Build first-time setup**

The resumable steps are:

1. inherited current features/tool groups, read-only, with every-tenant-store explanation;
2. OAuth PKCE or PAT;
3. profile plus first credential with all effective groups checked by default and
   narrowing allowed;
4. one-time PAT secret or OAuth connection result plus Claude/Codex/n8n configuration;
5. connection test and enabled overview.

Abandoning after profile creation leaves `SETUP_INCOMPLETE`.

- [ ] **Step 3: Build active overview and credential ledger**

Display profile/connection state, current permission guardrails, default store convenience,
rate limits, credential prefix/client ID, scope snapshot, expiry, last used, and
rotate/revoke. Multiple credentials render independently. Restored permission on a
suspended profile shows `Resume MCP`; it never auto-resumes.

- [ ] **Step 4: Add defaults and connection test**

Defaults API tenant-validates `defaultStoreId` but never treats it as allowed-store scope.
Connection test verifies current profile plus selected credential and performs no wizard
mutation.

- [ ] **Step 5: Run UI source tests**

```bash
./node_modules/.bin/tsx --test \
  src/app/'(authed)'/account/mcp/mcp-ui-source.test.ts \
  src/lib/mcp/profile-service.test.ts \
  src/lib/mcp/credential-service.test.ts
```

Expected: required states/copy/actions exist and forbidden SUPER_ADMIN controls do not.

### Task 22: Render Tool Reference from the runtime catalog

**Files:**

- Create: `src/app/api/account/mcp/tool-reference/route.ts`
- Create: `src/app/(authed)/account/mcp/tools/ToolReferenceClient.tsx`
- Create: `src/lib/mcp/tools/catalog-docs.test.ts`
- Modify: `docs/superpowers/specs/2026-07-24-admin-mcp-tools-catalog.md` only if runtime names or schemas expose an approved-spec mismatch.

**Interfaces:**

- Consumes: `MCP_TOOL_CATALOG`.
- Produces: client-readable and human-readable docs from the same runtime entries.

- [ ] **Step 1: Serialize safe catalog metadata**

Return tool name/title/description, required features, annotations, required/optional
parameter descriptions, output field descriptions, common errors, and redacted examples.
Do not expose implementation paths, secrets, or internal host data.

- [ ] **Step 2: Keep Tool Reference available before activation**

Require browser session + current `mcp_access`, but do not require enabled profile or
credential. Without `mcp_access`, return the missing-permission explanation rather than a
runnable catalog.

- [ ] **Step 3: Render grouped expandable rows**

Groups:

```text
Discovery
Design
Wizard Mutation
Review/Publish
```

Show annotations, exact params, output, errors, and request/response example. Provide
Claude, Codex, and n8n connection snippets with placeholders, never live secrets.

- [ ] **Step 4: Add catalog parity assertions**

Parse the approved Markdown headings and compare the exact 16 runtime names. Assert every
runtime tool has a non-empty description, described input fields, output schema, and
annotations. Assert `publish_listing.destructiveHint === true` and all other tools are
false.

- [ ] **Step 5: Run catalog docs tests**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/tools/catalog.test.ts \
  src/lib/mcp/tools/catalog-docs.test.ts
```

Expected: runtime, UI, and Markdown contain the same 16 tools.

### Task 23: Add PM2, Nginx, deployment, and local ngrok contracts

**Files:**

- Modify: `ecosystem.config.js`
- Modify: `ops/deploy-vps.sh`
- Modify: `setup-nginx.sh`
- Modify: `.env.example`
- Create: `tests/mcp-runtime-source.test.ts`
- Create: `docs/mcp-admin-connection.md`

**Interfaces:**

- Produces local internal MCP origin `http://127.0.0.1:${MCP_PORT}` and external
  `${APP_PUBLIC_URL}/mcp`.

- [ ] **Step 1: Add source tests first**

Assert PM2 contains a single `mockupai-mcp` process with shared `DATABASE_URL`, writable
`REDIS_URL`, and absolute `UPLOAD_DIR`; deploy starts/reloads it explicitly; Nginx proxies
exact `/mcp`; existing `mockupai-worker` block and deploy command remain unchanged.

- [ ] **Step 2: Add the PM2 process**

Use:

```js
{
  name: "mockupai-mcp",
  script: "pnpm",
  args: "run mcp",
  cwd: ".",
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  max_memory_restart: "512M",
  env: {
    NODE_ENV: "production",
    MCP_HOST: "127.0.0.1",
    MCP_PORT: process.env.MCP_PORT || "3101",
    UPLOAD_DIR,
  },
}
```

Do not put secret values in `ecosystem.config.js`; inherit them from deployment
environment/`.env`.

- [ ] **Step 3: Add the reverse proxy**

Place exact-match and prefix-safe MCP handling before `location /`:

```nginx
location = /mcp {
    proxy_pass http://127.0.0.1:${MCP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

OAuth and well-known routes remain on the Next app.

- [ ] **Step 4: Document local ngrok**

Document two separate uses:

- expose the app/MCP origin: `ngrok http 3000`;
- expose a local raw image server for URL import, with the exact URL returning image bytes
  rather than an ngrok interstitial.

Include PAT and OAuth configuration examples using placeholders.

- [ ] **Step 5: Run operations source tests**

```bash
./node_modules/.bin/tsx --test tests/mcp-runtime-source.test.ts
```

Expected: MCP process/proxy present and the existing worker stanza unchanged.

### Task 24: Final regression and real smoke gate

**Files:**

- Create: `scripts/smoke-mcp-wizard.ts`
- Create: `src/lib/mcp/smoke-contract.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces script `pnpm mcp:smoke -- --base-url "$MCP_PUBLIC_URL" --token-env MCP_SMOKE_TOKEN`.
- The token is read from an environment variable and never accepted as a command-line
  plaintext value.

- [ ] **Step 1: Add a non-publish smoke mode**

Add:

```json
"mcp:smoke": "tsx scripts/smoke-mcp-wizard.ts"
```

The default script calls initialize, tools/list, list_stores, config, creates a draft using
a supplied test image URL, generates/polls assets when fixtures allow, and calls
`review_wizard`. It prints IDs/status but redacts token and URL query strings.

- [ ] **Step 2: Add an explicit publish smoke switch**

Only `--publish` calls `publish_listing`, and only after printing the review/checklist. The
script requires both `MCP_SMOKE_ALLOW_PUBLISH=1` and `--publish`; otherwise it stops after
review.

- [ ] **Step 3: Run focused automated regression**

```bash
./node_modules/.bin/tsx --test \
  src/lib/mcp/**/*.test.ts \
  src/lib/wizard/checklist.test.ts \
  src/lib/wizard/publish-submission.test.ts \
  src/lib/jobs/workers/publish-worker.test.ts \
  src/lib/publish/outbox.test.ts \
  src/lib/publish/queue.test.ts \
  tests/mcp-runtime-source.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 4: Run schema, formatting, and build checks**

```bash
pnpm exec prisma validate
pnpm exec biome check \
  src/lib/mcp \
  src/lib/wizard \
  src/app/api/account/mcp \
  src/app/api/mcp \
  'src/app/(authed)/account' \
  start-mcp.ts \
  tests/mcp-runtime-source.test.ts
git diff --check
pnpm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Run local protocol smoke**

Start app, worker, MCP, Redis, and PostgreSQL using the existing local process setup. Then:

```bash
pnpm mcp:smoke -- \
  --base-url http://127.0.0.1:3101/mcp \
  --token-env MCP_SMOKE_TOKEN \
  --image-url "$MCP_SMOKE_IMAGE_URL"
```

Expected: initialize succeeds, exactly 16 tools list, tenant stores list, draft/review
complete without publish, and existing worker logs remain healthy.

- [ ] **Step 6: Run one approved real publish smoke**

After the user explicitly authorizes a disposable store/design:

```bash
MCP_SMOKE_ALLOW_PUBLISH=1 pnpm mcp:smoke -- \
  --base-url "$MCP_PUBLIC_URL" \
  --token-env MCP_SMOKE_TOKEN \
  --image-url "$MCP_SMOKE_IMAGE_URL" \
  --publish
```

Expected:

- review returns `readyToPublish: true`;
- `publish_listing` returns one `publishAttemptId` per listing;
- `get_publish_status` reaches the same terminal states as browser publish;
- PM2 worker logs show the existing outbox dispatcher and `publish-jobs` worker path;
- no direct MCP queue job or duplicate attempt exists.

- [ ] **Step 7: Final ownership smoke**

Verify:

1. SUPER_ADMIN grants `mcp_access` and cannot see/create ADMIN secrets.
2. ADMIN creates two credentials and revokes one without affecting the other.
3. Removing `mcp_access` stops both immediately and sets suspension.
4. Restoring permission leaves both unusable until ADMIN clicks `Resume MCP`.
5. Temporary URL assets never appear in Design/Mockup Library.
6. Existing browser wizard still publishes through the same worker.

- [ ] **Step 8: Checkpoint without staging or committing**

Run:

```bash
git status --short
git diff --check
```

Report changed files, tests, build result, smoke IDs, and any deliberately skipped external
publish. Do not run `git add`, `git commit`, or `git push`.

## Plan Self-Review Checklist

- [ ] All three approved specs map to at least one task.
- [ ] All 16 catalog tools are registered exactly once and rendered in Tool Reference.
- [ ] No task gives SUPER_ADMIN access to another ADMIN's profile, token, OAuth grant, or defaults.
- [ ] No task adds per-user store ACL or credential store scope.
- [ ] PAT/OAuth scopes default to all currently effective groups, can narrow, and never auto-expand.
- [ ] Permission restoration requires explicit owner resume.
- [ ] URL inputs are temporary, image-only, bounded, and accept approved internal/private destinations.
- [ ] Temporary designs remain Design-compatible but are excluded from Library queries and counts.
- [ ] Temporary custom mockups use the current COMPOSITE path and template-owned source mode.
- [ ] Review token covers all publish-relevant child state, not only `WizardDraft.updatedAt`.
- [ ] Publish rechecks permission, revision, and checklist before transaction.
- [ ] Browser and MCP call the same `submitWizardPublish`.
- [ ] Only PublishOutbox dispatches the unchanged `publish-jobs` payload.
- [ ] No application feature flag exists.
- [ ] Cleanup never removes active/generating/publishing/retrying assets.
- [ ] No task introduces dynamic imports in application functions.
- [ ] No execution step stages, commits, or pushes.
