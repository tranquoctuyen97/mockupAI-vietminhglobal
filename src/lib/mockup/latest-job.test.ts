import assert from "node:assert/strict";
import test from "node:test";
import { pickLatestMockupJobId } from "./latest-job";

test("pickLatestMockupJobId returns null when latest job is already selected", () => {
  const jobs = [
    { id: "old", createdAt: "2026-04-23T12:00:00.000Z" },
    { id: "new", createdAt: "2026-04-24T12:00:00.000Z" },
  ];

  assert.equal(pickLatestMockupJobId(jobs, "new"), null);
});

test("pickLatestMockupJobId does not mutate the input job list", () => {
  const jobs = [
    { id: "new", createdAt: "2026-04-24T12:00:00.000Z" },
    { id: "old", createdAt: "2026-04-23T12:00:00.000Z" },
  ];

  assert.equal(pickLatestMockupJobId(jobs, "old"), "new");
  assert.deepEqual(jobs.map((job) => job.id), ["new", "old"]);
});
