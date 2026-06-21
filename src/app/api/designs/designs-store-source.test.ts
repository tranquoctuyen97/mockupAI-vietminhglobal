import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function assertSelectedStoreQueryHasEmptyFallback(
  source: string,
  method: "findMany" | "count",
  emptyFallback: string,
) {
  const selectedStoreQuery = new RegExp(
    `selectedStore\\s*\\?[\\s\\S]{0,1200}prisma\\.design\\.${method}[\\s\\S]{0,1200}:\\s*${emptyFallback}`,
  );
  assert.match(source, selectedStoreQuery);
}

function assertInitialStoreIdComesFromValidatedStore(source: string) {
  const directValidatedInitialStoreId =
    /initialStoreId\s*=\s*stores\.find\([\s\S]{0,300}(store\.id\s*={2,3}\s*storeId|storeId\s*={2,3}\s*store\.id)[\s\S]{0,120}\)\?\.id\s*\?\?\s*null/;
  if (directValidatedInitialStoreId.test(source)) return;

  const validatedStore = source.match(
    /const\s+(\w+)\s*=\s*(?:storeId\s*\?\s*)?stores\.find\([\s\S]{0,300}(store\.id\s*={2,3}\s*storeId|storeId\s*={2,3}\s*store\.id)[\s\S]{0,120}\)(?:\s*:\s*null|\s*\?\?\s*null)?/,
  );
  assert.ok(validatedStore);

  const [, validatedStoreName] = validatedStore;
  assert.match(
    source,
    new RegExp(`initialStoreId\\s*=\\s*${validatedStoreName}\\?\\.id\\s*\\?\\?\\s*null`),
  );
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
  assertSelectedStoreQueryHasEmptyFallback(source, "findMany", "\\[\\s*\\]");
  assertSelectedStoreQueryHasEmptyFallback(source, "count", "0");
  assert.doesNotMatch(source, /storeId\s*===\s*"unassigned"/);
});

test("designs client renders store-first UI without all or unassigned controls", () => {
  const source = readFileSync("src/app/(authed)/designs/DesignsClient.tsx", "utf8");
  assert.match(source, /invalidStoreSelected/);
  assert.match(source, /selectedStore/);
  assert.match(source, /Chọn store để xem design/);
  assert.match(source, /\/designs\/upload\?storeId=/);
  assert.match(source, /\/designs\?storeId=/);
  assert.doesNotMatch(source, /label:\s*["']All["']/);
  assert.doesNotMatch(source, /label:\s*["']Unassigned["']/);
  assert.doesNotMatch(source, /id:\s*["']unassigned["']/);
});

test("upload page preselects a valid storeId and returns to that store library", () => {
  const pageSource = readFileSync("src/app/(authed)/designs/upload/page.tsx", "utf8");
  const clientSource = readFileSync("src/app/(authed)/designs/upload/UploadDesignClient.tsx", "utf8");
  assert.match(pageSource, /searchParams/);
  assert.match(pageSource, /Promise/);
  assert.match(pageSource, /storeId\?:\s*string/);
  assert.match(pageSource, /await\s+searchParams/);
  assert.match(pageSource, /initialStoreId/);
  assertInitialStoreIdComesFromValidatedStore(pageSource);
  assert.match(clientSource, /initialStoreId/);
  assert.match(clientSource, /(store\.id\s*={2,3}\s*initialStoreId|initialStoreId\s*={2,3}\s*store\.id)/);
  assert.match(clientSource, /\/designs\?storeId=/);
});
