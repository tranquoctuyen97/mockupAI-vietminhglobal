import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ShopifyMockupImage } from "./shopify";
import {
  orderMockupImagesByPrimary,
  pickPrimaryColorName,
  resolvePublishVariantIds,
  resolveShopifyMockupMedia,
  validateVariantSkus,
} from "./worker";

describe("resolvePublishVariantIds", () => {
  it("uses listing Printify variant IDs when present", () => {
    assert.deepEqual(
      resolvePublishVariantIds(
        {
          variants: [
            { printifyVariantId: "101" },
            { printifyVariantId: "101" },
            { printifyVariantId: "202" },
            { printifyVariantId: null },
          ],
        },
        { store: { template: { enabledVariantIds: [303] } } },
      ),
      [101, 202],
    );
  });

  it("falls back to template variants, then a defensive default", () => {
    assert.deepEqual(
      resolvePublishVariantIds(
        { variants: [] },
        { store: { template: { enabledVariantIds: [303, 404] } } },
      ),
      [303, 404],
    );
    assert.deepEqual(resolvePublishVariantIds({ variants: [] }, {}), [1]);
  });
});

describe("resolveShopifyMockupMedia", () => {
  const storage = {
    resolvePath: (key: string) => `/uploads/${key}`,
  };

  it("passes remote Printify URLs without resolving them as local files", () => {
    const result = resolveShopifyMockupMedia({
      images: [
        {
          colorName: "Royal Blue",
          compositeUrl: "https://images-api.printify.com/mockup/front.png",
          sourceUrl: "https://images-api.printify.com/mockup/front.png",
        },
      ],
      storage,
      colorNames: ["Royal Blue"],
      requireRealPrintifyMockups: true,
    });

    assert.deepEqual(result.mockupImages, [
      {
        kind: "remote",
        url: "https://images-api.printify.com/mockup/front.png",
        colorName: "Royal Blue",
      },
    ]);
    assert.deepEqual(result.mockupPaths, []);
    assert.deepEqual(result.missingColorNames, []);
  });

  it("rejects synthetic/local media when real Printify mockups are required", () => {
    const result = resolveShopifyMockupMedia({
      images: [
        {
          colorName: "Royal Blue",
          compositeUrl: "mockups/local.png",
          sourceUrl: "mockup://solid/front",
        },
        {
          colorName: "Gold",
          compositeUrl: "https://via.placeholder.com/1200",
          sourceUrl: "https://via.placeholder.com/1200",
        },
      ],
      storage,
      colorNames: ["Royal Blue", "Gold"],
      requireRealPrintifyMockups: true,
    });

    assert.deepEqual(result.mockupImages, []);
    assert.deepEqual(result.missingColorNames, ["Royal Blue", "Gold"]);
  });

  it("uses local cached media when it came from a real Printify source", () => {
    const result = resolveShopifyMockupMedia({
      images: [
        {
          colorName: "Royal Blue",
          compositeUrl: "mockups/printify_front.png",
          sourceUrl: "https://images-api.printify.com/mockup/front.png",
        },
      ],
      storage,
      colorNames: ["Royal Blue"],
      requireRealPrintifyMockups: true,
    });

    assert.deepEqual(result.mockupImages, [
      {
        kind: "local",
        path: "/uploads/mockups/printify_front.png",
        colorName: "Royal Blue",
      },
    ]);
    assert.deepEqual(result.mockupPaths, ["/uploads/mockups/printify_front.png"]);
    assert.deepEqual(result.missingColorNames, []);
  });

  it("keeps local storage media for non-strict development fallback", () => {
    const result = resolveShopifyMockupMedia({
      images: [
        {
          colorName: "Royal Blue",
          compositeUrl: "mockups/local.png",
          sourceUrl: "mockup://solid/front",
        },
      ],
      storage,
      colorNames: ["Royal Blue"],
      requireRealPrintifyMockups: false,
    });

    assert.deepEqual(result.mockupImages, [
      {
        kind: "local",
        path: "/uploads/mockups/local.png",
        colorName: "Royal Blue",
      },
    ]);
    assert.deepEqual(result.mockupPaths, ["/uploads/mockups/local.png"]);
  });
});

describe("pickPrimaryColorName", () => {
  const img = (colorName?: string): ShopifyMockupImage => ({
    kind: "remote",
    url: "https://images-api.printify.com/m.png",
    colorName,
  });

  it("returns null when no mockup carries a color name", () => {
    assert.equal(pickPrimaryColorName([img(), img("")]), null);
  });

  it("picks a color present in the mockups using the provided rng", () => {
    const images = [img("Black"), img("Black"), img("White"), img("Navy")];
    // unique colors: [Black, White, Navy]; rng 0.5 → index 1 → White
    assert.equal(
      pickPrimaryColorName(images, () => 0.5),
      "White",
    );
    assert.equal(
      pickPrimaryColorName(images, () => 0),
      "Black",
    );
  });
});

describe("orderMockupImagesByPrimary", () => {
  const img = (colorName: string, url: string): ShopifyMockupImage => ({
    kind: "remote",
    url,
    colorName,
  });

  it("moves the primary color group first, keeping original order otherwise", () => {
    const images = [img("Black", "b1"), img("White", "w1"), img("Navy", "n1"), img("White", "w2")];
    const ordered = orderMockupImagesByPrimary(images, ["Black", "White", "Navy"], "White");
    assert.deepEqual(
      ordered.map((m) => (m.kind === "remote" ? m.url : "")),
      ["w1", "w2", "b1", "n1"],
    );
  });

  it("returns the input unchanged when there is no primary color", () => {
    const images = [img("Black", "b1"), img("White", "w1")];
    assert.deepEqual(orderMockupImagesByPrimary(images, ["Black", "White"], null), images);
  });
});

describe("validateVariantSkus", () => {
  it("passes when every variant has a unique SKU", () => {
    assert.doesNotThrow(() =>
      validateVariantSkus([
        { colorName: "Black", size: "S", sku: "SKU-1", priceUsd: 20, colorHex: null },
        { colorName: "Black", size: "M", sku: "SKU-2", priceUsd: 20, colorHex: null },
      ]),
    );
  });

  it("throws on duplicate SKUs", () => {
    assert.throws(
      () =>
        validateVariantSkus([
          { colorName: "Black", size: "S", sku: "DUP", priceUsd: 20, colorHex: null },
          { colorName: "White", size: "S", sku: "DUP", priceUsd: 20, colorHex: null },
        ]),
      /Duplicate SKU/,
    );
  });

  it("throws when SKUs are present on some but missing on others", () => {
    assert.throws(
      () =>
        validateVariantSkus([
          { colorName: "Black", size: "S", sku: "SKU-1", priceUsd: 20, colorHex: null },
          { colorName: "White", size: "S", sku: null, priceUsd: 20, colorHex: null },
        ]),
      /Missing SKU/,
    );
  });

  it("allows a catalog where no variant has a SKU", () => {
    assert.doesNotThrow(() =>
      validateVariantSkus([
        { colorName: "Black", size: "S", sku: null, priceUsd: 20, colorHex: null },
        { colorName: "White", size: "S", sku: "", priceUsd: 20, colorHex: null },
      ]),
    );
  });
});
