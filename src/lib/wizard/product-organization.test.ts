import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ORGANIZATION_COLLECTIONS,
  mergeOptimizedTags,
  normalizeOrganizationCollections,
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
