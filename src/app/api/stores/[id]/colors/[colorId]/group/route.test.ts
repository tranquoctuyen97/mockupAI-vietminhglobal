import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("store color group route validates tenant-owned color and allowed values", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/stores/[id]/colors/[colorId]/group/route.ts"),
    "utf8",
  );

  assert.match(source, /VALID_COLOR_GROUPS/);
  assert.match(source, /store:\s*{\s*tenantId:\s*session\.tenantId\s*}/);
  assert.match(source, /storeColor\.update/);
  assert.match(source, /data:\s*{\s*colorGroup\s*}/);
});

test("wizard config exposes colorGroup for template and store colors", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/stores/[id]/wizard-config/route.ts"),
    "utf8",
  );

  assert.match(source, /colorGroup:\s*entry\.color\.colorGroup/);
  assert.match(source, /colorGroup:\s*c\.colorGroup/);
});
