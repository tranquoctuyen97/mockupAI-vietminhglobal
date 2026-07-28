import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const routeSource = readFileSync(new URL("./publish/route.ts", import.meta.url), "utf8");
const serviceSource = readFileSync("src/lib/wizard/publish-submission.ts", "utf8");
const queueSource = readFileSync("src/lib/publish/queue.ts", "utf8");
const outboxSource = readFileSync("src/lib/publish/outbox.ts", "utf8");
const mcpSource = readFileSync("src/lib/mcp/tools/review-publish.ts", "utf8");

describe("wizard publish route queue contract", () => {
  it("delegates browser publish requests to the shared submission service", () => {
    assert.match(routeSource, /submitWizardPublish\(\{/);
    assert.doesNotMatch(routeSource, /prisma\.\$transaction/);
  });

  it("persists outbox work and never enqueues inline", () => {
    assert.match(serviceSource, /publishOutbox\.create/);
    assert.doesNotMatch(serviceSource, /\.add\(/);
    assert.match(queueSource, /PUBLISH_QUEUE_NAME = "publish-jobs"/);
    assert.match(
      outboxSource,
      /listingId:\s*input\.listingId[\s\S]*draftId:\s*input\.draftId[\s\S]*tenantId:\s*input\.tenantId[\s\S]*publishAttemptId:\s*input\.publishAttemptId/,
    );
  });

  it("guards initial publish by tenant and draft before creating listings", () => {
    assert.match(
      serviceSource,
      /pg_advisory_xact_lock\(hashtext\(\$\{input\.tenantId\}\), hashtext\(\$\{draftId\}\)\)/,
    );
    assert.match(serviceSource, /prisma\.\$transaction/);
  });

  it("creates publish attempts, attempt-scoped jobs, and outbox rows", () => {
    assert.match(serviceSource, /publishAttempt\.create/);
    assert.match(serviceSource, /publishAttemptId:\s*attempt\.id/);
    assert.match(
      serviceSource,
      /idempotencyKey:\s*`\$\{input\.listing\.id\}:\$\{attempt\.id\}:SHOPIFY`/,
    );
    assert.match(
      serviceSource,
      /idempotencyKey:\s*`\$\{input\.listing\.id\}:\$\{attempt\.id\}:PRINTIFY`/,
    );
    assert.match(serviceSource, /publishOutbox\.create/);
    assert.match(serviceSource, /activePublishAttemptId:\s*attempt\.id/);
  });

  it("carries forward latest succeeded stage jobs deterministically", () => {
    assert.match(serviceSource, /latestSucceededJobForStage/);
    assert.match(serviceSource, /orderBy:\s*\{\s*createdAt:\s*"desc"\s*\}/);
    assert.match(serviceSource, /shopifyResumeFromAttemptId/);
    assert.match(serviceSource, /printifyResumeFromAttemptId/);
  });

  it("does not treat stale active attempt pointers on terminal listings as running", () => {
    assert.match(serviceSource, /function isTerminalListingStatus/);
    assert.match(serviceSource, /\["ACTIVE", "FAILED", "PARTIAL_FAILURE"\]\.includes\(status\)/);
    assert.match(serviceSource, /if \(isTerminalListingStatus\(listing\.status\)\) return false/);
    assert.match(serviceSource, /"RETRY_SCHEDULED"/);
  });

  it("does not run publish workers inline in the web process", () => {
    assert.doesNotMatch(routeSource, /runPublishWorker/);
    assert.doesNotMatch(routeSource, /runPublishWorkersWithConcurrency/);
    assert.doesNotMatch(serviceSource, /runPublishWorker/);
    assert.doesNotMatch(serviceSource, /runPublishWorkersWithConcurrency/);
    assert.doesNotMatch(mcpSource, /getPublishQueue|PUBLISH_QUEUE_NAME|\.add\(/);
  });
});
