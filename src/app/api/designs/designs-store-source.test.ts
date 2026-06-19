import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function assertSelectedStoreGatesDesignQuery(source: string, method: "findMany" | "count") {
  const gatedQuery = new RegExp(
    [
      `selectedStore\\s*\\?[\\s\\S]{0,600}prisma\\.design\\.${method}`,
      `selectedStore\\s*&&[\\s\\S]{0,600}prisma\\.design\\.${method}`,
      `if\\s*\\(\\s*selectedStore\\s*\\)[\\s\\S]{0,600}prisma\\.design\\.${method}`,
    ].join("|"),
  );
  assert.match(source, gatedQuery);
}

test("design list API still supports store filtering and returns store labels", () => {
  const source = readFileSync("src/app/api/designs/route.ts", "utf8");
  assert.match(source, /searchParams\.get\("storeId"\)/);
  assert.match(source, /store:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/s);
});

test("upload API requires storeId and validates store ownership", () => {
  const source = readFileSync("src/app/api/designs/upload/route.ts", "utf8");
  assert.match(source, /fields\.storeId/);
  assert.match(source, /prisma\.store\.findFirst/);
  assert.match(source, /storeId:\s*store\.id/);
});

test("designs page validates storeId and skips global design queries without a selected store", () => {
  const source = readFileSync("src/app/(authed)/designs/page.tsx", "utf8");
  assert.match(source, /const\s+\{\s*storeId\s*\}\s*=\s*await\s+searchParams/);
  assert.match(source, /selectedStore\s*=\s*storeId/);
  assertSelectedStoreGatesDesignQuery(source, "findMany");
  assertSelectedStoreGatesDesignQuery(source, "count");
  assert.doesNotMatch(source, /storeId\s*===\s*"unassigned"/);
});

test("designs client renders store-first UI without all or unassigned controls", () => {
  const source = readFileSync("src/app/(authed)/designs/DesignsClient.tsx", "utf8");
  assert.match(source, /invalidStoreSelected/);
  assert.match(source, /selectedStore/);
  assert.match(source, /Chọn store để xem design/);
  assert.match(source, /\/designs\/upload\?storeId=/);
  assert.match(source, /\/designs\?storeId=/);
  assert.doesNotMatch(source, /label:\s*"All"/);
  assert.doesNotMatch(source, /label:\s*"Unassigned"/);
  assert.doesNotMatch(source, /id:\s*"unassigned"/);
});

test("upload page preselects a valid storeId and returns to that store library", () => {
  const pageSource = readFileSync("src/app/(authed)/designs/upload/page.tsx", "utf8");
  const clientSource = readFileSync("src/app/(authed)/designs/upload/UploadDesignClient.tsx", "utf8");
  assert.match(pageSource, /searchParams/);
  assert.match(pageSource, /Promise/);
  assert.match(pageSource, /storeId\?:\s*string/);
  assert.match(pageSource, /await\s+searchParams/);
  assert.match(pageSource, /initialStoreId/);
  assert.match(pageSource, /initialStoreId\s*=[\s\S]{0,240}storeId/);
  assert.match(pageSource, /(store\.id\s*={2,3}\s*storeId|storeId\s*={2,3}\s*store\.id)/);
  assert.match(clientSource, /initialStoreId/);
  assert.match(clientSource, /(store\.id\s*={2,3}\s*initialStoreId|initialStoreId\s*={2,3}\s*store\.id)/);
  assert.match(clientSource, /\/designs\?storeId=/);
});
