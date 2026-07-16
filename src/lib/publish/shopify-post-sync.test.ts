import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Shopify post-sync repair source contract", () => {
  const source = readFileSync(new URL("./shopify-post-sync.ts", import.meta.url), "utf8");

  it("infers option semantics from SKU-selected options instead of labels", () => {
    assert.match(source, /inferSemanticOptions/);
    assert.match(source, /expectedBySku/);
    assert.match(source, /selectedOptions\.find/);
    assert.match(source, /sameValue\(selected\.value,\s*expected\.colorName\)/);
    assert.match(source, /sameValue\(selected\.value,\s*expected\.size\)/);
  });

  it("renames swapped Color and Size options through a temporary option name", () => {
    assert.match(source, /TEMP_SIZE_OPTION_NAME/);
    assert.match(source, /productOptionUpdate/);
    assert.match(source, /name:\s*"Color"/);
    assert.match(source, /name:\s*"Size"/);
  });

  it("reorders Color first and attaches media by variant color", () => {
    assert.match(source, /productOptionsReorder/);
    assert.match(source, /ProductVariantsBulkInput/);
    assert.match(source, /productVariantsBulkUpdate/);
    assert.match(source, /reorderPrimaryMedia/);
    assert.match(source, /productReorderMedia/);
  });

  it("verifies option semantics and variant media after repair", () => {
    assert.match(source, /assertShopifyOptions/);
    assert.match(source, /assertShopifyVariantMedia/);
    assert.match(source, /assertShopifyMediaGallery/);
    assert.match(source, /Shopify option 1 must be Color/);
    assert.match(source, /has no media/);
  });

  it("does not derive Size order directly from Printify row order", () => {
    assert.match(source, /sizesInOrder/);
    assert.match(source, /APPAREL_SIZE_ORDER/);
    assert.doesNotMatch(source, /const orderedSizes = uniqueInOrder\(input\.printifyRows\.map\(\(row\) => row\.size\)\);/);
  });
});
