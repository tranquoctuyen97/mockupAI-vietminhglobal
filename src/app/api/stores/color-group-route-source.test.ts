import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("color group route validates override values", () => {
  const source = readFileSync("src/app/api/stores/[id]/colors/[colorId]/group/route.ts", "utf8");
  assert.match(source, /auto/);
  assert.match(source, /light/);
  assert.match(source, /dark/);
  assert.match(source, /prisma\.storeColor\.update/);
});
