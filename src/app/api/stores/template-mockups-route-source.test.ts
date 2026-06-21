import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listRoute = readFileSync("src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts", "utf8");
const itemRoute = readFileSync("src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/[itemId]/route.ts", "utf8");

test("template mockup attach routes are CUSTOM-only and tenant scoped", () => {
  assert.match(listRoute, /defaultMockupSource:\s*"CUSTOM"/);
  assert.match(listRoute, /tenantId:\s*session\.tenantId/);
  assert.match(listRoute, /normalizeAppliesToColorIds/);
  assert.match(listRoute, /previewUrl:\s*item\.mockup\.previewPath\s*\?\s*storageUrl\(item\.mockup\.previewPath\)\s*:\s*null/);
});

test("template mockup attach creates duplicate conflict and single primary", () => {
  assert.match(listRoute, /templateMockupItem\.findUnique/);
  assert.match(listRoute, /status:\s*409/);
  assert.match(listRoute, /isPrimary/);
  assert.match(listRoute, /updateMany/);
});

test("template mockup update never edits composite region", () => {
  assert.match(itemRoute, /normalizeAppliesToColorIds/);
  assert.match(itemRoute, /templateMockupItem\.update/);
  assert.doesNotMatch(itemRoute, /compositeRegionPx/);
});

test("template mockup attach rejects cross-store mockup", () => {
  const source = readFileSync("src/app/api/stores/[id]/mockup-templates/[templateId]/mockups/route.ts", "utf8");
  assert.match(source, /mockup\.storeId\s*!==?\s*template\.storeId/);
  assert.match(source, /Mockup does not belong to this store/);
});
