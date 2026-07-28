import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/smoke-mcp-wizard.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("smoke token is read only through a named environment variable", () => {
  assert.equal(packageJson.scripts["mcp:smoke"], "tsx scripts/smoke-mcp-wizard.ts");
  assert.match(source, /--token-env/);
  assert.match(source, /process\.env\[options\.tokenEnv\]/);
  assert.match(source, /--token is forbidden/);
  assert.doesNotMatch(source, /console\.(log|info)\([^\\n]*token/);
});

test("default smoke exercises protocol, discovery, draft, generation status, and review", () => {
  for (const tool of [
    "list_stores",
    "get_store_wizard_config",
    "create_listing_wizard",
    "set_wizard_content",
    "generate_wizard_assets",
    "get_wizard_status",
    "review_wizard",
  ]) {
    assert.match(source, new RegExp(`"${tool}"`));
  }
  assert.match(source, /tools\.length !== 16/);
  assert.match(source, /redactUrl/);
});

test("publish requires both the CLI switch and environment interlock", () => {
  assert.match(source, /options\.publish/);
  assert.match(source, /process\.env\.MCP_SMOKE_ALLOW_PUBLISH !== "1"/);
  assert.match(source, /"publish_listing"/);
  assert.match(source, /"get_publish_status"/);
});
