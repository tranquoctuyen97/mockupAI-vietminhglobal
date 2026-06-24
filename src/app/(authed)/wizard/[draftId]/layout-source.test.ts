import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layoutSource = readFileSync("src/app/(authed)/wizard/[draftId]/layout.tsx", "utf8");
const step2Source = readFileSync("src/app/(authed)/wizard/[draftId]/step-2/page.tsx", "utf8");

test("wizard layout allows unmatched suffix designs to continue independently", () => {
  assert.doesNotMatch(layoutSource, /pairing\.unpaired/);
  assert.doesNotMatch(layoutSource, /hasUnpairedDraftDesigns/);
  assert.doesNotMatch(layoutSource, /selectedDesignCount\s*!==\s*pairCount\s*\*\s*2/);
});

test("step 2 counts unmatched suffix designs as independent without warnings", () => {
  assert.match(
    step2Source,
    /Design sáng\/tối chỉ ghép cặp khi chọn đủ hai bản\. Design còn lại sẽ publish riêng\./,
  );
  assert.match(step2Source, /pairing\.independent\.length\s*\+\s*pairing\.unpaired\.length/);
  assert.doesNotMatch(step2Source, /Thiếu design để ghép cặp/);
  assert.doesNotMatch(step2Source, /thiếu bản sáng\/tối còn lại/);
});
