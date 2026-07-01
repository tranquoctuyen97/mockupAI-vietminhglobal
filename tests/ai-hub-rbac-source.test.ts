import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ai_hub is a first-class RBAC feature", () => {
  const roles = readFileSync("src/lib/auth/roles.ts", "utf8");
  const acl = readFileSync("src/app/(authed)/admin/acl/AclClient.tsx", "utf8");
  const seed = readFileSync("prisma/seeds/rbac-defaults.ts", "utf8");

  assert.match(roles, /"ai_hub"/);
  assert.match(acl, /\{\s*key:\s*"ai_hub",\s*label:\s*"AI Hub"\s*\}/);
  assert.match(seed, /"ai_hub"/);
});

test("sidebar exposes AI Hub and treats it as full-height embed", () => {
  const shell = readFileSync("src/app/(authed)/AuthedShell.tsx", "utf8");

  assert.match(shell, /label:\s*"AI Hub"/);
  assert.match(shell, /href:\s*"\/ai-hub"/);
  assert.match(shell, /feature:\s*"ai_hub"/);
  assert.match(shell, /pathname\.startsWith\("\/ai-hub"\)/);
  assert.match(shell, /isAiHubRoute/);
});
