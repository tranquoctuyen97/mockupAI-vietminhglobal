import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./outbox.ts", import.meta.url), "utf8");

describe("publish outbox contract", () => {
  it("claims pending rows atomically with SKIP LOCKED", () => {
    assert.match(source, /FOR UPDATE SKIP LOCKED/);
    assert.match(source, /attempts = attempts \+ 1/);
    assert.match(
      source,
      /RETURNING id, listing_id, wizard_draft_id, tenant_id, publish_attempt_id, attempts/,
    );
  });

  it("does not double-increment attempts when enqueue fails", () => {
    const rescheduleIndex = source.indexOf("export async function reschedulePublishOutbox");
    const rescheduleSource = source.slice(rescheduleIndex, rescheduleIndex + 900);
    assert.doesNotMatch(rescheduleSource, /attempts:\s*\{\s*increment/);
    assert.doesNotMatch(rescheduleSource, /attempts\s*=/);
  });

  it("uses attempt scoped BullMQ job id and terminal finalizer", () => {
    assert.match(source, /enqueuePublishJob/);
    assert.match(source, /publishAttemptId:\s*row\.publish_attempt_id/);
    assert.match(source, /markPublishOutboxDead/);
    assert.match(source, /finalizeFailedPublishAttemptIdempotently/);
    assert.match(source, /errorCode:\s*"PUBLISH_ENQUEUE_FAILED"/);
  });

  it("finalizes the attempt before marking the outbox row dead", () => {
    const terminalBranchIndex = source.indexOf("row.attempts >= PUBLISH_OUTBOX_MAX_ATTEMPTS");
    const terminalBranch = source.slice(terminalBranchIndex, terminalBranchIndex + 600);
    const finalizeIndex = terminalBranch.indexOf("finalizeFailedPublishAttemptIdempotently");
    const deadIndex = terminalBranch.indexOf("markPublishOutboxDead");
    assert.ok(finalizeIndex >= 0, "terminal branch should call finalizer");
    assert.ok(deadIndex >= 0, "terminal branch should mark outbox dead");
    assert.ok(finalizeIndex < deadIndex, "finalizer must run before marking outbox dead");
  });

  it("uses hostname pid and worker instance uuid for lockedBy", () => {
    assert.match(source, /hostname\(\)/);
    assert.match(source, /process\.pid/);
    assert.match(source, /WORKER_INSTANCE_ID/);
  });

  it("exports dispatcher lifecycle", () => {
    assert.match(source, /export function startPublishOutboxDispatcher/);
    assert.match(source, /close\(\)/);
    assert.match(source, /rescueStaleDispatchingPublishOutbox/);
  });
});
