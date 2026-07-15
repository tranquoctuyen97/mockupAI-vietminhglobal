import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");

test("PrintifyClient exposes unpublishProduct endpoint", () => {
  assert.match(source, /async unpublishProduct\(shopId: number, productId: string\)/);
  assert.match(source, /\/shops\/\$\{shopId\}\/products\/\$\{productId\}\/unpublish\.json/);
  assert.match(source, /method:\s*"POST"/);
});
