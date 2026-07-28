import assert from "node:assert/strict";
import test from "node:test";

import { createWizardRevisionService, WizardRevisionError } from "./revision";

const secret = "revision-secret-that-is-at-least-32-bytes-long";
const reviewedAt = new Date("2026-07-24T12:00:00.000Z");

function snapshot() {
  return {
    updatedAt: new Date("2026-07-24T11:00:00.000Z"),
    storeId: "store_1",
    templateId: "template_1",
    enabledColorIds: ["white", "black"],
    enabledSizes: ["S", "M"],
    enabledSizesByColor: { White: ["S"], Black: ["M"] },
    enabledVariantIdsOverride: [101, 102],
    placementOverride: { front: { x: 1, y: 2 } },
    priceBySizeOverride: { S: 24.99 },
    mockupsStale: false,
    draftDesigns: [
      {
        id: "draft_design_1",
        designId: "design_1",
        sortOrder: 0,
        aiContent: { title: "Title" },
      },
    ],
    designPairs: [
      {
        id: "pair_1",
        lightDraftDesignId: "light",
        darkDraftDesignId: "dark",
        aiContent: { title: "Pair title" },
      },
    ],
    mockupSources: [
      {
        id: "source_1",
        appliesToColorIds: ["white"],
        compositeRegionPx: { x: 1, y: 2, width: 3, height: 4 },
      },
    ],
    mockupJobs: [
      {
        id: "job_1",
        status: "completed",
        images: [
          {
            id: "image_1",
            included: true,
            compositeStatus: "completed",
          },
        ],
      },
    ],
  };
}

test("valid revision token verifies against the exact reviewed state", async () => {
  const current = snapshot();
  const service = createWizardRevisionService({
    loadSnapshot: async () => current,
    getSecret: () => secret,
    now: () => reviewedAt,
  });
  const created = await service.createWizardRevisionToken("tenant_1", "draft_1");
  assert.equal(created.payload.reviewedAt, reviewedAt.toISOString());
  await service.assertWizardRevisionToken(created.token, "tenant_1", "draft_1");
});

test("every reviewed field mutation invalidates the token", async () => {
  let current = snapshot();
  const service = createWizardRevisionService({
    loadSnapshot: async () => current,
    getSecret: () => secret,
    now: () => reviewedAt,
  });

  const mutations: Array<(value: ReturnType<typeof snapshot>) => void> = [
    (value) => {
      value.updatedAt = new Date("2026-07-24T11:01:00.000Z");
    },
    (value) => {
      value.templateId = "template_2";
    },
    (value) => {
      value.enabledColorIds.reverse();
    },
    (value) => {
      value.enabledSizes.push("L");
    },
    (value) => {
      value.enabledSizesByColor.White.push("M");
    },
    (value) => {
      value.enabledVariantIdsOverride.push(103);
    },
    (value) => {
      value.placementOverride.front.x = 9;
    },
    (value) => {
      value.priceBySizeOverride.S = 29.99;
    },
    (value) => {
      value.mockupsStale = true;
    },
    (value) => {
      value.draftDesigns[0].aiContent.title = "Changed";
    },
    (value) => {
      value.designPairs[0].aiContent.title = "Changed";
    },
    (value) => {
      value.mockupSources[0].appliesToColorIds.push("black");
    },
    (value) => {
      value.mockupSources[0].compositeRegionPx.width = 99;
    },
    (value) => {
      value.mockupJobs[0].images[0].included = false;
    },
    (value) => {
      value.mockupJobs[0].status = "running";
    },
  ];

  for (const mutate of mutations) {
    current = snapshot();
    const { token } = await service.createWizardRevisionToken("tenant_1", "draft_1");
    mutate(current);
    await assert.rejects(
      service.assertWizardRevisionToken(token, "tenant_1", "draft_1"),
      (error: unknown) =>
        error instanceof WizardRevisionError && error.code === "REVISION_CONFLICT",
    );
  }
});

test("unrelated external state does not change the revision", async () => {
  const current = snapshot();
  let auditEvents = 0;
  const service = createWizardRevisionService({
    loadSnapshot: async () => {
      void auditEvents;
      return current;
    },
    getSecret: () => secret,
    now: () => reviewedAt,
  });
  const { token } = await service.createWizardRevisionToken("tenant_1", "draft_1");
  auditEvents += 1;
  await service.assertWizardRevisionToken(token, "tenant_1", "draft_1");
});

test("tenant, draft, and signature mismatches are revision conflicts", async () => {
  const service = createWizardRevisionService({
    loadSnapshot: async () => snapshot(),
    getSecret: () => secret,
    now: () => reviewedAt,
  });
  const { token } = await service.createWizardRevisionToken("tenant_1", "draft_1");
  for (const [candidate, tenantId, draftId] of [
    [token, "tenant_2", "draft_1"],
    [token, "tenant_1", "draft_2"],
    [`${token.slice(0, -1)}x`, "tenant_1", "draft_1"],
  ]) {
    await assert.rejects(
      service.assertWizardRevisionToken(candidate, tenantId, draftId),
      WizardRevisionError,
    );
  }
});
