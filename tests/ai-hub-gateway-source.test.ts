import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("AI Hub uses a gateway process for Codex WebSocket proxying", () => {
  const ecosystem = readFileSync("ecosystem.config.js", "utf8");
  const pkg = readFileSync("package.json", "utf8");
  const gateway = readFileSync("scripts/ai-hub-codex-web-gateway.ts", "utf8");
  const deploy = readFileSync("ops/deploy-vps.sh", "utf8");
  const route = readFileSync("src/app/api/codex-proxy/[[...path]]/route.ts", "utf8");
  const proxy = readFileSync("src/lib/ai-hub/proxy.ts", "utf8");
  const appProxy = readFileSync("src/proxy.ts", "utf8");
  const nextConfig = readFileSync("next.config.ts", "utf8");
  const page = readFileSync("src/app/(authed)/ai-hub/page.tsx", "utf8");

  assert.match(ecosystem, /script:\s*"\.next\/standalone\/server\.js"/);
  assert.match(ecosystem, /AI_HUB_IFRAME_URL:\s*process\.env\.AI_HUB_IFRAME_URL\s*\|\|\s*"\/api\/codex-proxy\/"/);
  assert.match(ecosystem, /mockupai-ai-hub-gateway/);
  assert.match(ecosystem, /AI_HUB_GATEWAY_PORT/);
  assert.doesNotMatch(pkg, /ai-hub:gateway/);
  assert.match(page, /\/api\/codex-proxy\//);
  assert.match(route, /validateSession/);
  assert.match(proxy, /x-internal-member-id/);
  assert.match(proxy, /CODEX_APP_URL/);
  assert.match(appProxy, /pathname\.startsWith\("\/@fs\/"\)/);
  assert.match(appProxy, /normalizeCodexLocalFilePath/);
  assert.match(gateway, /normalizeCodexLocalFilePath/);
  assert.match(appProxy, /NextResponse\.redirect/);
  assert.match(gateway, /server\.on\("upgrade"/);
  assert.match(gateway, /\/__backend\/ipc/);
  assert.match(gateway, /\/api\/internal\/ai-hub\/session/);
  assert.match(gateway, /x-internal-member-id/);
  assert.match(nextConfig, /source:\s*"\/__backend\/:path\*"/);
  assert.match(nextConfig, /AI_HUB_GATEWAY_ORIGIN/);
  assert.match(deploy, /mockupai-ai-hub-gateway/);
  assert.doesNotMatch(deploy, /codex-mobile-has-connected-device/);
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
