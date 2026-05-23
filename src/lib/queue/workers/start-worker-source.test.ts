import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("standalone worker entrypoint starts the Printify mockup poll worker", () => {
  const source = readFileSync(join(process.cwd(), "start-worker.ts"), "utf8");

  assert.match(source, /dotenv\.config\(\{ path: "\.env" \}\)/);
  assert.match(source, /process\.env\.NODE_ENV !== "production"/);
  assert.match(source, /dotenv\.config\(\{ path: "\.env\.local", override: true \}\)/);
  assert.doesNotMatch(source, /import \{ startPrintifyMockupPollWorker \}/);
  assert.match(source, /import\("\.\/src\/lib\/mockup\/printify-poll-worker"\)/);
  assert.match(source, /startPrintifyMockupPollWorker/);
  assert.match(source, /printifyMockupPollWorker\s*=\s*startPrintifyMockupPollWorker\(\)/);
  assert.match(source, /printifyMockupPollWorker\?\.close\(\)/);
});

test("PM2 ecosystem includes a dedicated worker process", () => {
  const source = readFileSync(join(process.cwd(), "ecosystem.config.js"), "utf8");

  assert.match(source, /name:\s*["']mockupai-worker["']/);
  assert.match(source, /args:\s*["']run worker["']/);
  assert.match(source, /NODE_ENV:\s*["']production["']/);
});
