# Template Default Tags Design

## Goal

Allow each store template to carry default Shopify tags. When a wizard listing uses that template, Step 4 can start from those tags, and the user can add or remove tags before saving/publishing.

The feature is a seed-only workflow. Template tags help initialize manual content, but user-edited wizard tags remain the source of truth for the listing.

## Non-Goals

- Do not change AI generation or regeneration prompts.
- Do not merge template tags into AI-generated tags.
- Do not rewrite existing draft, pair, or listing tags when a template is edited later.
- Do not add tag autocomplete, Shopify tag lookup, or AI tag optimization changes in this phase.
- Do not change publish worker tag precedence or Printify tag enrichment behavior.

## Current Context

Template setup lives in `src/app/(authed)/stores/[id]/config/page.tsx`. The editor already supports pending template state, dirty detection, create/update payloads, and template duplication through store template routes and `src/lib/stores/store-service.ts`.

Wizard Step 4 lives in `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`. It edits `title`, `description`, `tags`, `collections`, and `altText` in `WizardDraft.aiContent` or pair-level `WizardDraftDesignPair.aiContent`. Step 4 already lets users add and remove tags manually.

Publish currently snapshots user-visible content tags into `Listing.tags` in `src/app/api/wizard/drafts/[id]/publish/route.ts`. This design keeps that publish contract unchanged.

## Data Model

Add template-level tags:

```prisma
defaultTags String[] @default([]) @map("default_tags")
```

The field belongs on `StoreMockupTemplate` because product tags are tied to product type and template selection, not only to the store.

Existing templates receive an empty list through the migration default.

## Normalization

Use the existing tag rules from `src/lib/wizard/product-organization.ts` as the shared application contract:

- trim each value;
- drop blank values;
- deduplicate case-insensitively;
- filter internal tags such as `mockupai` and `draft-preview`;
- cap to `MAX_TAGS` tags.

If implementation needs a clearer helper name, extract or wrap `mergeOptimizedTags([], input)` as `normalizeTags(input)` so template routes and Step 4 use the same rules without changing behavior.

## Template Editor

`TemplateDetail` includes:

```ts
defaultTags: string[];
```

`createEmptyTemplate()` initializes it to `[]`.

The template editor shows a compact chip input for default tags in the general template settings area. The control should match the Step 4 tag editing behavior:

- show current tags as removable chips;
- allow adding tags with Enter or an add button;
- disable adding once `MAX_TAGS` is reached;
- mark the template dirty when tags change.

`handleSaveTemplate()` sends `defaultTags` in both create and update payloads. Save remains explicit; changing tags must activate `Save template`, but must not auto-save.

## API Contract

The following paths include `defaultTags`:

- `GET /api/stores/[id]/mockup-templates`
- `POST /api/stores/[id]/mockup-templates`
- `PATCH /api/stores/[id]/mockup-templates/[templateId]`
- `GET /api/stores/[id]/wizard-config` if that endpoint serializes template details for wizard setup
- `POST /api/stores/[id]/mockup-templates/[templateId]/duplicate`
- service helpers that create, update, list, or duplicate templates

Create and update routes normalize `defaultTags` before persistence. Missing `defaultTags` is treated as `[]` on create and as unchanged on update when the field is omitted.

Duplicating a template copies normalized `defaultTags`.

## Wizard Step 4 Behavior

Step 4 derives the initial tag list with seed-only semantics:

1. If the active content already has tags, use those tags.
2. If the active content has no tags and the selected template has `defaultTags`, initialize local content tags from template tags.
3. After the user adds or removes tags, the local content state is authoritative.
4. Save persists exactly the user-visible tag list.

AI generation remains separate:

- `Tạo nội dung AI` keeps using the content generation endpoint and its returned tags.
- `Regenerate AI` keeps replacing content with AI-generated content.
- Template tags are not merged into AI tags automatically.

For pair mode, each pair follows the same rule independently: existing pair `aiContent.tags` wins; otherwise Step 4 can seed that pair's editable content from the selected template's default tags.

If a user removes all seeded tags and saves, the empty list is intentional. The UI must not immediately re-seed saved empty tags in the same draft content.

## Publish Behavior

Publish is unchanged. It uses `aiContent.tags` or pair `aiContent.tags` when creating `Listing.tags`.

This means template tags only reach Shopify when they have become part of the saved Step 4 content. Later edits to template tags do not affect already-created listings.

## Error Handling

Invalid tag inputs are cleaned rather than blocking save. Blank and duplicate tags disappear after normalization.

If API persistence fails, keep the existing template save error flow. The user should remain in the editor with unsaved tag state intact.

## Testing

Focused verification should cover:

- Prisma schema and migration add `StoreMockupTemplate.defaultTags`.
- Template create/update routes persist normalized `defaultTags`.
- Template duplicate copies `defaultTags`.
- Template list/wizard serialization includes `defaultTags`.
- Template editor dirty state turns true when `defaultTags` changes.
- Step 4 seeds template tags only when content has no tags.
- Step 4 does not re-seed after a saved empty tag list.
- AI generate/regenerate does not merge template tags.
- Publish route continues to snapshot `aiContent.tags` unchanged.

Use focused source tests where existing UI route tests are broad or tied to older wizard strings, then run `npm run build` and `git diff --check`.
