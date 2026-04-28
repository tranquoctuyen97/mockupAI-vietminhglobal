import assert from "node:assert/strict";
import test from "node:test";
import { shouldSyncFinishedMockupJob } from "./job-sync";

test("does not sync a finished job when draft already has a terminal status", () => {
  assert.equal(
    shouldSyncFinishedMockupJob({
      jobStatus: "completed",
      draftJobStatus: "completed",
      alreadySynced: false,
    }),
    false,
  );
});

test("syncs a finished job once when draft state is missing or stale", () => {
  assert.equal(
    shouldSyncFinishedMockupJob({
      jobStatus: "completed",
      draftJobStatus: undefined,
      alreadySynced: false,
    }),
    true,
  );
  assert.equal(
    shouldSyncFinishedMockupJob({
      jobStatus: "failed",
      draftJobStatus: "running",
      alreadySynced: false,
    }),
    true,
  );
  assert.equal(
    shouldSyncFinishedMockupJob({
      jobStatus: "failed",
      draftJobStatus: "running",
      alreadySynced: true,
    }),
    false,
  );
});

test("does not sync jobs that are still running", () => {
  assert.equal(
    shouldSyncFinishedMockupJob({
      jobStatus: "running",
      draftJobStatus: "running",
      alreadySynced: false,
    }),
    false,
  );
});
