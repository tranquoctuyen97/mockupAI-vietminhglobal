import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("template pricing edits mark template editor dirty", () => {
  const source = readFileSync("src/app/(authed)/stores/[id]/config/page.tsx", "utf8");
  const isDirtyBlock = source.match(/const isDirty = useMemo\(\(\) => \{[\s\S]*?return false;\n  \}, \[tempTemplateData, originalTemplate\]\);/);

  assert.ok(isDirtyBlock, "expected TemplatesSection isDirty useMemo block");
  assert.match(isDirtyBlock[0], /basePriceUsd/);
  assert.match(isDirtyBlock[0], /priceBySizeDefault/);
  assert.match(source, /basePriceUsd:\s*tempTemplateData\.basePriceUsd/);
  assert.match(source, /priceBySizeDefault:\s*tempTemplateData\.priceBySizeDefault/);
});
