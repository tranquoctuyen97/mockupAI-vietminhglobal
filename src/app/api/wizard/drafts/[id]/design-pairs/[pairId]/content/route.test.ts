import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("pair content route saves aiContent on WizardDraftDesignPair", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/wizard/drafts/[id]/design-pairs/[pairId]/content/route.ts"),
    "utf8",
  );

  assert.match(source, /wizardDraftDesignPair\.findFirst/);
  assert.match(source, /draft:\s*{\s*tenantId:\s*session\.tenantId\s*}/);
  assert.match(source, /wizardDraftDesignPair\.update/);
  assert.match(source, /data:\s*{\s*aiContent\s*}/);
});

test("generate content route supports batch pair content with concurrency", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/wizard/drafts/[id]/generate-content/route.ts"),
    "utf8",
  );

  assert.match(source, /designPairs:\s*{/);
  assert.match(source, /runWithConcurrency\(targetPairs,\s*3/);
  assert.match(source, /wizardDraftDesignPair\.update/);
  assert.match(source, /data:\s*{\s*aiContent\s*}/);
});
