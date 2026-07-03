import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("response metrics can repair an earlier customer start", () => {
  const source = readFileSync("src/lib/mailboxes/response-metrics.ts", "utf8");

  assert.match(source, /findUnique\(\{\s*where: \{ conversationId: input\.conversationId \}/);
  assert.match(source, /input\.responseStartedAt\.getTime\(\) < existing\.responseStartedAt\.getTime\(\)/);
  assert.match(source, /responseStartedAt: input\.responseStartedAt/);
  assert.match(source, /durationMsBetween\(input\.responseStartedAt, existing\.latestAdminReplyAt\)/);
});
