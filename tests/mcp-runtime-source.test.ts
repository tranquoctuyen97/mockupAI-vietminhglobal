import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ecosystem = readFileSync("ecosystem.config.js", "utf8");
const deploy = readFileSync("ops/deploy-vps.sh", "utf8");
const nginx = readFileSync("setup-nginx.sh", "utf8");

test("PM2 runs exactly one dedicated MCP process with shared runtime dependencies", () => {
  assert.equal((ecosystem.match(/name: "mockupai-mcp"/g) ?? []).length, 1);
  assert.match(ecosystem, /name: "mockupai-mcp"[\s\S]*?args: "run mcp"/);
  assert.match(ecosystem, /name: "mockupai-mcp"[\s\S]*?instances: 1/);
  assert.match(ecosystem, /name: "mockupai-mcp"[\s\S]*?MCP_HOST: "127\.0\.0\.1"/);
  assert.match(ecosystem, /name: "mockupai-mcp"[\s\S]*?DATABASE_URL: process\.env\.DATABASE_URL/);
  assert.match(ecosystem, /name: "mockupai-mcp"[\s\S]*?REDIS_URL: process\.env\.REDIS_URL/);
  assert.match(ecosystem, /const UPLOAD_DIR = .*path\.join\(__dirname, "uploads"\)/);
});

test("deploy explicitly reloads MCP while preserving the existing worker command", () => {
  assert.match(
    deploy,
    /pm2 startOrReload ecosystem\.config\.js --only mockupai-mcp --update-env/,
  );
  assert.match(
    deploy,
    /pm2 startOrReload ecosystem\.config\.js --only mockupai-worker --update-env/,
  );
  assert.match(ecosystem, /name: "mockupai-worker"[\s\S]*?args: "run worker"/);
});

test("Nginx proxies exact /mcp to its private port before the Next catch-all", () => {
  const mcpIndex = nginx.indexOf("location = /mcp");
  const appIndex = nginx.indexOf("location / {");
  assert.ok(mcpIndex > -1);
  assert.ok(appIndex > mcpIndex);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:\$\{MCP_PORT\}/);
  assert.match(nginx, /location = \/mcp \{[\s\S]*?proxy_buffering off;/);
  assert.doesNotMatch(nginx, /location \^~ \/api\/mcp|location \/api\/mcp/);
});
