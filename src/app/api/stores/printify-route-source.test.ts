import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/stores/[id]/printify/route.ts", "utf8");

test("store Printify route updates post-sync unpublish setting with Shopify-channel guard", () => {
  assert.match(source, /unpublishAfterShopifySync/);
  assert.match(source, /salesChannel\?\.trim\(\)\.toLowerCase\(\)\s*===\s*"shopify"/);
  assert.match(source, /This setting is only available for active Printify Shopify-channel shops/);
  assert.match(source, /prisma\.printifyShop\.update/);
  assert.match(source, /printify_shop\.unpublish_after_shopify_sync\.updated/);
});
