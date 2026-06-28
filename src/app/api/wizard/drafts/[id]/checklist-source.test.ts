import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/wizard/drafts/[id]/checklist.ts", "utf8");

test("checklist derives independent draft designs from pairs", () => {
  assert.match(source, /getIndependentDraftDesigns/);
  assert.match(source, /independentDraftDesigns/);
});

test("checklist content requires pair and independent titles", () => {
  assert.match(source, /pairsContentComplete/);
  assert.match(source, /independentContentComplete/);
  assert.match(source, /hasAiTitle\(pair\.aiContent\)/);
  assert.match(source, /hasAiTitle\(draftDesign\.aiContent\)/);
});

test("checklist does not expose pairing completeness", () => {
  assert.doesNotMatch(source, /hasUnpairedDraftDesigns/);
  assert.doesNotMatch(source, /pairingComplete/);
});
