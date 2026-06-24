import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/wizard/drafts/[id]/generate-content/route.ts", "utf8");

test("generate content derives independent draft designs alongside pairs", () => {
  assert.match(source, /getIndependentDraftDesigns/);
  assert.match(source, /requestedDesignId/);
  assert.match(source, /draft\.designPairs/);
  assert.match(source, /independentDraftDesigns/);
});

test("generate content saves independent aiContent to wizardDraftDesign", () => {
  assert.match(source, /wizardDraftDesign\.update/);
  assert.match(source, /where:\s*\{\s*id:\s*draftDesign\.id\s*\}/s);
  assert.match(source, /data:\s*\{\s*aiContent\s*\}/s);
});

test("generate content returns both pair and design result arrays", () => {
  assert.match(source, /pairs:\s*pairResults/);
  assert.match(source, /designs:\s*designResults/);
});
