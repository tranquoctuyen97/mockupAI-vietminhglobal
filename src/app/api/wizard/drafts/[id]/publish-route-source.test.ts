import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./publish/route.ts", import.meta.url), "utf8");

describe("wizard publish listing organization snapshot source", () => {
  it("reads aiContent collections and snapshots them to Listing", () => {
    assert.match(source, /collections\?:\s*string\[\]/);
    assert.match(source, /organizationCollections/);
    assert.match(source, /normalizeOrganizationCollections/);
  });

  it("resolves publish base price from template pricing defaults", () => {
    assert.match(source, /resolveBaseTemplatePrice/);
    assert.match(source, /templateBasePriceUsd:\s*template\?\.basePriceUsd/);
    assert.doesNotMatch(source, /productPricingTemplate\.findFirst/);
  });

  it("validates mixed unit content directly on pairs and draft designs", () => {
    assert.match(source, /hasAiTitle\(pair\.aiContent\)/);
    assert.match(source, /hasAiTitle\(draftDesign\.aiContent\)/);
    assert.doesNotMatch(source, /if \(!aiContent\?\.title\)/);
  });
});
