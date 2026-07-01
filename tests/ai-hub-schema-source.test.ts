import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("schema defines generic AI Hub workspace tables", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  assert.match(schema, /model AiHubWorkspace/);
  assert.match(schema, /@@map\("ai_hub_workspaces"\)/);
  assert.match(schema, /provider\s+String\s+@default\("codex"\)/);
  assert.match(schema, /type\s+String/);
  assert.match(schema, /path\s+String/);
  assert.match(schema, /@@unique\(\[tenantId,\s*provider,\s*path\]\)/);
  assert.match(schema, /model AiHubMemberWorkspace/);
  assert.match(schema, /@@map\("ai_hub_member_workspaces"\)/);
  assert.match(schema, /@@unique\(\[userId,\s*workspaceId\]\)/);
});

test("migration creates generic AI Hub workspace tables", () => {
  const migration = readFileSync(
    "prisma/migrations/20260630090000_ai_hub_workspaces/migration.sql",
    "utf8",
  );

  assert.match(migration, /CREATE TABLE "ai_hub_workspaces"/);
  assert.match(migration, /CREATE TABLE "ai_hub_member_workspaces"/);
  assert.match(migration, /"provider" TEXT NOT NULL DEFAULT 'codex'/);
  assert.match(migration, /"type" TEXT NOT NULL/);
  assert.match(migration, /ai_hub_workspaces_tenant_id_provider_path_key/);
  assert.match(migration, /ai_hub_member_workspaces_user_id_workspace_id_key/);
});
