import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("runtime helper only wraps codex and PM2 commands", () => {
  const source = readFileSync("src/lib/ai-hub/runtime.ts", "utf8");

  assert.match(source, /spawn/);
  assert.match(source, /codex/);
  assert.match(source, /login/);
  assert.match(source, /status/);
  assert.match(source, /pm2/);
  assert.match(source, /mockupai-codex/);
  assert.match(source, /AI_HUB_RUNTIME_HOME/);
  assert.match(source, /HOME:\s*home/);
  assert.match(source, /CODEX_HOME/);
  assert.match(source, /CODEX_CLI_PATH/);
  assert.match(source, /getCodexCommand/);
  assert.match(source, /codex-mobile-has-connected-device/);
  assert.match(source, /markCodexWebSetupCompleted/);
  assert.match(source, /writeFileSync/);
  assert.match(source, /activeDeviceAuthProcess/);
  assert.match(source, /DEVICE_AUTH_INITIAL_OUTPUT_TIMEOUT_MS/);
  assert.match(source, /https:\/\/auth\.openai\.com\/codex\/device/);
  assert.match(source, /stripAnsi/);
  assert.match(source, /\\x1B/);
  assert.match(source, /runtime === "unknown" && proxy === "reachable" \? "online" : runtime/);
});

test("admin endpoints require AI Hub admin", () => {
  for (const file of [
    "src/app/api/admin/ai-hub/status/route.ts",
    "src/app/api/admin/ai-hub/connect/route.ts",
    "src/app/api/admin/ai-hub/disconnect/route.ts",
    "src/app/api/admin/ai-hub/restart/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /requireAiHubAdmin/);
  }
});

test("admin guard lives outside route files", () => {
  const source = readFileSync("src/lib/ai-hub/admin-guard.ts", "utf8");

  assert.match(source, /validateSession/);
  assert.match(source, /hasFeature\(session\.tenantId,\s*session\.role,\s*"ai_hub"\)/);
  assert.match(source, /session\.role !== "ADMIN" && session\.role !== "SUPER_ADMIN"/);
});

test("admin page renders AI Hub admin client", () => {
  const page = readFileSync("src/app/(authed)/admin/ai-hub/page.tsx", "utf8");
  const client = readFileSync("src/app/(authed)/admin/ai-hub/AiHubAdminClient.tsx", "utf8");
  const shell = readFileSync("src/app/(authed)/AuthedShell.tsx", "utf8");

  assert.match(page, /AiHubAdminClient/);
  assert.match(client, /\/api\/admin\/ai-hub\/status/);
  assert.match(client, /\/api\/admin\/ai-hub\/connect/);
  assert.match(client, /\/api\/admin\/ai-hub\/restart/);
  assert.match(client, /\/api\/admin\/ai-hub\/disconnect/);
  assert.match(client, /Connect Codex/);
  assert.match(client, /Disconnect Codex/);
  assert.match(client, /authOutput/);
  assert.match(client, /Copy link/);
  assert.match(client, /Copy code/);
  assert.match(client, /navigator\.clipboard\.writeText/);
  assert.match(client, /setInterval/);
  assert.match(client, /Codex Web runtime/);
  assert.match(client, /127\.0\.0\.1:8214/);
  assert.match(client, /\/api\/codex-proxy\//);
  assert.doesNotMatch(client, /127\.0\.0\.1:8215/);
  assert.match(shell, /href:\s*"\/admin\/ai-hub"/);
});
