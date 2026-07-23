import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("codex-web sync helper is controlled and does not deploy", () => {
  const pkg = readFileSync("package.json", "utf8");
  const script = readFileSync("scripts/sync-codex-web-fork.mjs", "utf8");
  const imagePatch = readFileSync("scripts/patch-codex-web-generated-image-paths.mjs", "utf8");
  const deploy = readFileSync("ops/deploy-vps.sh", "utf8");

  assert.match(pkg, /"ai-hub:codex-web:sync":\s*"node scripts\/sync-codex-web-fork\.mjs"/);
  assert.match(script, /tranquoctuyen97\/codex-web\.git/);
  assert.match(script, /0xcaff\/codex-web\.git/);
  assert.match(script, /const branch = process\.env\.CODEX_WEB_BRANCH \|\| "main"/);
  assert.match(script, /run\("git",\s*\["fetch",\s*"upstream"\]\)/);
  assert.match(script, /run\("git",\s*\["merge",\s*"upstream\/main"\]\)/);
  assert.match(script, /patch-codex-web-generated-image-paths\.mjs/);
  assert.match(deploy, /patch-codex-web-generated-image-paths\.mjs/);
  assert.match(imagePatch, /t\.startsWith\(`\/@fs\/`\)/);
  assert.match(imagePatch, /`\/@fs\$\{vp\(pp\(t\)\)\}`/);
  assert.match(script, /execFileSync\("git",\s*\["rev-parse",\s*"HEAD"\]/);
  assert.doesNotMatch(script, /pm2 restart/);
  assert.doesNotMatch(script, /ecosystem\.config/);
});
