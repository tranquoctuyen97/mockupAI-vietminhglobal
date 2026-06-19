import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/wizard/drafts/[id]/publish/route.ts", "utf8");

test("publish route creates one listing per design pair", () => {
  assert.match(source, /designPairs/);
  assert.match(source, /wizardDraftDesignPairId/);
  assert.match(source, /findUnique\(\{\s*where:\s*\{\s*wizardDraftDesignPairId/s);
  assert.match(source, /pair\.aiContent/);
  assert.doesNotMatch(source, /for \(const draftDesign of selectedDraftDesigns\)/);
});
