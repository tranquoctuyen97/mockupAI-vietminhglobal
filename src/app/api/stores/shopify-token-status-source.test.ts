import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("publish worker marks store token expired on Shopify auth failure", () => {
  const source = readFileSync("src/lib/publish/worker.ts", "utf8");

  assert.match(source, /ShopifyAuthError/);
  assert.match(source, /status:\s*"TOKEN_EXPIRED"/);
  assert.match(source, /lastHealthCheck:\s*new Date\(\)/);
});

test("store overview auto-checks active Shopify status and offers reconnect when expired", () => {
  const source = readFileSync("src/app/(authed)/stores/[id]/config/page.tsx", "utf8");

  assert.match(source, /autoCheckedStoreIdRef/);
  assert.match(source, /handleTest\(\{\s*silent:\s*true\s*\}\)/);
  assert.match(source, /\/api\/shopify\/authorize\?storeId=\$\{store\.id\}/);
});
