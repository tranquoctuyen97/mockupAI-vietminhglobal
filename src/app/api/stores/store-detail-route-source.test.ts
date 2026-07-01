import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("store detail route serializes template base prices for client rendering", () => {
  const source = readFileSync("src/app/api/stores/[id]/route.ts", "utf8");
  const enrichedTemplatesBlock = source.match(/const enrichedTemplates = store\.templates\.map\(\(t\) => \(\{[\s\S]*?\n  \}\)\);/);

  assert.ok(enrichedTemplatesBlock, "expected enrichedTemplates serialization block");
  assert.match(enrichedTemplatesBlock[0], /basePriceUsd:\s*t\.basePriceUsd\s*\?\s*Number\(t\.basePriceUsd\)\s*:\s*null/);
});
