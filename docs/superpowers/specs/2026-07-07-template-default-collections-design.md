
# Template Default Collections Design

## Goal

Add template-level default collections with the same flow as template default tags.

Users configure collections inside each mockup template in store config. Wizard Step 4 seeds those collections into the editable product organization form only when the current content has no collections.

## Non-Goals

- Do not change Shopify publish behavior.
- Do not assign Shopify collections directly from the template.
- Do not create or manage Shopify collections.
- Do not change AI content generation or the existing "Tối ưu tags & collections" flow.
- Do not auto-save Step 4 content when defaults are seeded; the user still saves through the existing Step 4 flow.

## Architecture

Mirror the current `defaultTags` implementation with a separate `defaultCollections` template field.

`StoreMockupTemplate` persists a normalized string array:

```prisma
defaultCollections String[] @default([]) @map("default_collections")
```

Service and API routes expose it beside `defaultTags`. Store config adds a chip input in the template general settings area. Wizard draft responses include it on `draft.template` and store templates so Step 4 can seed editable collections.

Step 4 derives initial collections as:

```ts
const existingCollections = normalizeOrganizationCollections(existing?.collections || []);
const templateDefaultCollections = normalizeOrganizationCollections(draft?.template?.defaultCollections);
const initialCollections =
  existingCollections.length > 0 ? existingCollections : templateDefaultCollections;
```

This keeps the same rule as tags: template defaults fill an empty manual field, but they do not overwrite saved content.

## Components

### Prisma

Add `default_collections TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]` to `store_mockup_templates`.

The Prisma field should sit near `defaultTags` so template content defaults stay grouped.

### Store Service

Add helpers parallel to tags:

- `loadTemplateDefaultCollections(templateIds, client = prisma)`
- `updateTemplateDefaultCollections(templateId, defaultCollections, client)`

Use existing `normalizeOrganizationCollections()` from `src/lib/wizard/product-organization.ts`.

Create, update, and duplicate template flows persist or copy default collections just like default tags.

### Template APIs

Expose and accept `defaultCollections` in:

- `src/app/api/stores/[id]/mockup-templates/route.ts`
- `src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts`
- `src/app/api/stores/[id]/wizard-config/route.ts`
- `src/app/api/wizard/drafts/[id]/route.ts`

Input remains `unknown` at API/service boundaries and is normalized before persistence or response usage.

### Store Config UI

Add `TemplateDefaultCollectionsField` near the existing `TemplateDefaultTagsField` in template "Cài đặt chung".

Behavior:

- chip list display
- add by button or Enter
- remove chip
- max count uses `MAX_ORGANIZATION_COLLECTIONS`
- dirty check compares normalized arrays
- save payload includes `defaultCollections`
- new template defaults to `[]`

The UI should reuse the same simple chip-input pattern already used by tags.

### Wizard Step 4

Seed collections from `draft.template.defaultCollections` only when active content has no collections.

Do not merge template defaults into AI generation. Do not merge them into optimizer output. Once the user saves Step 4, the normal `aiContent.collections` path owns persistence.

## Data Flow

1. User opens store config and edits a mockup template.
2. User adds default collections in the template general settings.
3. Template save sends `defaultCollections`.
4. Service normalizes and stores `default_collections`.
5. Wizard draft/template APIs return `defaultCollections`.
6. Step 4 loads a draft.
7. If the active content already has collections, Step 4 shows those.
8. If the active content has no collections, Step 4 shows template default collections.
9. User can edit, optimize, save, or remove them using the existing Step 4 controls.
10. Publish uses the already-saved listing organization data as it does today.

## Error Handling

- Non-array input normalizes to `[]`.
- Blank values are dropped.
- Duplicates are removed case-insensitively.
- Values are capped at `MAX_ORGANIZATION_COLLECTIONS`.
- Missing DB rows or missing template fields return `[]`.
- Existing saved Step 4 collections are never overwritten by template defaults.

## Testing

Use focused tests/source tests matching the existing default tags coverage:

- product organization normalizer already covers collection normalization; add only if current coverage is missing.
- template route/service source test checks `defaultCollections` read/write/copy contract.
- config UI source test checks dirty check, save payload, and field rendering.
- Step 4 source test checks default collections seed only when active content has no collections.
- publish route source test remains unchanged except asserting no direct template default collection dependency if needed.

## Acceptance Cases

### Empty Content

Template default collections:

```ts
["Summer", "Gift Ideas"]
```

Existing Step 4 content:

```ts
collections: []
```

Step 4 initial collections:

```ts
["Summer", "Gift Ideas"]
```

### Existing Content

Template default collections:

```ts
["Summer", "Gift Ideas"]
```

Existing Step 4 content:

```ts
collections: ["Halloween"]
```

Step 4 initial collections:

```ts
["Halloween"]
```

### Save and Publish

Template defaults do not publish by themselves. They publish only after Step 4 saves them through the existing content path.
