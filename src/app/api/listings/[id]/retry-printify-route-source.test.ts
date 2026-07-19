import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./retry-printify/route.ts", import.meta.url), "utf8");

describe("listing retry route queue contract", () => {
  it("serializes manual retry by listing and returns the active attempt on double-click", () => {
    assert.match(
      source,
      /pg_advisory_xact_lock\(hashtext\(\$\{session\.tenantId\}\), hashtext\(\$\{id\}\)\)/,
    );
    assert.match(source, /listing\.activePublishAttemptId/);
    assert.match(source, /already_running/);
  });

  it("creates a fresh publish attempt and outbox row for manual retry", () => {
    assert.match(source, /publishAttempt\.create/);
    assert.match(source, /attemptNo:\s*nextAttemptNo\(listing\)/);
    assert.match(source, /idempotencyKey:\s*`\$\{listing\.id\}:\$\{attempt\.id\}:SHOPIFY`/);
    assert.match(source, /idempotencyKey:\s*`\$\{listing\.id\}:\$\{attempt\.id\}:PRINTIFY`/);
    assert.match(source, /publishOutbox\.create/);
  });

  it("carries forward only succeeded stages with durable product ids", () => {
    assert.match(source, /latestSucceededJobForStage/);
    assert.match(source, /job\.status === "SUCCEEDED"/);
    assert.match(source, /listing\.shopifyProductId/);
    assert.match(source, /listing\.printifyProductId/);
    assert.match(source, /shopifyResumeFromAttemptId/);
    assert.match(source, /printifyResumeFromAttemptId/);
    assert.match(source, /orderBy:\s*\{\s*createdAt:\s*"desc"\s*\}/);
  });

  it("does not run publish workers inline", () => {
    assert.doesNotMatch(source, /runPublishWorker/);
    assert.doesNotMatch(source, /runPrintifyStage/);
  });
});
