# Template Pricing and Composite Region Design

## Goal

Move retail pricing from the global Pricing admin page into each store mockup template, and move the default CUSTOM mockup design frame into the template. A template should be configured once and reused by future wizard drafts, while the wizard keeps its existing per-draft override controls.

PRINTIFY templates keep Placement because Printify needs print placement for API rendering. CUSTOM templates do not show Placement in the template editor; they use a default composite region in the Mockups step instead.

## Non-Goals

- Do not drop `ProductPricingTemplate`; existing listings and old data can remain in the database.
- Do not remove `WizardDraft.priceBySizeOverride`; it remains the highest-priority draft override.
- Do not assign CUSTOM templates a Printify placement tab.
- Do not change Printify placement behavior for PRINTIFY templates.
- Do not add per-color default composite regions in this phase. One template-level region applies to all colors.

## Data Model

Add three nullable fields to `StoreMockupTemplate`:

```prisma
basePriceUsd             Decimal? @map("base_price_usd") @db.Decimal(10, 2)
priceBySizeDefault       Json?    @map("price_by_size_default")
defaultCompositeRegionPx Json?    @map("default_composite_region_px")
```

`basePriceUsd` uses `Decimal`, not `Float`, so it matches `Store.defaultPriceUsd` and avoids binary float drift for money.

`priceBySizeDefault` is the template-level per-size map, for example:

```ts
{ "2XL": 27.99, "3XL": 29.99 }
```

The name intentionally differs from `WizardDraft.priceBySizeOverride` so template defaults and draft overrides are not confused.

`defaultCompositeRegionPx` uses the existing composite region shape:

```ts
{
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  imageWidth: number;
  imageHeight: number;
}
```

The migration adds nullable columns only:

```sql
ALTER TABLE "store_mockup_templates"
  ADD COLUMN "base_price_usd" DECIMAL(10, 2),
  ADD COLUMN "price_by_size_default" JSONB,
  ADD COLUMN "default_composite_region_px" JSONB;
```

## Template Editor

`TemplateDetail` in the store config page includes:

```ts
basePriceUsd: number | null;
priceBySizeDefault: Record<string, number> | null;
defaultCompositeRegionPx: CompositeRegion | null;
```

`createEmptyTemplate()` initializes all three fields to `null`.

The template editor tab order becomes:

```ts
CUSTOM:   ["blueprint", "variants", "mockups", "pricing"]
PRINTIFY: ["blueprint", "variants", "placement", "pricing"]
```

The `pricing` tab label is `Giá bán` in the UI. CUSTOM templates never render `EditorPlacementStep`; PRINTIFY templates keep it unchanged.

Add `EditorPricingStep` as the last tab. It fetches size/cost data through the same store sizes endpoint already used by variant review flows, then renders:

- base price input
- per-size table: size, Printify cost, editable retail price, margin/delta
- reset actions for base price and per-size defaults

`handleSaveTemplate()` sends `basePriceUsd`, `priceBySizeDefault`, and `defaultCompositeRegionPx` for create and update.

## CUSTOM Mockup Region Editor

`EditorMockupsStep` gets two new props:

```ts
defaultCompositeRegionPx: TemplateDetail["defaultCompositeRegionPx"];
onChangeCompositeRegion: (region: CompositeRegion | null) => void;
```

After the mockup upload grid, CUSTOM templates show a `Tọa độ khung hiển thị design` section if at least one mockup image exists. The section uses the existing `CompositeRegionEditor` and a reference image chosen from the first uploaded/existing template mockup source.

When the admin drags or resizes the frame, the editor updates `defaultCompositeRegionPx` in pending template state. It is persisted only when the user saves the template.

The implementation must either scale the saved region by `imageWidth/imageHeight` when applying it to a mockup with different dimensions, or validate that all template mockup images share the same dimensions before relying on a shared region. Use scaling as the default behavior because the requirement is one region for all colors.

## API Contract

Template create/update routes accept, validate, save, and return the three new fields.

Validation:

- `basePriceUsd`: nullable or a positive finite number; persisted as `Decimal`.
- `priceBySizeDefault`: nullable or a plain object where every key is a non-empty size name and every value is a positive finite number.
- `defaultCompositeRegionPx`: nullable or a valid composite region with positive `width`, `height`, `imageWidth`, and `imageHeight`.

The following paths must include the new fields:

- `POST /api/stores/[id]/mockup-templates`
- `PATCH /api/stores/[id]/mockup-templates/[templateId]`
- `GET /api/stores/[id]/mockup-templates`
- `GET /api/stores/[id]/wizard-config`
- `POST /api/stores/[id]/mockup-templates/[templateId]/duplicate`
- any store/template service helper that creates, updates, serializes, or duplicates templates

The route-level `PATCH /api/stores/[id]/mockup-templates` can stay scoped to the existing default-template placement update unless the implementation still uses it for full template saves. Pricing and default composite region saves belong to the create/update template payloads.

When returning template pricing to client components, serialize Prisma `Decimal` to `number`, matching the existing `Store.defaultPriceUsd` serialization pattern.

## Pricing Resolution

All publish paths use one shared pricing contract:

```ts
draft priceBySizeOverride
  > template priceBySizeDefault
  > template basePriceUsd
  > store defaultPriceUsd
  > 24.99
```

For a specific size, the resolver first checks `WizardDraft.priceBySizeOverride[size]`, then `StoreMockupTemplate.priceBySizeDefault[size]`. If neither exists, it uses the resolved base price.

The resolver must be used by:

- wizard Step 5 initial price state
- wizard Step 5 per-size table defaults
- `src/app/api/wizard/drafts/[id]/publish/route.ts`
- `src/lib/publish/worker.ts` Printify variant payload path
- `src/lib/publish/worker.ts` Shopify variant plan path

Remove all client fetching of `/api/admin/pricing-templates`. The final implementation must include an `rg` check proving no client or publish code still calls that route.

## Composite Region Resolution

The effective CUSTOM composite region priority is:

```ts
WizardDraftMockupLibraryPick.compositeRegionPx
  > CustomMockupSource.compositeRegionPx
  > StoreMockupTemplate.defaultCompositeRegionPx
  > Smart Fit / existing fallback
```

This priority applies to TEMPLATE-scope sources. DRAFT-scope sources continue to prefer their own `CustomMockupSource.compositeRegionPx`, but the shared resolver should still make the precedence explicit.

Extend the existing `resolveEffectiveCompositeRegion()` helper instead of duplicating the logic. All readers that currently merge pick and source regions must pass the template default as a third candidate:

- `GET /api/wizard/drafts/[id]/mockup-sources`
- mockup generation readiness checks
- mockup worker rendering path
- Printify/custom poll worker path if it reads composite region state

When creating `WizardDraftMockupLibraryPick` rows, preserve existing pick overrides first. If a pick has no override and the source has no region, initialize the pick from `template.defaultCompositeRegionPx` so the wizard inherits the template frame but can still override it per draft.

## Admin Pricing Removal

Remove the old Pricing admin surface:

- delete `src/app/(authed)/admin/pricing/page.tsx`
- delete `src/app/api/admin/pricing-templates/route.ts`
- remove the Pricing sidebar entry from `AuthedShell`
- remove the `pricing` ACL feature key from `AclClient`

Keep the `ProductPricingTemplate` Prisma model and table.

## Error Handling

Invalid pricing or composite region payloads return `400` with field-specific error messages.

If template pricing is missing, the wizard and publish paths fall through to store default and then `24.99`; missing template pricing is not a blocker.

If a CUSTOM template default region is missing or invalid at render time, the mockup renderer falls back to Smart Fit with the existing logging pattern instead of failing a draft that previously worked.

If a saved region has source dimensions that differ from the current image, scale `x`, `y`, `width`, and `height` by the current image's width/height ratio and keep `rotationDeg` unchanged.

## Testing

Automated checks:

```bash
npx prisma validate
./node_modules/.bin/tsx --test src/lib/wizard/schema-pair-source.test.ts
./node_modules/.bin/tsx --test src/lib/placement/views.test.ts
./node_modules/.bin/tsx --test src/lib/placement/resolver.test.ts
rg -n "/api/admin/pricing-templates|ProductPricingTemplate.findFirst" src
```

Add or update focused tests for:

- template create/update validation of `basePriceUsd`, `priceBySizeDefault`, and `defaultCompositeRegionPx`
- duplicate template copies all three new fields
- wizard-config and template list return all three new fields with Decimal serialized as number
- pricing resolver priority, including per-size default and draft override
- composite region resolver priority and dimension scaling
- mockup library pick creation inherits template default only when pick and source do not already define a region

Manual checks:

- PRINTIFY template tab order is Blueprint -> Variants -> Placement -> Giá bán.
- CUSTOM template tab order is Blueprint -> Variants -> Mockups -> Giá bán.
- CUSTOM Mockups tab saves and reloads the template default design frame.
- New wizard draft Step 5 pre-populates prices from the template, and manual draft overrides still win.
- CUSTOM mockup wizard inherits the template frame and allows per-draft override.
- Publish uses template pricing for both Printify and Shopify variant payloads.
- Old `/admin/pricing` page 404s, sidebar link is gone, ACL key is gone, and the API route is deleted.
