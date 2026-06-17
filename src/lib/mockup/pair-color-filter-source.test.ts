import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("mockup generation persists color filters on mockup jobs", () => {
  const source = readFileSync("src/lib/mockup/generation.ts", "utf8");

  assert.match(source, /resolveColorFilterForDraftDesign/);
  assert.match(source, /colorFilterIds:\s*colorFilter\.colorIds/);
  assert.match(source, /colorGroup:\s*colorFilter\.colorGroup/);
  assert.match(source, /variantIds/);
});

test("printify poll worker reads color filters from mockup job record", () => {
  const source = readFileSync("src/lib/mockup/printify-poll-worker.ts", "utf8");

  assert.match(source, /mockupJob\.findUnique\({[\s\S]*select:\s*{\s*colorFilterIds:\s*true,\s*colorGroup:\s*true\s*}/);
  assert.match(source, /coerceStringArray\(mockupJobFilter\?\.colorFilterIds\)/);
  assert.match(source, /colorFilterIds/);
  assert.doesNotMatch(source, /coerceStringArray\(job\.data\.colorFilterIds\)/);
});
