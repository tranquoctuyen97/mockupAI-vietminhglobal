import assert from "node:assert/strict";
import test from "node:test";

import type { McpAuthContext } from "../contracts";
import {
  buildReviewPublishUnits,
  createReviewPublishToolService,
} from "./review-publish";

const auth: McpAuthContext = {
  tenantId: "tenant_1",
  userId: "admin_1",
  profileId: "profile_1",
  credentialId: "credential_1",
  credentialKind: "PAT",
  scopes: new Set(["wizard", "publish"]),
};

const wizard = {
  draft: { id: "draft_1", status: "READY" },
  designs: [
    { draftDesignId: "light", designId: "d1", name: "Cat - Light" },
    { draftDesignId: "dark", designId: "d2", name: "Cat - Dark" },
    { draftDesignId: "single", designId: "d3", name: "Dog" },
  ],
  designPairs: [
    {
      id: "pair_1",
      baseName: "Cat",
      lightDraftDesignId: "light",
      darkDraftDesignId: "dark",
    },
  ],
  customMockups: [],
  checklist: {
    mockupsMatchColors: true,
    contentComplete: true,
    placementValid: true,
    mockupsNotStale: true,
    colorGroupsBalanced: true,
    readyToPublish: true,
  },
  jobs: [],
  warnings: [],
};

test("review publish units contain pairs and independent designs exactly once", () => {
  assert.deepEqual(buildReviewPublishUnits(wizard), [
    {
      type: "PAIR",
      id: "pair_1",
      name: "Cat",
      draftDesignIds: ["light", "dark"],
    },
    {
      type: "DESIGN",
      id: "single",
      name: "Dog",
      draftDesignIds: ["single"],
    },
  ]);
});

test("review returns checklist, preview, publish plan, and revision token", async () => {
  const service = createReviewPublishToolService({
    getWizard: async () => wizard,
    createRevision: async () => ({
      token: "v1.payload.signature",
      payload: {
        version: 1,
        tenantId: "tenant_1",
        draftId: "draft_1",
        stateHash: "hash",
        reviewedAt: "2026-07-24T12:00:00.000Z",
      },
    }),
    assertRevision: async () => undefined,
    submitPublish: async () => ({ draftId: "draft_1", submissions: [] }),
    getPreview: async () => [{ id: "image_1", included: true }],
    getStatus: async () => ({
      overallStatus: "ACTIVE",
      listings: [],
      attempts: [],
      jobs: [],
      nextRetryAt: null,
    }),
  });
  const result = await service.review(auth, {
    draftId: "draft_1",
    includePreview: true,
    includePublishPlan: true,
  });
  assert.equal(result.revisionToken, "v1.payload.signature");
  assert.equal(result.readyToPublish, true);
  assert.equal(result.preview.length, 1);
  assert.equal(result.publishUnits.length, 2);
});

test("stale revision rejects before shared publish submission", async () => {
  let submissions = 0;
  const service = createReviewPublishToolService({
    getWizard: async () => wizard,
    createRevision: async () => {
      throw new Error("unused");
    },
    assertRevision: async () => {
      throw new Error("REVISION_CONFLICT");
    },
    submitPublish: async () => {
      submissions += 1;
      return { draftId: "draft_1", submissions: [] };
    },
    getPreview: async () => [],
    getStatus: async () => ({
      overallStatus: "FAILED",
      listings: [],
      attempts: [],
      jobs: [],
      nextRetryAt: null,
    }),
  });
  await assert.rejects(
    service.publish(auth, {
      draftId: "draft_1",
      revisionToken: "stale",
    }),
    /REVISION_CONFLICT/,
  );
  assert.equal(submissions, 0);
});

test("status polling delegates to read-only aggregation only", async () => {
  let revisionCalls = 0;
  let publishCalls = 0;
  const service = createReviewPublishToolService({
    getWizard: async () => wizard,
    createRevision: async () => {
      revisionCalls += 1;
      throw new Error("must not write");
    },
    assertRevision: async () => {
      revisionCalls += 1;
    },
    submitPublish: async () => {
      publishCalls += 1;
      return { draftId: "draft_1", submissions: [] };
    },
    getPreview: async () => [],
    getStatus: async () => ({
      overallStatus: "PUBLISHING",
      listings: [{ id: "listing_1", status: "PUBLISHING" }],
      attempts: [{ id: "attempt_1", status: "RUNNING" }],
      jobs: [{ stage: "SHOPIFY", status: "RUNNING" }],
      nextRetryAt: null,
    }),
  });
  const result = await service.status(auth, { draftId: "draft_1" });
  assert.equal(result.overallStatus, "PUBLISHING");
  assert.equal(revisionCalls, 0);
  assert.equal(publishCalls, 0);
});
