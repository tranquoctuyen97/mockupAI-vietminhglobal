import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePublishVariantIds, resolveShopifyMockupMedia } from "./worker";

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
