import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const routePath = "src/app/api/stores/[id]/mockup-templates/route.ts";

test("mockup templates route exposes GET with readiness and colors", () => {
  const source = readFileSync(join(process.cwd(), routePath), "utf8");

  assert.match(source, /export\s+async\s+function\s+GET/);
  assert.match(source, /getTemplateReadiness/);
  assert.match(source, /getTemplateReadinessLabel/);
  assert.match(source, /include:\s*{\s*colors:\s*{/);
  assert.match(source, /return\s+NextResponse\.json\(\{\s*templates/);
});

test("mockup templates route includes template pricing and composite defaults", () => {
  const source = readFileSync(join(process.cwd(), routePath), "utf8");

  assert.match(source, /basePriceUsd/);
  assert.match(source, /priceBySizeDefault/);
  assert.match(source, /defaultCompositeRegionPx/);
});
