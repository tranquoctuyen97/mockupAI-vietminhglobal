import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProductTags, normalizeProductType } from "./shopify";

describe("normalizeProductType", () => {
  it("maps Printify blueprint titles to canonical apparel types", () => {
    assert.equal(normalizeProductType("Unisex Heavy Cotton Tee"), "T-Shirt");
    assert.equal(normalizeProductType("Unisex College Hoodie"), "Hoodie");
    assert.equal(normalizeProductType("Unisex Crewneck Sweatshirt"), "Sweatshirt");
    assert.equal(normalizeProductType("Unisex Tank Top"), "Tank Top");
    assert.equal(normalizeProductType("Long Sleeve Shirt"), "Long Sleeve Shirt");
  });

  it("returns null for unrecognized types", () => {
    assert.equal(normalizeProductType("Ceramic Mug"), null);
    assert.equal(normalizeProductType(""), null);
  });
});

describe("buildProductTags", () => {
  it("merges Printify-like defaults with AI tags, de-duplicated case-insensitively", () => {
    assert.deepEqual(buildProductTags("T-Shirt", ["summer", "t-shirt", "Sale"]), [
      "T-Shirt",
      "Printify",
      "summer",
      "Sale",
    ]);
  });

  it("returns only AI tags when the type is unrecognized", () => {
    assert.deepEqual(buildProductTags(null, ["custom"]), ["custom"]);
  });
});
