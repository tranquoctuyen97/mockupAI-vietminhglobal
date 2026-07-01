import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("AI Hub page validates session, checks feature, bootstraps workspaces, and renders iframe", () => {
  const source = readFileSync("src/app/(authed)/ai-hub/page.tsx", "utf8");

  assert.match(source, /validateSession/);
  assert.match(source, /hasFeature\(session\.tenantId,\s*session\.role,\s*"ai_hub"\)/);
  assert.match(source, /ensureAiHubWorkspaces/);
  assert.match(source, /AI_HUB_IFRAME_URL/);
  assert.match(source, /src=\{iframeSrc\}/);
  assert.match(source, /title="AI Hub"/);
});

test("admin AI Hub routes exist and use admin guard", () => {
  const adminPage = readFileSync("src/app/(authed)/admin/ai-hub/page.tsx", "utf8");
  const statusRoute = readFileSync("src/app/api/admin/ai-hub/status/route.ts", "utf8");

  assert.match(adminPage, /validateSession/);
  assert.match(adminPage, /session\.role !== "ADMIN" && session\.role !== "SUPER_ADMIN"/);
  assert.match(statusRoute, /requireAiHubAdmin/);
});
