# Admin MCP Tools Catalog

Date: 2026-07-24
Status: Draft for review

## Purpose

This catalog is the human-readable source for the MCP Tool Reference shown in the current
ADMIN's account MCP tab. Runtime registration must expose the same title, description,
input schema, output schema, annotations, and structured response.

Profile activation, suspension/resume, OAuth connection, token creation/revoke/rotation,
credential scope, and personal defaults are account UI/API operations. They are not MCP
tools that Claude, Codex, or n8n calls.

Tool Reference is readable once the current ADMIN has `MCP_ACCESS`, including before profile
activation. Tool execution still requires an enabled profile, a usable credential, the
credential's tool scope, and the current app feature required by the tool.

## Ownership And Permission Model

1. SUPER_ADMIN grants or removes normal app features, including the `MCP_ACCESS` master
   gate.
2. ADMIN opens their own account and sets up one MCP profile.
3. ADMIN creates multiple OAuth grants or personal tokens when different clients need
   independent revoke/rotation.
4. Each credential defaults to all tool groups currently available to that ADMIN. The
   selected scope is a snapshot; later permission grants do not expand it automatically.
5. Credential scope may only narrow current app permissions.
6. Removing `MCP_ACCESS`, disabling the account, or changing the role away from ADMIN
   suspends the profile immediately. Restoring permission requires the ADMIN to resume it.

The current app has no per-user store ACL. `list_stores` returns every store in the
authenticated tenant. IDs and names are always resolved inside that tenant.

Tool-to-feature mapping:

| Operation | Required current app features |
| --- | --- |
| Store discovery | `MCP_ACCESS` |
| Search/reuse Design Library | `MCP_ACCESS + designs` |
| Search/reuse Mockup Library | `MCP_ACCESS + mockup_library` |
| Draft creation and temporary URL assets | `MCP_ACCESS + wizard` |
| Wizard config, content, generation, status, review | `MCP_ACCESS + wizard` |
| Publish submission and status | `MCP_ACCESS + wizard + listings` |

## Runtime Metadata Requirements

Every registered tool includes:

- `title`
- A client-readable `description` explaining when to use the tool.
- A strict `inputSchema` with descriptions on every field.
- An `outputSchema` for machine-readable results.
- `annotations.readOnlyHint`
- `annotations.destructiveHint`
- `annotations.idempotentHint`
- `structuredContent` matching the output schema.

All responses use:

```json
{
  "ok": true,
  "data": {},
  "warnings": [],
  "nextActions": []
}
```

Mutation tools require `idempotencyKey`. Reusing a key with the same normalized request
returns the original result. Reusing it with a different request returns
`IDEMPOTENCY_CONFLICT`.

Common error codes:

- `PERMISSION_DENIED`
- `CREDENTIAL_SCOPE_DENIED`
- `PROFILE_DISABLED`
- `PROFILE_SUSPENDED`
- `CREDENTIAL_REVOKED`
- `RESOURCE_NOT_FOUND`
- `AMBIGUOUS_REFERENCE`
- `VALIDATION_FAILED`
- `ASSET_URL_FETCH_FAILED`
- `UNSUPPORTED_IMAGE`
- `MOCKUP_SOURCE_MODE_CONFLICT`
- `MOCKUP_COVERAGE_INCOMPLETE`
- `CHECKLIST_NOT_READY`
- `REVISION_CONFLICT`
- `RATE_LIMITED`
- `IDEMPOTENCY_CONFLICT`

Errors must not reveal the existence of cross-tenant resources.

## Shared Parameter Types

### `storeRef`

Use one of:

```json
{ "id": "store_cuid" }
```

```json
{ "name": "North America Store" }
```

An ambiguous name blocks mutation and returns candidates.

### `designRef`

References an existing Design Library item:

```json
{ "id": "design_cuid" }
```

```json
{ "name": "Sunset Skull Light" }
```

### `mockupRef`

References an existing reusable Mockup Library item:

```json
{ "id": "mockup_cuid" }
```

```json
{ "name": "Black Tee Front" }
```

### `templateRef`

```json
{ "id": "template_cuid" }
```

or:

```json
{ "name": "Gildan 5000 Default" }
```

### URL assets

MCP accepts URL sources only. It does not accept upload sessions, multipart bodies, base64,
or client filesystem paths.

HTTP and HTTPS URLs may point to public, localhost, private, link-local, or internal
addresses. This is an accepted blind-SSRF risk. The importer remains image-only:

- Only `GET` and `HEAD`.
- No client-supplied headers, cookies, or credentials.
- Maximum 100 MB.
- Bounded timeout and redirect count.
- PNG/JPEG magic bytes required.
- Response bodies and detailed network failures are not echoed to the client.
- Audit logs remove URL query strings.

A local file can be exposed as a raw image URL through ngrok. The URL must return image
binary directly, not an HTML interstitial. The server copies valid input into temporary
draft storage before mockup generation, so the URL can be removed after the tool confirms
success.

## Current Wizard Contract

MCP mirrors the current five-step wizard:

1. Store.
2. Design.
3. Preview: template, colors, sizes, variants, placement, and mockup generation.
4. Content.
5. Review.

Every publish unit requires:

- At least one design.
- A completed mockup job.
- Included mockups covering every selected color.
- Complete content with a title.
- Valid placement.
- Non-stale mockups.
- Balanced light/dark color groups when a pair is used.

Light/dark pairing reuses the current naming rules. Explicit names take priority; URL
basenames are the fallback. Unpaired designs publish independently.

The selected template remains the authority for mockup source:

- `PRINTIFY`: upload the design by URL, store the returned Printify image ID, create the
  Printify draft product, and collect generated mockups.
- `CUSTOM`: use `COMPOSITE` background sources and the current composite worker.

Custom mockups are never treated as final images with artwork already baked in. Each source
has a view and explicit selected-color applicability, or `all`. `compositeRegionPx` is
optional; Smart Fit is the fallback and review returns the computed region and preview.

Temporary asset cleanup:

- Unattached transfer objects: 24 hours.
- Active, generating, publishing, or retrying draft/job: never delete.
- Terminal publish: retain seven days.
- Abandoned draft: expire after 30 days.

## Recommended Client Flow

1. `list_stores`
2. `get_store_wizard_config`
3. `create_listing_wizard`
4. `search_designs` and `set_wizard_designs`, or `attach_wizard_design_url`
5. `set_wizard_product_config`
6. For a CUSTOM template, `search_mockups` and/or `set_wizard_custom_mockups`
7. `set_wizard_content`
8. `generate_wizard_assets`
9. Poll `get_wizard_status`
10. `review_wizard`
11. Ask the user to approve the latest review
12. `publish_listing` with the latest `revisionToken`
13. Poll `get_publish_status`

`create_listing_wizard` is a hybrid convenience tool and may seed steps 1-4. Focused tools
remain available to correct the same draft. It never publishes.

## Discovery Tools

### `list_stores`

Title: List tenant stores

Description: List every store in the authenticated ADMIN's tenant. Use before creating a
wizard or when a store name needs resolution.

Permission: `MCP_ACCESS`

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`

Required params: none.

Optional params:

- `query`: string; filters name or Shopify domain.
- `status`: `ACTIVE | TOKEN_EXPIRED | ERROR | ANY`; default `ACTIVE`.
- `limit`: integer 1-100; default 25.

Returns:

- `stores[]`: `{ id, name, shopifyDomain, status, defaultPriceUsd, publishMode }`
- `nextActions[]`

### `search_designs`

Title: Search Design Library

Description: Search reusable, non-temporary Design Library items for the selected store.
Temporary URL designs never appear here.

Permission: `MCP_ACCESS + designs`

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `storeRef`

Optional params:

- `query`: string.
- `limit`: integer 1-100; default 20.

Returns:

- `designs[]`: `{ id, name, fileName, width, height, dpi, createdAt }`
- `candidates[]` when resolution is ambiguous.

### `search_mockups`

Title: Search Mockup Library

Description: Search reusable COMPOSITE mockup backgrounds that can be selected by a CUSTOM
template. Temporary mockup URLs never appear here.

Permission: `MCP_ACCESS + mockup_library`

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `storeRef`

Optional params:

- `query`: string.
- `view`: `front | back | sleeve_left | sleeve_right | detail | lifestyle`.
- `limit`: integer 1-100; default 20.

Returns:

- `mockups[]`: `{ id, name, view, sceneType, width, height, hasCompositeRegion }`

### `get_store_wizard_config`

Title: Get store wizard config

Description: Read the current store defaults, templates, enabled colors, sizes, variants,
pricing, placement, and template-owned mockup source.

Permission: `MCP_ACCESS + wizard`

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `storeRef`

Returns:

- `store`
- `templates[]`, including `defaultMockupSource: PRINTIFY | CUSTOM`
- `colors[]`
- `sizes[]`
- `defaults`
- `warnings[]`

### `get_listing_wizard`

Title: Get listing wizard

Description: Read one normalized wizard draft with selected designs, pairs, product config,
custom mockup sources, content, mockup jobs, readiness, listings, and publish state.

Permission: `MCP_ACCESS + wizard`

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `draftId`

Optional params:

- `includeJobs`: boolean; default true.
- `includePreview`: boolean; default false.

Returns:

- `draft`
- `designs[]`
- `designPairs[]`
- `customMockups[]`
- `checklist`
- `jobs[]`
- `warnings[]`

## Wizard Mutation Tools

### `create_listing_wizard`

Title: Create listing wizard

Description: Create a wizard draft for a tenant store and optionally seed current wizard
steps. Use this as the first mutation. It never publishes.

Permission: `MCP_ACCESS + wizard`

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `storeRef`
- `idempotencyKey`

Optional params:

- `designRefs[]`: existing Design Library references; also requires `designs`.
- `designUrls[]`: `{ url, name? }`; materialized as temporary draft designs.
- `templateRef`
- `productConfig`
- `customMockups[]`: same entries as `set_wizard_custom_mockups`; only valid with a CUSTOM
  template.
- `contentSeed`: `{ targets[] }`. Each target is:
  - `target`: `{ type: "DESIGN_NAME", value: string }` for an independent design, or
    `{ type: "PAIR_BASE_NAME", value: string }` for a light/dark pair.
  - `content`: optional `title`, `description`, `tags[]`, and
    `organizationCollections[]`.
  Target values use exact normalized names after URL basename fallback and auto-pairing.
  Missing or ambiguous targets return `AMBIGUOUS_REFERENCE`; content is never silently
  copied across multiple publish units.
- `pairingMode`: `AUTO | NONE`; default `AUTO`.

Returns:

- `draftId`
- `currentStep`
- `designs[]`
- `designPairs[]`
- `warnings[]`
- `nextActions[]`

### `attach_wizard_design_url`

Title: Attach temporary design URL

Description: Fetch one HTTP/HTTPS image, validate it, materialize it into temporary draft
storage, create the internal Design-compatible metadata required by the current wizard, and
attach it to the draft. It never adds an item to Design Library.

Permission: `MCP_ACCESS + wizard`

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `draftId`
- `url`
- `idempotencyKey`

Optional params:

- `name`: fallback is the URL basename.
- `pairingMode`: `AUTO | NONE`; default `AUTO`.

Returns:

- `draftId`
- `draftDesign`
- `designPairs[]`
- `mockupsStale`
- `expiresAt`
- `warnings[]`

Common errors: `ASSET_URL_FETCH_FAILED`, `UNSUPPORTED_IMAGE`, `VALIDATION_FAILED`.

### `set_wizard_designs`

Title: Set wizard designs

Description: Replace selected designs using existing Library references and/or already
attached temporary draft-design IDs. Current pairing logic is recomputed.

Permission: `MCP_ACCESS + wizard`; Library references additionally require `designs`.

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `draftId`
- `designs[]`: entries contain one `designRef` or `draftDesignId`.
- `idempotencyKey`

Optional params:

- `pairingMode`: `AUTO | NONE`; default `AUTO`.

Returns:

- `designs[]`
- `designPairs[]`
- `mockupsStale`
- `warnings[]`

### `set_wizard_custom_mockups`

Title: Set custom composite mockups

Description: Replace the draft's custom COMPOSITE mockup sources. URL sources are copied to
temporary storage; Library sources remain references. The selected template must use
`defaultMockupSource: CUSTOM`.

Permission: `MCP_ACCESS + wizard`; Library references additionally require
`mockup_library`.

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `draftId`
- `mockups[]`
- `idempotencyKey`

Each mockup contains:

- Exactly one source: `{ "url": "http://..." }` or `{ "mockupRef": { "id": "..." } }`.
- `view`: `front | back | sleeve_left | sleeve_right | detail | lifestyle`.
- `appliesToColorRefs`: non-empty array of store color IDs/names, or `["all"]`.

Optional fields per mockup:

- `name`
- `compositeRegionPx`: `{ x, y, width, height, rotationDeg?, imageWidth?, imageHeight? }`
- `isPrimary`: boolean.
- `sortOrder`: integer.

Returns:

- `customMockups[]`
- `coverage`: `{ coveredColorIds[], missingColorIds[] }`
- `computedRegions[]`
- `mockupsStale`
- `warnings[]`

Common errors: `MOCKUP_SOURCE_MODE_CONFLICT`, `MOCKUP_COVERAGE_INCOMPLETE`,
`ASSET_URL_FETCH_FAILED`, `UNSUPPORTED_IMAGE`.

### `set_wizard_product_config`

Title: Set wizard product config

Description: Update the selected template, colors, sizes, variants, prices, and print
placement using the same fields as the current Preview step. The selected template is the
only authority for PRINTIFY versus CUSTOM mockup source.

Permission: `MCP_ACCESS + wizard`

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `draftId`
- `idempotencyKey`

Optional params:

- `templateRef`
- `enabledColorIds[]`
- `enabledSizes[]`
- `enabledSizesByColor`
- `enabledVariantIdsOverride[]`
- `priceBySizeOverride`
- `placementOverride`

Returns:

- `productConfig`
- `mockupsStale`
- `warnings[]`

### `set_wizard_content`

Title: Set wizard content

Description: Save title, description, tags, and collections for one independent design or
one light/dark pair. Title is required before review can become publish-ready.

Permission: `MCP_ACCESS + wizard`

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `draftId`
- `target`: `{ type: "DESIGN", draftDesignId }` or `{ type: "PAIR", pairId }`.
- `content`
- `idempotencyKey`

Optional content fields:

- `title`
- `description`
- `tags[]`
- `organizationCollections[]`

Returns:

- `target`
- `contentSummary`
- `warnings[]`

### `generate_wizard_assets`

Title: Generate wizard assets

Description: Start the existing mockup generation/composite jobs and optionally content
generation. The tool reuses current queues and returns quickly.

Permission: `MCP_ACCESS + wizard`

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `draftId`
- `assetTypes[]`: `MOCKUPS` and/or `CONTENT`.
- `idempotencyKey`

Optional params:

- `force`: boolean; default false.

Returns:

- `jobs[]`
- `status`
- `nextActions[]`

### `get_wizard_status`

Title: Get wizard status

Description: Poll current draft, mockup generation, stale state, content readiness, and
current server-side checklist.

Permission: `MCP_ACCESS + wizard`

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `draftId`

Optional params:

- `includeJobs`: boolean; default true.
- `includeWarnings`: boolean; default true.

Returns:

- `draftId`
- `status`
- `readyForReview`
- `checklist`
- `jobs[]`
- `warnings[]`
- `nextActions[]`

## Review And Publish Tools

### `review_wizard`

Title: Review wizard

Description: Run the current server-side readiness checklist and return previews, publish
units, warnings, and an opaque revision token for the exact reviewed state.

Permission: `MCP_ACCESS + wizard`

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`

Required params:

- `draftId`

Optional params:

- `includePreview`: boolean; default true.
- `includePublishPlan`: boolean; default true.

Returns:

- `draftId`
- `revisionToken`
- `reviewedAt`
- `readyToPublish`
- `checklist`
- `preview`
- `publishUnits[]`
- `warnings[]`
- `nextActions[]`

The token proves revision freshness, not human approval. The MCP client asks the user before
calling `publish_listing`.

### `publish_listing`

Title: Publish reviewed listings

Description: Revalidate permissions, credential scope, revision token, and the complete
server-side checklist, then call the shared publish submission service. It creates the same
Listing, PublishAttempt, PublishJob, and PublishOutbox shape as the UI. It never enqueues or
publishes inline.

Permission: `MCP_ACCESS + wizard + listings`

Annotations: `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true`

Required params:

- `draftId`
- `revisionToken`
- `idempotencyKey`

Optional params:

- `note`: short audit note.

Returns:

- `draftId`
- `overallStatus`
- `submissions[]`: `{ listingId, publishAttemptId, draftDesignId?, pairId?, status }`
- `nextActions[]`

Common errors: `REVISION_CONFLICT`, `CHECKLIST_NOT_READY`, `PERMISSION_DENIED`,
`CREDENTIAL_SCOPE_DENIED`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`.

### `get_publish_status`

Title: Get publish status

Description: Read persisted listing, attempt, and per-stage job status. Polling never
creates a retry.

Permission: `MCP_ACCESS + wizard + listings`

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`

Required params: exactly one selector:

- `draftId`
- `listingId`
- `publishAttemptId`

Optional params:

- `includeJobs`: boolean; default true.

Returns:

- `overallStatus`: `PUBLISHING | ACTIVE | PARTIAL_FAILURE | FAILED`
- `listings[]`
- `attempts[]`
- `jobs[]`, with stage status `PENDING | RUNNING | RETRY_SCHEDULED | SUCCEEDED | FAILED`
- `nextRetryAt`
- `warnings[]`

## Client Setup Docs For ADMIN

The ADMIN MCP tab provides:

- Remote MCP URL: `/mcp`.
- OAuth Authorization Code + PKCE or a personal bearer token.
- Credential label, tool-scope snapshot, prefix, expiry, status, and last-used metadata.
- Copyable Claude, Codex, and n8n configuration.
- A warning that plaintext PAT is shown once.

Recommended first prompt:

```text
Use the MockupAI MCP tools to list my stores, create a listing wizard using the design and
mockup URLs I provide, show me the final review, and ask before calling publish_listing.
```

Client guidance:

- Never pass `tenantId`.
- Do not invent IDs when name resolution is ambiguous.
- Keep ngrok/local image URLs alive until URL-import tools return success.
- Do not pass cookies, headers, or credentials for image URLs.
- Use idempotency keys for mutations.
- Use the latest `revisionToken`.
- Ask before `publish_listing`.
- Poll status tools; do not create manual retries from polling.

SUPER_ADMIN does not configure another ADMIN's MCP profile, credential, client, or tools.
Granting `MCP_ACCESS` ends the SUPER_ADMIN journey.
