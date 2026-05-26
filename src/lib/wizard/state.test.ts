import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { sanitizeDraftPatch } from "./state";

test("sanitizeDraftPatch drops removed wizard fields and keeps persisted fields", () => {
  const sanitized = sanitizeDraftPatch({
    storeId: "store_1",
    designId: "design_1",
    blueprintId: null,
    printProviderId: null,
    selectedColors: [],
    enabledColorIds: ["color_1"],
    placementOverride: { version: "2.1" },
    currentStep: 2,
  });

  assert.deepEqual(sanitized, {
    storeId: "store_1",
    designId: "design_1",
    enabledColorIds: ["color_1"],
    placementOverride: { version: "2.1" },
    currentStep: 2,
  });
});

test("latest stale trigger migration tracks current wizard draft columns", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/0018_wizard_draft_stale_trigger_alignment/migration.sql",
    ),
    "utf8",
  );

  assert.match(migration, /enabled_color_ids/);
  assert.match(migration, /enabled_variant_ids_override/);
  assert.match(migration, /placement_override/);
  assert.doesNotMatch(migration, /selected_colors/);
  assert.doesNotMatch(migration, /OLD\.placement\b|NEW\.placement\b/);
  assert.ok(
    migration.indexOf("DROP TRIGGER IF EXISTS trg_wizard_drafts_stale") <
      migration.indexOf("UPDATE wizard_drafts"),
  );
});

test("getDraft includes mockup job images for review step", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/wizard/state.ts"),
    "utf8",
  );

  assert.match(source, /mockupJobs:\s*{/);
  assert.match(source, /include:\s*{\s*images:\s*{/);
  assert.match(source, /images:\s*{\s*orderBy:\s*{\s*sortOrder:\s*"asc"/);
});

test("wizard draft state accepts templateId patches", () => {
  const sanitized = sanitizeDraftPatch({
    templateId: "template_1",
    enabledSizes: ["S", "M"],
    unknownTemplateField: "drop",
  });

  assert.deepEqual(sanitized, {
    templateId: "template_1",
    enabledSizes: ["S", "M"],
  });
});

test("wizard draft state accepts designIds patches", () => {
  const sanitized = sanitizeDraftPatch({
    designIds: ["design_1", "design_2"],
    unknownDesignField: "drop",
  });

  assert.deepEqual(sanitized, {
    designIds: ["design_1", "design_2"],
  });
});

test("getDraft and updateDraft include ordered draftDesigns with design and job images", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/wizard/state.ts"),
    "utf8",
  );

  assert.match(source, /const draftDesignsWithRelationsInclude = {\s*orderBy:\s*{\s*sortOrder:\s*"asc"/);
  assert.match(source, /draftDesignsWithRelationsInclude[\s\S]*where:\s*{\s*design:\s*{\s*status:\s*"ACTIVE"/);
  assert.match(source, /draftDesignsWithRelationsInclude[\s\S]*include:\s*{[\s\S]*design:\s*true/);
  assert.match(source, /draftDesignsWithRelationsInclude[\s\S]*jobs:\s*{[\s\S]*include:\s*{[\s\S]*images:\s*{[\s\S]*orderBy:\s*{\s*sortOrder:\s*"asc"/);
  assert.equal(
    source.match(/draftDesigns:\s*draftDesignsWithRelationsInclude/g)?.length,
    2,
  );
  assert.match(source, /findUniqueOrThrow\(\{[\s\S]*include:\s*{\s*draftDesigns:\s*draftDesignsWithRelationsInclude/);
});

test("updateDraft normalizes legacy designId patches before validation and child sync", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/wizard/state.ts"),
    "utf8",
  );

  assert.match(source, /designId:\s*sanitizedDesignId/);
  assert.match(source, /sanitizedDesignId\s*!==\s*undefined[\s\S]*normalizeDesignIds\(sanitizedDesignId\s*===\s*null\s*\?\s*\[\]\s*:\s*\[sanitizedDesignId\]\)/);
  assert.match(source, /id:\s*{\s*in:\s*nextDesignIds\s*}[\s\S]*tenantId[\s\S]*status:\s*"ACTIVE"[\s\S]*deletedAt:\s*null/);
  assert.match(source, /if \(nextDesignIds !== undefined\)[\s\S]*wizardDraftDesign\.deleteMany[\s\S]*wizardDraftDesign\.upsert/);
});

test("updateDraft marks mockups stale when template changes", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/wizard/state.ts"),
    "utf8",
  );

  assert.match(source, /templateChanged/);
  assert.match(source, /mockupsStale:\s*true/);
  assert.match(source, /mockupsStaleReason:\s*"template_changed"/);
});

test("step 1 resets templateId when store changes", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/(authed)/wizard/[draftId]/step-1/page.tsx"),
    "utf8",
  );

  assert.match(source, /templateId:\s*null/);
});

test("multi-design wizard migration backfills child design rows and removes single-listing uniqueness", () => {
  const migrations = readdirSync(join(process.cwd(), "prisma/migrations"))
    .filter((name) => name.includes("multi_design_wizard") || name.includes("add_multi_design_wizard"))
    .sort();

  assert.ok(migrations.length > 0, "expected add_multi_design_wizard migration");

  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations", migrations[migrations.length - 1], "migration.sql"),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE\s+"wizard_draft_designs"/);
  assert.match(migration, /INSERT INTO\s+"wizard_draft_designs"/);
  assert.match(migration, /FROM\s+"wizard_drafts"/);
  assert.match(migration, /ALTER TABLE\s+"mockup_jobs"\s+ADD COLUMN\s+"wizard_draft_design_id"/);
  assert.match(migration, /ALTER TABLE\s+"mockup_jobs"\s+ADD COLUMN\s+"design_id"/);
  assert.match(migration, /UPDATE\s+"mockup_jobs"[\s\S]*"design_id"\s*=\s*wdd\."design_id"/);
  assert.match(migration, /ALTER TABLE\s+"listings"\s+ADD COLUMN\s+"wizard_draft_design_id"/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS\s+"listings_wizard_draft_id_key"/);
  assert.match(migration, /CREATE UNIQUE INDEX\s+"listings_wizard_draft_design_id_key"/);
  assert.match(migration, /UPDATE\s+"listings"[\s\S]*SET\s+"wizard_draft_id"\s*=\s*NULL/);
  assert.doesNotMatch(migration, /NOT VALID\b/);
});
