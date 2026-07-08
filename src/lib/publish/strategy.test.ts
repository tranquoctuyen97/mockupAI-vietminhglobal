import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePublishStrategy } from "./strategy";

describe("resolvePublishStrategy", () => {
  it("uses Printify-first for active Printify Shopify sales channels", () => {
    assert.equal(
      resolvePublishStrategy({
        printifyShop: { salesChannel: "shopify", disconnected: false },
      }),
      "PRINTIFY_SHOPIFY_CHANNEL",
    );
  });

  it("normalizes sales channel casing and whitespace", () => {
    assert.equal(
      resolvePublishStrategy({
        printifyShop: { salesChannel: " Shopify ", disconnected: false },
      }),
      "PRINTIFY_SHOPIFY_CHANNEL",
    );
  });

  it("keeps the existing path for disconnected Printify shops", () => {
    assert.equal(
      resolvePublishStrategy({
        printifyShop: { salesChannel: "shopify", disconnected: true },
      }),
      "EXISTING_SHOPIFY_DIRECT",
    );
  });

  it("keeps the existing path for non-Shopify Printify sales channels", () => {
    assert.equal(
      resolvePublishStrategy({
        printifyShop: { salesChannel: "custom", disconnected: false },
      }),
      "EXISTING_SHOPIFY_DIRECT",
    );
  });

  it("keeps the existing path when the store has no Printify shop", () => {
    assert.equal(resolvePublishStrategy({ printifyShop: null }), "EXISTING_SHOPIFY_DIRECT");
  });
});
