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

test("template default tags are editable, saved, and mark editor dirty", () => {
  const source = readFileSync("src/app/(authed)/stores/[id]/config/page.tsx", "utf8");
  const isDirtyBlock = source.match(/const isDirty = useMemo\(\(\) => \{[\s\S]*?return false;\n  \}, \[tempTemplateData, originalTemplate\]\);/);

  assert.ok(isDirtyBlock, "expected TemplatesSection isDirty useMemo block");
  assert.match(source, /defaultTags:\s*\[\]/);
  assert.match(source, /defaultTags:\s*tempTemplateData\.defaultTags/);
  assert.match(isDirtyBlock[0], /defaultTags/);
  assert.match(source, /function TemplateDefaultTagsField/);
  assert.match(source, /<TemplateDefaultTagsField[\s\S]*value=\{value\.defaultTags/);
});

test("template default collections are editable, saved, and mark editor dirty", () => {
  const source = readFileSync("src/app/(authed)/stores/[id]/config/page.tsx", "utf8");
  const isDirtyBlock = source.match(/const isDirty = useMemo\(\(\) => \{[\s\S]*?return false;\n  \}, \[tempTemplateData, originalTemplate\]\);/);

  assert.ok(isDirtyBlock, "expected TemplatesSection isDirty useMemo block");
  assert.match(source, /defaultCollections:\s*\[\]/);
  assert.match(source, /defaultCollections:\s*tempTemplateData\.defaultCollections/);
  assert.match(isDirtyBlock[0], /defaultCollections/);
  assert.match(source, /function TemplateDefaultCollectionsField/);
  assert.match(source, /<TemplateDefaultCollectionsField[\s\S]*value=\{value\.defaultCollections/);
  assert.match(source, /MAX_ORGANIZATION_COLLECTIONS/);
});
