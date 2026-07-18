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
});

test("publish worker terminal finalizer is idempotent and failed event is caught", () => {
  assert.match(source, /finalizeFailedPublishAttemptIdempotently/);
  assert.match(source, /activePublishAttemptId:\s*input\.publishAttemptId/);
  assert.match(source, /worker\.on\("failed"/);
  assert.match(source, /\.catch\(\(finalizeError\)/);
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
