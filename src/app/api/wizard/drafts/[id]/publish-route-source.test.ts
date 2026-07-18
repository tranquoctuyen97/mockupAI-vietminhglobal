import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./publish/route.ts", import.meta.url), "utf8");

describe("wizard publish route queue contract", () => {
  it("guards initial publish by tenant and draft before creating listings", () => {
    assert.match(
      source,
      /pg_advisory_xact_lock\(hashtext\(\$\{session\.tenantId\}\), hashtext\(\$\{draftId\}\)\)/,
    );
    assert.match(source, /prisma\.\$transaction/);
  });

  it("creates publish attempts, attempt-scoped jobs, and outbox rows", () => {
    assert.match(source, /publishAttempt\.create/);
    assert.match(source, /publishAttemptId:\s*attempt\.id/);
    assert.match(source, /idempotencyKey:\s*`\$\{input\.listing\.id\}:\$\{attempt\.id\}:SHOPIFY`/);
    assert.match(source, /idempotencyKey:\s*`\$\{input\.listing\.id\}:\$\{attempt\.id\}:PRINTIFY`/);
    assert.match(source, /publishOutbox\.create/);
    assert.match(source, /activePublishAttemptId:\s*attempt\.id/);
  });

  it("carries forward latest succeeded stage jobs deterministically", () => {
    assert.match(source, /latestSucceededJobForStage/);
    assert.match(source, /orderBy:\s*\{\s*createdAt:\s*"desc"\s*\}/);
    assert.match(source, /shopifyResumeFromAttemptId/);
    assert.match(source, /printifyResumeFromAttemptId/);
  });

  it("does not run publish workers inline in the web process", () => {
    assert.doesNotMatch(source, /runPublishWorker/);
    assert.doesNotMatch(source, /runPublishWorkersWithConcurrency/);
  });
});
