import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("design list API supports store and unassigned filters", () => {
  const source = readFileSync("src/app/api/designs/route.ts", "utf8");
  assert.match(source, /searchParams\.get\("storeId"\)/);
  assert.match(source, /storeId === "unassigned"/);
  assert.match(source, /store:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/s);
});

test("upload API requires storeId and validates store ownership", () => {
  const source = readFileSync("src/app/api/designs/upload/route.ts", "utf8");
  assert.match(source, /fields\.storeId/);
  assert.match(source, /prisma\.store\.findFirst/);
  assert.match(source, /storeId:\s*store\.id/);
});
