import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("design-pairs route returns persisted pairs only", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/wizard/drafts/[id]/design-pairs/route.ts"),
    "utf8",
  );

  assert.match(source, /wizardDraftDesignPair\.findMany/);
  assert.match(source, /where:\s*{\s*draftId\s*}/);
  assert.match(source, /orderBy:\s*{\s*sortOrder:\s*"asc"\s*}/);
  assert.doesNotMatch(source, /pairDesigns|buildPairRowsFromDraftDesigns/);
});
