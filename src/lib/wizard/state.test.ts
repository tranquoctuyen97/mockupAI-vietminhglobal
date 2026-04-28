import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
