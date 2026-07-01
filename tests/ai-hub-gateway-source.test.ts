import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("AI Hub proxy is served by the MockupAI app process", () => {
  const ecosystem = readFileSync("ecosystem.config.js", "utf8");
  const pkg = readFileSync("package.json", "utf8");
  const route = readFileSync("src/app/api/codex-proxy/[[...path]]/route.ts", "utf8");
  const proxy = readFileSync("src/lib/ai-hub/proxy.ts", "utf8");
  const page = readFileSync("src/app/(authed)/ai-hub/page.tsx", "utf8");

  assert.match(ecosystem, /script:\s*"npm"/);
  assert.match(ecosystem, /args:\s*"run start"/);
  assert.match(ecosystem, /AI_HUB_IFRAME_URL:\s*process\.env\.AI_HUB_IFRAME_URL\s*\|\|\s*"\/api\/codex-proxy\/"/);
  assert.doesNotMatch(ecosystem, /mockupai-ai-hub-gateway/);
  assert.doesNotMatch(ecosystem, /AI_HUB_GATEWAY_PORT/);
  assert.doesNotMatch(pkg, /ai-hub:gateway/);
  assert.match(page, /\/api\/codex-proxy\//);
  assert.match(route, /validateSession/);
  assert.match(proxy, /x-internal-member-id/);
  assert.match(proxy, /CODEX_APP_URL/);
});

test("internal AI Hub session endpoint validates website session and feature", () => {
  const route = readFileSync("src/app/api/internal/ai-hub/session/route.ts", "utf8");
  const auth = readFileSync("src/lib/ai-hub/internal-auth.ts", "utf8");

  assert.match(route, /validateSession/);
  assert.match(route, /hasFeature\(session\.tenantId,\s*session\.role,\s*"ai_hub"\)/);
  assert.match(route, /ensureAiHubWorkspaces/);
  assert.match(route, /hasValidAiHubInternalAuth/);
  assert.match(auth, /AI_HUB_INTERNAL_TOKEN/);
});
