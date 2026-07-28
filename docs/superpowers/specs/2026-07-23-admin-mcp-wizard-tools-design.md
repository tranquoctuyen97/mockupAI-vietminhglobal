# Admin MCP Wizard Tools Design

Date: 2026-07-23
Status: Draft for review

## Problem

Admins need an MCP interface for creating listing wizard drafts, reviewing them, and
publishing through the existing queue-backed publish flow. The setup must be per admin
account, tenant-safe, and compatible with desktop MCP clients, cloud agents, n8n, and
internal automation.

The feature must not create a parallel publish path or weaken the current worker contracts.
MCP should prepare and submit the same wizard/listing state that the web UI uses, then let
the existing publish queue, attempts, jobs, outbox, rate-limit handling, cooldowns, and
worker retries handle upstream publishing.

## Approved Decisions

- Permission flow is: SUPER_ADMIN grants normal app permissions -> ADMIN enables their own
  MCP profile -> ADMIN creates their own credentials/config -> MCP enforces the ADMIN's
  current app permissions on every request.
- MCP setup is self-service for each admin account. An ADMIN has one MCP profile and may
  create multiple OAuth grants or personal tokens for different clients.
- SUPER_ADMIN does not create or configure an ADMIN's MCP profile/token. SUPER_ADMIN only
  controls the ADMIN role, account status, and normal app feature permissions that MCP
  inherits.
- ADMIN can create, update, rotate, and revoke only their own MCP config and credentials.
  Every credential has its own tool-scope snapshot, defaults to all currently effective
  tool groups, and may only narrow the ADMIN's current app permissions. New permissions do
  not silently expand an existing credential.
- `MCP_ACCESS` is a master gate, not a second per-tool permission system. Tool authorization
  is the live intersection of `MCP_ACCESS`, the existing app feature required by the tool,
  profile status, credential status/scope, and tenant ownership.
- The current app has no per-user store ACL. An authorized ADMIN can discover and use all
  stores in their tenant. Store names remain subject to ambiguity checks, but there is no
  owner-selected or SUPER_ADMIN-selected store security scope in this phase.
- Identity is derived from OAuth or bearer credential and maps to `userId` and `tenantId`.
  MCP requests never accept tenant IDs from clients.
- All store, design, template, draft, and listing references are resolved inside the
  authenticated tenant. Ambiguous names block mutation and return candidates.
- Removing `MCP_ACCESS`, disabling the account, or changing the role away from ADMIN
  immediately suspends the profile without deleting its configuration or credential
  hashes. Restoring permission does not reactivate it; the ADMIN must explicitly resume
  their own profile.
- Default automation prepares a wizard for review. Publishing requires a separate explicit
  `publish_listing` tool call.
- `review_wizard` returns a `revisionToken`. `publish_listing` requires `draftId`,
  `revisionToken`, and an idempotency key, and rejects if the draft changed after review.
- Human confirmation is a client responsibility: Claude/Codex asks the user before calling
  `publish_listing`. The server proves permission and revision freshness, not that a human
  clicked a server-side approval button.
- The MCP wizard follows the current five-step flow: Store, Design, Preview, Content, and
  Review. Every publish unit requires at least one design and completed, included mockups
  that cover every selected color.
- Design input supports existing Design Library items or HTTP/HTTPS URLs. Custom mockup
  input supports HTTP/HTTPS URLs only and is a `COMPOSITE` background, not a final image
  with artwork already baked in. Local files must first be exposed at a URL such as ngrok.
- URL assets are materialized into draft-scoped temporary storage before mockup generation.
  They do not appear in Design Library or Mockup Library and are not reusable after
  cleanup. MCP does not accept base64 JSON, upload sessions, or client filesystem paths.
- Design pairing reuses the current light/dark naming logic, using an explicit display name
  and falling back to the URL basename. Proposed pairs are visible and editable before
  review.
- Each custom mockup declares `view` and `appliesToColorRefs`, or explicitly uses `all`.
  `compositeRegionPx` is optional; the current Smart Fit behavior is the fallback and the
  computed region is shown in review.
- Temporary URL-materialization objects not attached to a draft expire after 24 hours. Attached assets
  are never deleted while a draft/job is active or retrying, remain for seven days after a
  terminal publish, and expire when a draft has been abandoned for 30 days.
- MCP supports remote HTTP transport for desktop, cloud, n8n, and internal clients.
- OAuth Authorization Code + PKCE supports desktop/cloud clients. Personal bearer tokens
  with expiry support n8n/internal automation.
- There is no application feature flag for MCP. Operational shutdown uses permission
  removal, profile suspension, or stopping/removing the MCP process/reverse-proxy route.

## Admin UI

MCP setup belongs under the ADMIN's own account settings, not a SUPER_ADMIN setup console.
The product must present two separate journeys:

```text
SUPER_ADMIN: Users -> Role/Permissions -> grant/remove MCP_ACCESS -> done
ADMIN: My Account -> MCP -> set up profile -> create credential -> connect client
```

- SUPER_ADMIN role/permission UI should expose a normal app permission such as
  `MCP_ACCESS`, plus existing feature permissions. This grants the ability to use MCP but
  does not create an MCP profile.
- Users list may show read-only MCP status for SUPER_ADMIN, but it must not expose token
  creation or MCP config controls for another admin.
- Users list status wording must preserve ownership: `Not allowed`, `Available`,
  `Self-enabled`, `Setup incomplete`, `Connection issue`, or `Access revoked`. Never show
  `Enabled by admin`, `Disabled by admin`, `Enable for user`, or equivalent labels.
- Saving `MCP_ACCESS` ends the SUPER_ADMIN journey. The confirmation should state that the
  ADMIN can now set up their own connection; it must not navigate SUPER_ADMIN into MCP
  configuration.
- Admin account/settings route exposes an `MCP` tab for the currently logged-in ADMIN.
- If the ADMIN does not have `MCP_ACCESS`, the `MCP` tab shows a read-only unavailable
  state with the exact missing permission and no enable, token, or config controls.
- If the ADMIN has `MCP_ACCESS` but no profile, the `MCP` tab shows inherited permissions
  and a `Set up my MCP` action.
- First-time setup walks the current ADMIN through read-only scope review, authentication
  method selection, self-managed profile creation, first credential/OAuth authorization,
  copyable client configuration, and connection testing. Abandoned setup is resumable and
  appears as `Setup incomplete`.
- If MCP is enabled, the `MCP` tab shows connection status, last used time, current scope,
  default wizard config, enabled tool preferences, inherited rate limits, OAuth grants,
  personal tokens, tool reference, and audit history. Store selection is a personal default
  only; it is not an access-control scope.
- Tool Reference is readable as soon as the ADMIN has `MCP_ACCESS`, even before profile
  activation. Tool execution still requires an enabled profile and usable credential.
- Profile activation, OAuth connection, token lifecycle, and personal defaults are
  self-service account UI/API operations, not callable MCP tools and not a `Profile` tool
  category.
- Current feature scope is read from the ADMIN's existing permissions and shown as
  non-expandable guardrails. Credential scope defaults to all currently effective tool
  groups and can be narrowed before creation.
- ADMIN controls their own MCP defaults, enabled tool preferences within allowed tools,
  OAuth grants, and personal tokens.
- SUPER_ADMIN changes MCP capability by changing the ADMIN's app permissions, role, or
  account status, not by editing the ADMIN's MCP profile.
- When access is restored after suspension, the account MCP tab shows a `Resume MCP`
  action. Old credentials remain unusable until the owning ADMIN resumes the profile.
- Plaintext bearer tokens are shown once only when created or rotated. Stored credentials
  are hashed and displayed later only by prefix, expiry, status, and last-used metadata.

If the app currently has only `/admin/users`, implementation should add an account settings
or profile route for the current ADMIN before building the MCP tab. The Users list should
not carry the full MCP configuration UI.

## Architecture

Add a separate MCP process in the same repo, deployable as `mockupai-mcp`, mounted by
reverse proxy at `/mcp`.

The MCP process shares database schema, Prisma access, audit helpers, storage helpers, and
wizard/publish application services with the Next app. It must not call Next API routes over
HTTP for internal work.

The process owns:

- MCP HTTP transport and session handling
- OAuth/PAT authentication
- profile ACL checks
- tool registry
- MCP-specific rate limiting and idempotency
- mapping tool requests into shared application services

The Next app owns:

- admin/account UI for self-service MCP profile and credential management
- normal browser wizard flow
- existing API compatibility

The existing worker owns:

- BullMQ `publish-jobs`
- `PublishAttempt`, `PublishJob`, and `PublishOutbox` processing
- upstream Printify/Shopify cooldowns, merchant locks, delayed retries, and finalization

## Data Model

Add MCP-specific tables with tenant and user scoping:

- `McpProfile`: one self-managed profile per ADMIN, with tenant, owner user, status,
  suspension reason, profile version, default config, default store preference, enabled
  tool preferences, and resume metadata.
- `McpCredential`: personal token hash, prefix, expiry, tool-scope snapshot,
  created/last-used/revoked metadata, and optional client label.
- `McpOAuthGrant`: OAuth client/grant/token hashes, tool-scope snapshot, expiry, revocation,
  and optional client label.
- `McpIdempotencyRecord`: profile, tool, idempotency key, request hash, status, and result
  reference.
- `WizardDraftMockupSource`: draft-scoped temporary custom mockup metadata, storage path,
  view, color applicability, composite region, expiry, and source URL audit metadata.
- A temporary-design marker and expiry metadata on the current Design-compatible record so
  existing `WizardDraftDesign`, mockup generation, and publish code can keep reading
  `storagePath`, dimensions, DPI, and MIME metadata. Design Library queries must exclude
  these records.

Disabling the user, changing the role away from ADMIN, removing `MCP_ACCESS`, disabling or
suspending the profile, or revoking the credential must immediately prevent future MCP
calls for that scope.

Audit events must cover self-service profile changes, credential creation/rotation/revoke,
OAuth grants, tool mutations, draft creation, review, publish submission, and upstream
permission changes that change effective MCP access. Audit payloads must not store token
plaintext or file contents.

## Tool Contract

Detailed tool descriptions, parameters, examples, and client-facing documentation live in
`docs/superpowers/specs/2026-07-24-admin-mcp-tools-catalog.md`. The MCP implementation and
ADMIN UI Tool Reference must stay aligned with that catalog.

Each registered MCP tool must include client-readable metadata:

- `title`: short UI label.
- `description`: clear when-to-use guidance for Claude, Codex, desktop clients, and
  automation tools.
- `inputSchema`: explicit Zod schema for all params, including required fields,
  optional fields, enums, and field descriptions.
- `outputSchema`: explicit structured output schema when the result is machine-readable.
- `annotations`: MCP client hints such as `readOnlyHint`, `destructiveHint`, and
  `idempotentHint` where applicable.
- `structuredContent`: returned for all non-trivial results so clients can consume IDs,
  warnings, status, and next actions without parsing prose.

Tool responses should use a stable shape:

```json
{
  "ok": true,
  "data": {},
  "warnings": [],
  "nextActions": []
}
```

Recoverable validation or business errors should return MCP tool errors with stable codes
instead of throwing generic server failures:

- `AMBIGUOUS_REFERENCE`
- `RESOURCE_NOT_FOUND`
- `PERMISSION_DENIED`
- `REVISION_CONFLICT`
- `RATE_LIMITED`
- `VALIDATION_FAILED`
- `IDEMPOTENCY_CONFLICT`
- `CREDENTIAL_REVOKED`
- `PROFILE_DISABLED`
- `PROFILE_SUSPENDED`
- `CREDENTIAL_SCOPE_DENIED`
- `ASSET_URL_FETCH_FAILED`
- `UNSUPPORTED_IMAGE`
- `MOCKUP_SOURCE_MODE_CONFLICT`
- `MOCKUP_COVERAGE_INCOMPLETE`
- `CHECKLIST_NOT_READY`

Discovery tools:

- `list_stores`
- `search_designs`
- `search_mockups`
- `get_store_wizard_config`
- `get_listing_wizard`

Wizard mutation tools:

- `create_listing_wizard`
- `attach_wizard_design_url`
- `set_wizard_custom_mockups`
- `set_wizard_designs`
- `set_wizard_product_config`
- `set_wizard_content`
- `generate_wizard_assets`
- `get_wizard_status`

Review and publish tools:

- `review_wizard`
- `publish_listing`
- `get_publish_status`

`create_listing_wizard` is a hybrid entry point: it may seed store, existing designs or
design URLs, template/product config, custom mockup URLs, and content. Focused tools remain
available to correct each current wizard step. It never publishes.

Tool permissions map to existing app features:

- MCP authentication and tenant store discovery require `MCP_ACCESS`.
- Searching/reusing Design Library requires `MCP_ACCESS + designs`.
- Searching/reusing Mockup Library requires `MCP_ACCESS + mockup_library`.
- Draft creation, temporary design URL import, temporary custom mockup URL import, product
  configuration, content, generation, status, and review require `MCP_ACCESS + wizard`.
- Publish submission and publish status require `MCP_ACCESS + wizard + listings`.

`publish_listing` must not support force publish, bypass review, inline upstream publish,
or a separate retry creator in the first version. It is registered with
`destructiveHint: true`.

The ADMIN account MCP tab must include a `Tool Reference` view that renders the same catalog
for humans: tool purpose, required params, optional params, examples, common errors, and the
recommended Claude/Codex/n8n flow.

## Rate Limits And Backpressure

MCP client limits are separate from upstream Printify/Shopify throttling.

- Use distributed Redis buckets by MCP profile and tool class.
- Expensive operations such as URL import, asset generation, and publish submission
  require idempotency keys.
- MCP returns queued job or attempt identifiers quickly for heavy work.
- MCP does not call Printify or Shopify directly.
- Existing worker-side Printify/Shopify rate limit behavior remains the source of truth:
  cooldown gates, merchant account locks, `Retry-After`, BullMQ delayed retry, and worker
  concurrency stay in the worker path.

This prevents MCP clients from overloading the app while keeping upstream publish behavior
identical to UI-initiated publishing.

## Worker Compatibility

The existing publish worker contract is a hard boundary.

- Keep the current queue name and payload shape for `publish-jobs`.
- Keep `PublishAttempt`, `PublishJob`, `PublishOutbox`, dispatcher, retry, and concurrency
  behavior compatible with the UI path.
- Extract the web publish-route transaction into a shared application service.
- Both the UI route and MCP `publish_listing` call the same shared publish service.
- The shared service re-runs the current `buildChecklist()` invariants server-side before
  creating any listing, attempt, job, or outbox row. UI button state is not an authorization
  boundary.
- MCP never enqueues directly, never creates a second publish queue, and never publishes
  inline.
- Revision validation runs before the shared publish service is called.

Characterization tests must prove UI and MCP publish submission create equivalent database,
attempt, job, and outbox shape for the same reviewed wizard.

## Security

- OAuth uses Authorization Code + PKCE and validates bearer tokens at the MCP HTTP boundary.
- PAT secrets are generated server-side, displayed once, hashed at rest, and revocable.
- Scopes are derived from the ADMIN's current app permissions plus their self-service MCP
  preferences, not from client-submitted claims.
- URL import intentionally permits HTTP and HTTPS sources on public, localhost, private,
  link-local, and internal addresses. This is an accepted blind-SSRF risk.
- The internal/private URL exception remains image-only: only `GET` and `HEAD`, no caller
  headers/cookies/credentials, PNG/JPEG magic bytes required, 100 MB maximum, bounded
  timeout and redirect count, no response body or detailed network errors returned to the
  client, and audit logging with query strings removed.
- URL content is copied into temporary storage before mockup generation. Printify receives
  the resulting storage URL through its upload-by-URL endpoint and product creation uses
  the returned Printify image ID. Shopify receives a reachable URL through
  `CreateMediaInput.originalSource`.
- Tool inputs use explicit schemas and should return structured validation errors.
- Logs and audit records must redact Authorization headers, token values, upload URLs with
  secrets, and file contents.

## Non-Goals

- No separate `/admin/mcp` console in the first version.
- No direct MCP-to-Printify or MCP-to-Shopify publishing.
- No force publish or bypass-review tool.
- No automatic retry creation from MCP status tools.
- No tenant impersonation or tenant ID input in MCP tools.
- No upload session, base64 JSON, multipart upload, or client filesystem path in MCP tools.
- No application-level MCP feature flag.
- No plaintext token recovery after initial display.

## Verification

- Profile ACL tests prove SUPER_ADMIN cannot create or edit another ADMIN's MCP token/config
  and that ADMIN self-service is constrained by current app permissions.
- Auth tests cover revoked/expired/disabled credentials and disabled admin accounts.
- Tenant tests prove all authenticated ADMINs see all stores in their own tenant and cannot
  resolve cross-tenant resources. Ambiguous store names return candidates.
- URL import tests cover HTTP/HTTPS public and private sources, image-only restrictions,
  redirects, timeout, 100 MB limit, magic-byte validation, redacted errors/audit, temporary
  persistence, and cleanup lifecycle.
- Temporary custom mockup tests cover `COMPOSITE` rendering, explicit view/color mapping,
  `all`, Smart Fit fallback, and complete selected-color coverage.
- Wizard tool tests prove MCP drafts match the existing wizard data model.
- Readiness tests prove both UI and MCP publish submission reject design-less,
  mockup-incomplete, stale, content-incomplete, invalid-placement, and unbalanced-pair
  drafts before a transaction begins.
- Revision tests prove `publish_listing` rejects stale review tokens.
- Publish characterization tests prove UI and MCP produce the same listing, attempt, jobs,
  and outbox shape.
- Existing publish worker tests continue passing without changing queue or payload contract.
- Admin UI smoke tests cover read-only Users list MCP status, ADMIN account MCP tab,
  self-service enable/disable/suspend/resume, Tool Reference docs, credential-scope
  snapshots, config, and credential rotation.
- Deployment smoke covers `/mcp` reverse proxy, OAuth callback, PAT call, rate-limit
  response, and publish status polling.
