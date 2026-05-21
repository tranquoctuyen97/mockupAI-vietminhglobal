import assert from "node:assert/strict";
import test from "node:test";

let hasFeature: (
  tenantId: string,
  role: string,
  feature: string,
  fetchPermissions?: (tenantId: string, role: string) => Promise<Set<string>>,
) => Promise<boolean>;
let FEATURES: readonly string[];

test("setup", async () => {
  const mod = await import("./roles.js");
  hasFeature = mod.hasFeature;
  FEATURES = mod.FEATURES;
});

test("FEATURES contains all 11 expected keys", () => {
  assert.ok(FEATURES.includes("stores"));
  assert.ok(FEATURES.includes("designs"));
  assert.ok(FEATURES.includes("wizard"));
  assert.ok(FEATURES.includes("listings"));
  assert.ok(FEATURES.includes("auto_fulfill"));
  assert.ok(FEATURES.includes("mockup_library"));
  assert.ok(FEATURES.includes("users"));
  assert.ok(FEATURES.includes("pricing"));
  assert.ok(FEATURES.includes("integrations"));
  assert.ok(FEATURES.includes("ai_settings"));
  assert.ok(FEATURES.includes("inkhub_config"));
  assert.equal(FEATURES.length, 11);
});

test("SUPER_ADMIN always has access", async () => {
  let called = false;
  const result = await hasFeature("tenant1", "SUPER_ADMIN", "inkhub_config", async () => {
    called = true;
    return new Set();
  });
  assert.equal(result, true);
  assert.equal(called, false);
});

test("ADMIN with permission row returns true", async () => {
  const result = await hasFeature(
    "tenant1",
    "ADMIN",
    "stores",
    async () => new Set(["stores", "designs"]),
  );
  assert.equal(result, true);
});

test("ADMIN without permission row returns false", async () => {
  const result = await hasFeature(
    "tenant1",
    "ADMIN",
    "inkhub_config",
    async () => new Set(["stores"]),
  );
  assert.equal(result, false);
});

test("OPERATOR with feature returns true", async () => {
  const result = await hasFeature(
    "tenant1",
    "OPERATOR",
    "designs",
    async () => new Set(["designs"]),
  );
  assert.equal(result, true);
});

test("Unknown role with empty permissions returns false", async () => {
  const result = await hasFeature("tenant1", "UNKNOWN_ROLE", "stores", async () => new Set());
  assert.equal(result, false);
});
