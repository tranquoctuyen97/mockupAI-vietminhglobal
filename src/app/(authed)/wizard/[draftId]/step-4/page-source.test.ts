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

  it("seeds template default tags only when active content has no tags", () => {
    assert.match(source, /templateDefaultTags/);
    assert.match(source, /existingTags\.length\s*>\s*0\s*\?\s*existingTags\s*:\s*templateDefaultTags/);
    assert.match(source, /normalizeTags\(draft\?\.template\?\.defaultTags/);
  });

  it("does not merge template default tags inside AI generation", () => {
    const generateHandler = source.match(/async function handleGenerateAI\(\)[\s\S]*?^\s*}\n\n  \/\/ ── Manual save/m)?.[0] ?? "";
    assert.ok(generateHandler, "expected handleGenerateAI block");
    assert.doesNotMatch(generateHandler, /templateDefaultTags/);
    assert.doesNotMatch(generateHandler, /defaultTags/);
  });

  it("seeds template default collections only when active content has no collections", () => {
    assert.match(source, /templateDefaultCollections/);
    assert.match(source, /existingCollections\.length\s*>\s*0\s*\?\s*existingCollections\s*:\s*templateDefaultCollections/);
    assert.match(source, /normalizeOrganizationCollections\(draft\?\.template\?\.defaultCollections/);
  });

  it("does not merge template default collections inside AI generation", () => {
    const generateHandler = source.match(/async function handleGenerateAI\(\)[\s\S]*?^\s*}\n\n  \/\/ ── Manual save/m)?.[0] ?? "";
    assert.ok(generateHandler, "expected handleGenerateAI block");
    assert.doesNotMatch(generateHandler, /templateDefaultCollections/);
    assert.doesNotMatch(generateHandler, /defaultCollections/);
  });

  it("builds Step 4 tabs from both pairs and independent draft designs", () => {
    assert.match(source, /getIndependentDraftDesigns/);
    assert.match(source, /kind:\s*"pair"/);
    assert.match(source, /kind:\s*"independent"/);
    assert.match(source, /draftDesign\.aiContent/);
  });

  it("saves independent content through the draft design content endpoint", () => {
    assert.match(source, /\/api\/wizard\/drafts\/\$\{draftId\}\/designs\/\$\{activeTab\.id\}\/content/);
    assert.match(source, /method:\s*"PATCH"/);
  });

  it("reads generated independent content from the designs response array", () => {
    assert.match(source, /data\.designs/);
    assert.match(source, /activeTab\.kind\s*===\s*"independent"/);
  });

  it("registers dynamic save handler to Zustand store for layout auto-save", () => {
    assert.match(source, /setStep4SaveHandler/);
    assert.match(source, /saveCurrentTab\s*=\s*async/);
    assert.match(source, /isDirty/);
    assert.match(source, /handleTabChange/);
  });
});
