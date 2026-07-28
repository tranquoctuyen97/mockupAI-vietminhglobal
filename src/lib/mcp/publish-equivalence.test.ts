import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createPublishSubmissionService } from "@/lib/wizard/publish-submission";

const routeSource = readFileSync("src/app/api/wizard/drafts/[id]/publish/route.ts", "utf8");
const mcpSource = readFileSync("src/lib/mcp/tools/review-publish.ts", "utf8");
const serviceSource = readFileSync("src/lib/wizard/publish-submission.ts", "utf8");

test("browser and MCP adapters both delegate to the sole shared publish service", () => {
  assert.match(routeSource, /submitWizardPublish\(\{/);
  assert.match(mcpSource, /submitPublish:\s*submitWizardPublish/);
  assert.doesNotMatch(routeSource, /prisma\.\$transaction/);
  assert.doesNotMatch(mcpSource, /prisma\.\$transaction/);
});

test("MCP never reaches the publish queue or worker directly", () => {
  assert.doesNotMatch(mcpSource, /getPublishQueue|PUBLISH_QUEUE_NAME|\.add\(/);
  assert.doesNotMatch(routeSource, /runPublishWorker|runPublishWorkersWithConcurrency/);
});

test("one shared transaction result exposes one attempt per listing to both adapters", async () => {
  let transactionCalls = 0;
  const expected = [
    {
      listingId: "listing_pair",
      publishAttemptId: "attempt_pair",
      pairId: "pair_1",
      draftDesignId: null,
      designId: "design_light",
      designName: "Cat",
      status: "PUBLISHING",
      alreadyPublished: false,
    },
    {
      listingId: "listing_single",
      publishAttemptId: "attempt_single",
      pairId: null,
      draftDesignId: "draft_design_single",
      designId: "design_single",
      designName: "Dog",
      status: "PUBLISHING",
      alreadyPublished: false,
    },
  ];
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
    executeTransaction: async () => {
      transactionCalls += 1;
      return expected;
    },
  });

  const sharedInput = {
    tenantId: "tenant_1",
    actorUserId: "admin_1",
    draftId: "draft_1",
  };
  const result = await submit(sharedInput);
  assert.equal(transactionCalls, 1);
  assert.deepEqual(result.submissions, expected);
  assert.deepEqual(
    result.submissions.map(({ listingId, publishAttemptId }) => ({
      listingId,
      publishAttemptId,
    })),
    [
      { listingId: "listing_pair", publishAttemptId: "attempt_pair" },
      { listingId: "listing_single", publishAttemptId: "attempt_single" },
    ],
  );
});

test("shared service persists attempts, two stages, outbox, active pointer, and published draft", () => {
  assert.match(serviceSource, /publishAttempt\.create/);
  assert.match(serviceSource, /stage:\s*"SHOPIFY"/);
  assert.match(serviceSource, /stage:\s*"PRINTIFY"/);
  assert.match(serviceSource, /publishOutbox\.create/);
  assert.match(serviceSource, /activePublishAttemptId:\s*attempt\.id/);
  assert.match(serviceSource, /status:\s*"PUBLISHED"/);
});
