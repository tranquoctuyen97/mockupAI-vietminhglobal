import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/wizard/drafts/[id]/publish/route.ts", "utf8");

test("publish route creates listings for both design pairs and independent draft designs", () => {
  assert.match(source, /getIndependentDraftDesigns/);
  assert.match(source, /for \(const pair of draft\.designPairs\)/);
  assert.match(source, /for \(const draftDesign of independentDraftDesigns\)/);
  assert.match(source, /wizardDraftDesignPairId/);
  assert.match(source, /wizardDraftDesignId/);
});

test("publish route does not require selected design count to equal pairs times two", () => {
  assert.doesNotMatch(source, /selectedDraftDesigns\.length\s*!==\s*draft\.designPairs\.length\s*\*\s*2/);
  assert.doesNotMatch(source, /hasUnpairedDraftDesigns/);
});

test("publish route retries existing failed listings instead of treating them as done", () => {
  assert.match(source, /\["FAILED", "PARTIAL_FAILURE"\]\.includes\(existingListing\.status\)/);
  assert.match(source, /if \(retryExisting\) workersToStart\.push\(\{ listingId: existingListing\.id \}\)/);
  assert.match(source, /alreadyPublished:\s*!retryExisting/);
});
