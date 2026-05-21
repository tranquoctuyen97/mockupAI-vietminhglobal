import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listRoutePath = "src/app/api/stores/[id]/mockup-library/route.ts";
const itemRoutePath = "src/app/api/stores/[id]/mockup-library/[sourceId]/route.ts";

test("mockup library routes require the mockup_library feature", () => {
  const listRoute = readFileSync(listRoutePath, "utf8");
  const itemRoute = readFileSync(itemRoutePath, "utf8");

  assert.match(listRoute, /requireFeature\(["']mockup_library["']\)/);
  assert.match(itemRoute, /requireFeature\(["']mockup_library["']\)/);
});

test("mockup library upload route normalizes uploads before saving records", () => {
  const listRoute = readFileSync(listRoutePath, "utf8");

  assert.match(listRoute, /sharp\(rawBuffer\)[\s\S]*\.rotate\(\)[\s\S]*\.jpeg\(/);
  assert.match(listRoute, /storagePath/);
  assert.match(listRoute, /outputPath/);
});

test("mockup library item route enforces primary uniqueness in a transaction", () => {
  const itemRoute = readFileSync(itemRoutePath, "utf8");

  assert.match(itemRoute, /prisma\.\$transaction/);
  assert.match(itemRoute, /isPrimary:\s*false/);
  assert.match(itemRoute, /id:\s*\{\s*not:\s*sourceId\s*\}/);
});
