import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ecosystem config defines mockupai-codex codex-web runtime", () => {
  const source = readFileSync("ecosystem.config.js", "utf8");

  assert.match(source, /name:\s*"mockupai-codex"/);
  assert.match(source, /git\+ssh:\/\/git@github\.com\/tranquoctuyen97\/codex-web\.git#/);
  assert.match(source, /AI_HUB_CODEX_WEB_PORT\s*=\s*process\.env\.AI_HUB_CODEX_WEB_PORT\s*\|\|\s*"8214"/);
  assert.match(source, /PORT:\s*AI_HUB_CODEX_WEB_PORT/);
  assert.match(source, /CODEX_CLI_PATH/);
  assert.match(source, /AI_HUB_WORKSPACES_URL/);
  assert.match(source, /AI_HUB_INTERNAL_TOKEN/);
  assert.match(source, /AI_HUB_RUNTIME_HOME/);
  assert.match(source, /HOME:\s*AI_HUB_RUNTIME_HOME/);
  assert.match(source, /CODEX_HOME/);
  assert.doesNotMatch(source, /codexapp/);
  assert.doesNotMatch(source, /18923/);
});
