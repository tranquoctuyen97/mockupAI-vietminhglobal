import assert from "node:assert/strict";
import test from "node:test";
import {
  computeMockupProgressAfterOutcome,
  isFinalBullMqAttempt,
  shouldSkipMockupImageProcessing,
} from "./progress";

test("isFinalBullMqAttempt only returns true for the last configured attempt", () => {
  assert.equal(isFinalBullMqAttempt(0, 3), false);
  assert.equal(isFinalBullMqAttempt(1, 3), false);
  assert.equal(isFinalBullMqAttempt(2, 3), true);
});

test("computeMockupProgressAfterOutcome does not overcount retry failures", () => {
  const retry = computeMockupProgressAfterOutcome({
    totalImages: 1,
    completedImages: 0,
    failedImages: 0,
    existingImageStatus: "processing",
    outcome: "failed",
    isFinalAttempt: false,
  });

  assert.deepEqual(retry, {
    shouldCount: false,
    completedImages: 0,
    failedImages: 0,
    status: "running",
  });

  const finalFailure = computeMockupProgressAfterOutcome({
    totalImages: 1,
    completedImages: 0,
    failedImages: 0,
    existingImageStatus: "processing",
    outcome: "failed",
    isFinalAttempt: true,
  });

  assert.deepEqual(finalFailure, {
    shouldCount: true,
    completedImages: 0,
    failedImages: 1,
    status: "failed",
  });

  const alreadyFailed = computeMockupProgressAfterOutcome({
    totalImages: 1,
    completedImages: 0,
    failedImages: 1,
    existingImageStatus: "failed",
    outcome: "failed",
    isFinalAttempt: true,
  });

  assert.deepEqual(alreadyFailed, {
    shouldCount: false,
    completedImages: 0,
    failedImages: 1,
    status: "failed",
  });
});

test("shouldSkipMockupImageProcessing skips deleted or terminal images", () => {
  assert.equal(shouldSkipMockupImageProcessing(null), true);
  assert.equal(shouldSkipMockupImageProcessing({ compositeStatus: "completed" }), true);
  assert.equal(shouldSkipMockupImageProcessing({ compositeStatus: "failed" }), true);
  assert.equal(shouldSkipMockupImageProcessing({ compositeStatus: "processing" }), false);
});
