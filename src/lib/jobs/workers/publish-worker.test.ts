import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./publish-worker.ts", import.meta.url), "utf8");
const startWorkerSource = readFileSync(
  new URL("../../../../start-worker.ts", import.meta.url),
  "utf8",
);

test("publish worker rethrows retryable errors so BullMQ owns retries", () => {
  assert.match(source, /throw error/);
  assert.match(source, /UnrecoverableError/);
  assert.match(source, /attemptsMade/);
  assert.match(source, /opts\.attempts/);
  assert.match(source, /reconcilePublishAttemptAfterRun/);
  assert.match(source, /PublishAttemptDidNotCompleteError/);
});

test("publish worker terminal finalizer is idempotent and failed event is caught", () => {
  assert.match(source, /finalizeFailedPublishAttemptIdempotently/);
  assert.match(source, /finalizeFailedPublishAttemptInTransaction/);
  assert.match(
    source,
    /prisma\.\$transaction\(\(tx\) => finalizeFailedPublishAttemptInTransaction/,
  );
  assert.match(source, /activePublishAttemptId:\s*input\.publishAttemptId/);
  assert.match(source, /finalizeSucceededPublishAttemptIdempotently/);
  assert.match(source, /prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(source, /status:\s*"SUCCEEDED"/);
  assert.match(source, /worker\.on\("failed"/);
  assert.match(source, /\.catch\(\(finalizeError\)/);
});

test("publish worker marks attempts running and clears active pointer on success", () => {
  assert.match(source, /preparePublishAttemptForRun/);
  assert.match(source, /status:\s*"RUNNING"/);
  assert.match(source, /startedAt:\s*new Date\(\)/);
  assert.match(source, /activePublishAttemptId:\s*null/);
});

test("publish worker does not run business flow for inactive or terminal attempts", () => {
  assert.match(source, /listing\.activePublishAttemptId !== input\.publishAttemptId/);
  assert.match(source, /attempt\.status === "SUCCEEDED"/);
  assert.match(source, /attempt\.status === "FAILED"/);
  assert.match(source, /if \(!shouldRun\) return/);
});

test("publish worker resolves final status from store strategy instead of stage guessing", () => {
  assert.match(source, /resolvePublishStrategy\(listing\.store\)/);
  assert.doesNotMatch(source, /shopifyStatus === "SUCCEEDED" && printifyStatus !== "SUCCEEDED"/);
});

test("publish worker uses durable first external write marker for final status", () => {
  assert.match(source, /firstExternalWriteStartedAt/);
  assert.match(
    source,
    /const hasStartedExternalStage = input\.firstExternalWriteStartedAt !== null/,
  );
});

test("publish worker starts with maxStartedAttempts and lifecycle logging", () => {
  assert.match(source, /export function startPublishWorker/);
  assert.match(source, /maxStartedAttempts/);
  assert.match(source, /Publish worker is ready and listening to queue/);
  assert.match(source, /worker\.on\("error"/);
  assert.match(source, /worker\.on\("stalled"/);
});

test("standalone worker starts publish worker and outbox dispatcher", () => {
  assert.match(startWorkerSource, /startPublishWorker/);
  assert.match(startWorkerSource, /startPublishOutboxDispatcher/);
  assert.match(startWorkerSource, /publishWorker\?\.close\(\)/);
  assert.match(startWorkerSource, /publishOutboxDispatcher\?\.close\(\)/);
  assert.match(startWorkerSource, /Publish worker is ready and listening to queue/);
  assert.match(startWorkerSource, /Publish outbox dispatcher is ready/);
  assert.match(startWorkerSource, /publishWorker\.on\("error"/);
  assert.match(startWorkerSource, /publishWorker\.on\("failed"/);
});
