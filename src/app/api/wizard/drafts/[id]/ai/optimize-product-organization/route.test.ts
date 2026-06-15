import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("optimize product organization route source", () => {
  it("validates session and draft ownership", () => {
    assert.match(source, /validateSession/);
    assert.match(source, /tenantId:\s*session\.tenantId/);
    assert.match(source, /include:\s*\{/);
  });

  it("does not mutate the draft or trust client storeId", () => {
    assert.doesNotMatch(source, /wizardDraft\.update/);
    assert.doesNotMatch(source, /storeId:\s*body\.storeId/);
    assert.match(source, /draft\.store/);
  });

  it("calls the organization optimizer, not listing generate", () => {
    assert.match(source, /optimizeProductOrganization/);
    assert.doesNotMatch(source, /\.generate\(/);
  });
});
