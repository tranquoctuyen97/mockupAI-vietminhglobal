import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync("src/app/api/designs/route.ts", "utf8");
const page = readFileSync("src/app/(authed)/designs/page.tsx", "utf8");
const analytics = readFileSync("src/lib/analytics/queries.ts", "utf8");
const state = readFileSync("src/lib/wizard/state.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

test("temporary MCP designs are excluded from reusable library surfaces", () => {
  assert.match(api, /scope:\s*"LIBRARY"/);
  assert.match(page, /scope:\s*"LIBRARY"/);
  assert.match(analytics, /scope:\s*"LIBRARY"/);
});

test("wizard accepts a temporary design only when already attached to the same draft", () => {
  assert.match(state, /scope:\s*"TEMPORARY_MCP"/);
  assert.match(state, /draftDesigns:\s*\{\s*some:\s*\{\s*draftId:\s*id/);
});

test("schema keeps temporary designs compatible with WizardDraftDesign", () => {
  assert.match(schema, /enum DesignScope \{\s+LIBRARY\s+TEMPORARY_MCP\s+\}/);
  assert.match(schema, /scope\s+DesignScope\s+@default\(LIBRARY\)/);
  assert.match(schema, /model WizardDraftMockupSource \{/);
  assert.match(schema, /mockupLibraryItemId\s+String\?\s+@map\("mockup_library_item_id"\)/);
});
