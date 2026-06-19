import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

test("schema defines global mockup library models", () => {
  assert.match(schema, /model MockupLibraryItem \{/);
  assert.match(schema, /tenantId\s+String\s+@map\("tenant_id"\)/);
  assert.match(schema, /uploadedById\s+String\?\s+@map\("uploaded_by_id"\)/);
  assert.match(schema, /mimeType\s+String\s+@map\("mime_type"\)/);
  assert.match(schema, /fileSizeBytes\s+Int\s+@map\("file_size_bytes"\)/);
  assert.match(schema, /compositeRegionPx\s+Json\?\s+@map\("composite_region_px"\)/);
  assert.match(schema, /model TemplateMockupItem \{/);
  assert.match(schema, /appliesToColorIds\s+Json\s+@default\("\[\]"\)\s+@map\("applies_to_color_ids"\)/);
  assert.match(schema, /@@unique\(\[templateId, mockupId\]\)/);
});

test("migration enforces one primary template mockup per template", () => {
  const migration = readFileSync(
    "prisma/migrations/20260618000000_global_mockup_library_clean_break/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE UNIQUE INDEX "template_mockup_items_one_primary_per_template_idx"/);
  assert.match(migration, /WHERE "is_primary" = true/);
});

test("schema rewires wizard picks to template mockup items", () => {
  assert.match(schema, /templateMockupItemId\s+String\s+@map\("template_mockup_item_id"\)/);
  assert.match(
    schema,
    /templateMockupItem\s+TemplateMockupItem\s+@relation\(fields: \[templateMockupItemId\], references: \[id\], onDelete: Restrict\)/,
  );
  assert.match(schema, /@@unique\(\[draftId, templateMockupItemId, colorId\]\)/);
  assert.doesNotMatch(schema, /sourceId\s+String\s+@map\("source_id"\)/);
});

test("schema removes legacy custom mockup source model and template default frame", () => {
  assert.doesNotMatch(schema, /model CustomMockupSource \{/);
  assert.doesNotMatch(schema, /customMockupSources/);
  assert.doesNotMatch(schema, /defaultCompositeRegionPx/);
  assert.doesNotMatch(schema, /enum CustomMockupScope/);
});
