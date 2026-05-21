import assert from "node:assert/strict";
import test from "node:test";
import {
  MOCKUP_JOB_STALL_MS,
  shouldFailStalledMockupJob,
} from "./job-timeout";

test("shouldFailStalledMockupJob returns false for completed jobs", () => {
  assert.equal(
    shouldFailStalledMockupJob({
      status: "completed",
      totalImages: 0,
      createdAt: new Date(Date.now() - MOCKUP_JOB_STALL_MS - 1),
      now: new Date(),
    }),
    false,
  );
});

test("shouldFailStalledMockupJob returns false before stall threshold", () => {
  const now = new Date("2026-05-21T00:10:00.000Z");
  assert.equal(
    shouldFailStalledMockupJob({
      status: "running",
      totalImages: 0,
      createdAt: new Date(now.getTime() - MOCKUP_JOB_STALL_MS + 1_000),
      now,
    }),
    false,
  );
});

test("shouldFailStalledMockupJob returns true for old running job with no images", () => {
  const now = new Date("2026-05-21T00:10:00.000Z");
  assert.equal(
    shouldFailStalledMockupJob({
      status: "running",
      totalImages: 0,
      createdAt: new Date(now.getTime() - MOCKUP_JOB_STALL_MS - 1_000),
      now,
    }),
    true,
  );
});

test("shouldFailStalledMockupJob returns false when total images exist", () => {
  const now = new Date("2026-05-21T00:10:00.000Z");
  assert.equal(
    shouldFailStalledMockupJob({
      status: "running",
      totalImages: 2,
      createdAt: new Date(now.getTime() - MOCKUP_JOB_STALL_MS - 1_000),
      now,
    }),
    false,
  );
});
