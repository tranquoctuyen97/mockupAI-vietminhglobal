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

test("mockup templates route no longer exposes template default composite region", () => {
  const source = readFileSync(join(process.cwd(), routePath), "utf8");
  assert.doesNotMatch(source, /defaultCompositeRegionPx/);
  assert.match(source, /mockupItems/);
});

test("mockup templates routes include defaultTags in read and write contracts", () => {
  const listRoute = readFileSync(join(process.cwd(), "src/app/api/stores/[id]/mockup-templates/route.ts"), "utf8");
  const detailRoute = readFileSync(join(process.cwd(), "src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts"), "utf8");
  const service = readFileSync(join(process.cwd(), "src/lib/stores/store-service.ts"), "utf8");

  assert.match(listRoute, /loadTemplateDefaultTags/);
  assert.match(listRoute, /defaultTagsByTemplateId\.get\(template\.id\)\s*\?\?\s*\[\]/);
  assert.match(listRoute, /defaultTags\?:\s*unknown/);
  assert.match(listRoute, /normalizeTags\(data\.defaultTags/);
  assert.match(detailRoute, /defaultTags:\s*body\.defaultTags/);
  assert.match(service, /defaultTags\?:\s*unknown/);
  assert.match(service, /function updateTemplateDefaultTags/);
  assert.match(service, /loadTemplateDefaultTags/);
  assert.match(service, /originalDefaultTags/);
});

test("mockup templates routes include defaultCollections in read and write contracts", () => {
  const listRoute = readFileSync(join(process.cwd(), "src/app/api/stores/[id]/mockup-templates/route.ts"), "utf8");
  const detailRoute = readFileSync(join(process.cwd(), "src/app/api/stores/[id]/mockup-templates/[templateId]/route.ts"), "utf8");
  const wizardConfigRoute = readFileSync(join(process.cwd(), "src/app/api/stores/[id]/wizard-config/route.ts"), "utf8");
  const draftRoute = readFileSync(join(process.cwd(), "src/app/api/wizard/drafts/[id]/route.ts"), "utf8");
  const service = readFileSync(join(process.cwd(), "src/lib/stores/store-service.ts"), "utf8");

  assert.match(listRoute, /loadTemplateDefaultCollections/);
  assert.match(listRoute, /defaultCollectionsByTemplateId\.get\(template\.id\)\s*\?\?\s*\[\]/);
  assert.match(listRoute, /defaultCollections\?:\s*unknown/);
  assert.match(detailRoute, /defaultCollections:\s*body\.defaultCollections/);
  assert.match(wizardConfigRoute, /loadTemplateDefaultCollections/);
  assert.match(wizardConfigRoute, /defaultCollectionsByTemplateId\.get\(template\.id\)\s*\?\?\s*\[\]/);
  assert.match(draftRoute, /loadTemplateDefaultCollections/);
  assert.match(draftRoute, /defaultCollectionsByTemplateId\.get\(draft\.template\.id\)\s*\?\?\s*\[\]/);
  assert.match(service, /defaultCollections\?:\s*unknown/);
  assert.match(service, /function updateTemplateDefaultCollections/);
  assert.match(service, /loadTemplateDefaultCollections/);
  assert.match(service, /originalDefaultCollections/);
});
