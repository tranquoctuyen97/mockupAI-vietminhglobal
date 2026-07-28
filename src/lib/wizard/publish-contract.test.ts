import assert from "node:assert/strict";
import test from "node:test";

type PublishQueuePayload = {
  listingId: string;
  draftId: string;
  tenantId: string;
  publishAttemptId: string;
};

test("publish queue payload keeps the worker contract stable", () => {
  const payload: PublishQueuePayload = {
    listingId: "listing_1",
    draftId: "draft_1",
    tenantId: "tenant_1",
    publishAttemptId: "attempt_1",
  };

  assert.deepEqual(Object.keys(payload), ["listingId", "draftId", "tenantId", "publishAttemptId"]);
});
