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
    assert.doesNotMatch(
      source,
      /const orderedSizes = uniqueInOrder\(input\.printifyRows\.map\(\(row\) => row\.size\)\);/,
    );
  });

  it("emits phase changes at the actual post-sync step boundaries", () => {
    const repairingIndex = source.indexOf('onPhaseChange?.("REPAIRING_OPTIONS")');
    const repairCallIndex = source.indexOf("await repairShopifyOptionSemantics(", repairingIndex);
    const mediaIndex = source.indexOf('onPhaseChange?.("SYNCING_MEDIA")', repairCallIndex);
    const mediaCallIndex = source.indexOf("await syncShopifyVariantMedia(", mediaIndex);
    const galleryIndex = source.indexOf('onPhaseChange?.("REORDERING_GALLERY")', mediaCallIndex);
    const galleryCallIndex = source.indexOf("await reorderShopifyMediaGallery(", galleryIndex);
    const verifyingIndex = source.indexOf('onPhaseChange?.("VERIFYING")', galleryCallIndex);
    const verifyCallIndex = source.indexOf("assertShopifyMediaGallery(", verifyingIndex);

    assert.ok(repairingIndex > -1, "should mark option repair before option repair starts");
    assert.ok(repairCallIndex > repairingIndex, "option repair should run after REPAIRING_OPTIONS");
    assert.ok(mediaIndex > repairCallIndex, "media phase should start after option repair");
    assert.ok(mediaCallIndex > mediaIndex, "media sync should run after SYNCING_MEDIA");
    assert.ok(galleryIndex > mediaCallIndex, "gallery phase should start after media sync");
    assert.ok(
      galleryCallIndex > galleryIndex,
      "gallery reorder should run after REORDERING_GALLERY",
    );
    assert.ok(verifyingIndex > galleryCallIndex, "verify phase should start after gallery reorder");
    assert.ok(
      verifyCallIndex > verifyingIndex,
      "final gallery assertion should run after VERIFYING",
    );
  });
});
