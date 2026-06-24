import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ORGANIZATION_COLLECTIONS,
  MAX_TAGS,
  mergeOptimizedTags,
  normalizeOrganizationCollections,
  normalizeTags,
} from "./product-organization";

describe("mergeOptimizedTags", () => {
  it("puts optimized tags before current tags and deduplicates case-insensitively", () => {
    assert.deepEqual(
      mergeOptimizedTags(
        [" Patriotic ", "T-Shirt", "", "summer", "mockupai"],
        ["patriotic", "Gift", "Summer", "draft-preview"],
      ),
      ["Patriotic", "T-Shirt", "summer", "Gift"],
    );
  });

  it("caps merged tags at 15", () => {
    const ai = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    assert.equal(mergeOptimizedTags(ai, ["current"]).length, 15);
  });
});

describe("normalizeOrganizationCollections", () => {
  it("trims, drops blanks, deduplicates case-insensitively, and preserves first casing", () => {
    assert.deepEqual(
      normalizeOrganizationCollections([" T-Shirts ", "t-shirts", "", " Patriotic ", null]),
      ["T-Shirts", "Patriotic"],
    );
  });

  it("returns an empty list for nullish and non-array input", () => {
    assert.deepEqual(normalizeOrganizationCollections(null), []);
    assert.deepEqual(normalizeOrganizationCollections(undefined), []);
    assert.deepEqual(normalizeOrganizationCollections("T-Shirts"), []);
  });

  it("caps collections at the default maximum", () => {
    const values = Array.from({ length: 15 }, (_, i) => `Collection ${i}`);
    assert.equal(normalizeOrganizationCollections(values).length, MAX_ORGANIZATION_COLLECTIONS);
    assert.equal(MAX_ORGANIZATION_COLLECTIONS, 10);
  });
});

describe("normalizeTags", () => {
  it("trims, dedupes, filters internal tags, and caps output", () => {
    const input = [
      "  Shirt  ",
      "shirt",
      "",
      "mockupai",
      "draft-preview",
      "Gift",
      null,
      undefined,
      ...Array.from({ length: MAX_TAGS + 5 }, (_, index) => `Tag ${index}`),
    ];

    const result = normalizeTags(input);

    assert.equal(result[0], "Shirt");
    assert.equal(result[1], "Gift");
    assert.equal(result.includes("mockupai"), false);
    assert.equal(result.includes("draft-preview"), false);
    assert.equal(result.length, MAX_TAGS);
  });

  it("returns an empty list for non-array values", () => {
    assert.deepEqual(normalizeTags(undefined), []);
    assert.deepEqual(normalizeTags("shirt"), []);
  });
});
