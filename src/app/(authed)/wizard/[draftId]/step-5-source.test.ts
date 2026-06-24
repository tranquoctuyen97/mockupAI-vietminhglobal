import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/(authed)/wizard/[draftId]/step-5/page.tsx", "utf8");

test("step 5 formats mixed listing and content labels", () => {
  assert.match(source, /formatListingSummaryLabel/);
  assert.match(source, /formatContentChecklistLabel/);
  assert.doesNotMatch(source, /designPairs\.length ×/);
  assert.doesNotMatch(source, /pairingComplete/);
  assert.doesNotMatch(source, /Tất cả design đã ghép cặp sáng\/tối/);
});

test("step 5 resolves active independent content from draftDesign aiContent", () => {
  assert.match(source, /activeIndependentDesign/);
  assert.match(source, /activeIndependentDesign\?\.aiContent/);
  assert.doesNotMatch(source, /designPairs\[0\]/);
});
