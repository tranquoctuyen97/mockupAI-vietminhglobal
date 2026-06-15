import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("Step 4 product organization UI source", () => {
  it("shows optimize only in the real manual-edit state", () => {
    assert.match(source, /manual-edit/);
    assert.match(source, /Tối ưu tags & collections/);
    assert.match(source, /state\s*===\s*"manual-edit"/);
  });

  it("calls the optimize route separately from generate content", () => {
    assert.match(source, /optimize-product-organization/);
    assert.match(source, /generate-content/);
    assert.match(source, /async function handleGenerateAI\(\)[\s\S]*generate-content/);
    assert.match(
      source,
      /async function handleOptimizeOrganization\(\)[\s\S]*optimize-product-organization/,
    );
    const beforeOptimizeHandler = source.split("async function handleOptimizeOrganization")[0] ?? source;
    assert.doesNotMatch(beforeOptimizeHandler, /optimize-product-organization/);
  });

  it("keeps manual edits pending without debounce until Save or Next", () => {
    assert.match(source, /debounce:\s*false/);
    assert.match(source, /handleSaveManual/);
    assert.match(source, /collections/);
  });
});
