import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

test("schema has first-class wizard design pairs", () => {
  assert.match(schema, /model WizardDraftDesignPair \{/);
  assert.match(schema, /lightDraftDesignId\s+String\s+@map\("light_draft_design_id"\)/);
  assert.match(schema, /darkDraftDesignId\s+String\s+@map\("dark_draft_design_id"\)/);
  assert.match(schema, /aiContent\s+Json\?\s+@map\("ai_content"\)/);
  assert.match(schema, /listing\s+Listing\?/);
  assert.match(schema, /@@unique\(\[draftId, baseName\]\)/);
});

test("schema links designs to stores and listings to pairs", () => {
  assert.match(schema, /storeId\s+String\?\s+@map\("store_id"\)/);
  assert.match(schema, /designs\s+Design\[\]/);
  assert.match(schema, /colorGroup\s+String\s+@default\("auto"\)\s+@map\("color_group"\)/);
  assert.match(
    schema,
    /wizardDraftDesignPairId\s+String\?\s+@unique\s+@map\("wizard_draft_design_pair_id"\)/,
  );
});

test("schema persists mockup job color filters for retry and audit", () => {
  assert.match(schema, /colorFilterIds\s+Json\?\s+@map\("color_filter_ids"\)/);
  assert.match(schema, /colorGroup\s+String\?\s+@map\("color_group"\)/);
});
