import assert from "node:assert/strict";
import test from "node:test";
import {
  getActiveDraftDesignId,
  getLatestJobByDraftDesignId,
  hasActiveOrCompletedJobsForAllDesigns,
} from "./multi-design";

test("getLatestJobByDraftDesignId groups latest job per child design", () => {
  const jobs = [
    { id: "old-a", draftDesignId: "a", createdAt: "2026-05-24T10:00:00.000Z", status: "completed" },
    { id: "new-a", draftDesignId: "a", createdAt: "2026-05-25T10:00:00.000Z", status: "running" },
    { id: "only-b", draftDesignId: "b", createdAt: "2026-05-24T11:00:00.000Z", status: "completed" },
  ];

  const grouped = getLatestJobByDraftDesignId(jobs);
  assert.equal(grouped.get("a")?.id, "new-a");
  assert.equal(grouped.get("b")?.id, "only-b");
});

test("getLatestJobByDraftDesignId falls back to designId for legacy jobs", () => {
  const grouped = getLatestJobByDraftDesignId([
    { id: "legacy-a", designId: "a", createdAt: "2026-05-24T10:00:00.000Z", status: "completed" },
    { id: "legacy-b", designId: "b", createdAt: "2026-05-24T11:00:00.000Z", status: "running" },
  ]);

  assert.equal(grouped.get("a")?.id, "legacy-a");
  assert.equal(grouped.get("b")?.id, "legacy-b");
});

test("hasActiveOrCompletedJobsForAllDesigns requires a usable job for each selected design", () => {
  assert.equal(
    hasActiveOrCompletedJobsForAllDesigns(
      ["a", "b"],
      [
        { id: "a-job", draftDesignId: "a", status: "running" },
        { id: "b-job", draftDesignId: "b", status: "completed" },
      ],
    ),
    true,
  );

  assert.equal(
    hasActiveOrCompletedJobsForAllDesigns(
      ["a", "b"],
      [
        { id: "a-job", draftDesignId: "a", status: "failed" },
        { id: "b-job", draftDesignId: "b", status: "completed" },
      ],
    ),
    false,
  );
});

test("getActiveDraftDesignId keeps selected active tab when still available", () => {
  assert.equal(getActiveDraftDesignId(["a", "b"], "b"), "b");
  assert.equal(getActiveDraftDesignId(["a", "b"], "missing"), "a");
  assert.equal(getActiveDraftDesignId([], "missing"), null);
});
