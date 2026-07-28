import assert from "node:assert/strict";
import test from "node:test";
import { createPublishSubmissionService, PublishSubmissionError } from "./publish-submission";

test("rejects before transaction when checklist is not ready", async () => {
  let transactionCalls = 0;
  const submit = createPublishSubmissionService({
    loadDraft: async () => ({ id: "draft_1" }),
    buildChecklist: async () => ({
      mockupsMatchColors: false,
      contentComplete: true,
      placementValid: true,
      mockupsNotStale: true,
      colorGroupsBalanced: true,
      readyToPublish: false,
    }),
    executeTransaction: async () => {
      transactionCalls += 1;
      return [];
    },
  });

  await assert.rejects(
    () =>
      submit({
        tenantId: "tenant_1",
        actorUserId: "user_1",
        draftId: "draft_1",
      }),
    (error: unknown) =>
      error instanceof PublishSubmissionError &&
      error.code === "CHECKLIST_NOT_READY" &&
      error.status === 409,
  );
  assert.equal(transactionCalls, 0);
});

test("returns one publishAttemptId per created listing", async () => {
  const submit = createPublishSubmissionService({
    loadDraft: async () => ({ id: "draft_1" }),
    buildChecklist: async () => ({
      mockupsMatchColors: true,
      contentComplete: true,
      placementValid: true,
      mockupsNotStale: true,
      colorGroupsBalanced: true,
      readyToPublish: true,
    }),
    executeTransaction: async () => [
      {
        listingId: "listing_1",
        publishAttemptId: "attempt_1",
        pairId: null,
        draftDesignId: "draft_design_1",
        designId: "design_1",
        designName: "Design 1",
        status: "PUBLISHING",
        alreadyPublished: false,
      },
      {
        listingId: "listing_2",
        publishAttemptId: "attempt_2",
        pairId: "pair_1",
        draftDesignId: "draft_design_2",
        designId: "design_2",
        designName: "Pair 1",
        status: "PUBLISHING",
        alreadyPublished: false,
      },
    ],
  });

  const result = await submit({
    tenantId: "tenant_1",
    actorUserId: "user_1",
    draftId: "draft_1",
  });

  assert.equal(result.draftId, "draft_1");
  assert.equal(result.submissions.length, 2);
  assert.ok(result.submissions.every((item) => item.publishAttemptId));
});

test("returns RESOURCE_NOT_FOUND before checklist or transaction", async () => {
  let checklistCalls = 0;
  let transactionCalls = 0;
  const submit = createPublishSubmissionService({
    loadDraft: async () => null,
    buildChecklist: async () => {
      checklistCalls += 1;
      throw new Error("unreachable");
    },
    executeTransaction: async () => {
      transactionCalls += 1;
      return [];
    },
  });

  await assert.rejects(
    () =>
      submit({
        tenantId: "tenant_1",
        actorUserId: "user_1",
        draftId: "missing",
      }),
    (error: unknown) =>
      error instanceof PublishSubmissionError &&
      error.code === "RESOURCE_NOT_FOUND" &&
      error.status === 404,
  );
  assert.equal(checklistCalls, 0);
  assert.equal(transactionCalls, 0);
});
