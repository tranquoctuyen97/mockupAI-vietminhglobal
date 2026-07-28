import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import type { ImportedImage } from "./fetch-image";
import { attachTemporaryDesignUrl, type TemporaryDesignDependencies } from "./temporary-design";

async function importedImage(): Promise<ImportedImage> {
  const buffer = await sharp({
    create: {
      width: 10,
      height: 20,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return {
    buffer,
    mimeType: "image/png",
    extension: "png",
    width: 10,
    height: 20,
    dpi: 72,
    previewBuffer: Buffer.from("preview"),
    normalizedBuffer: null,
    fileSizeBytes: buffer.length,
    redactedSourceUrl: "https://assets.example.test/Cat%20-%20S%C3%A1ng.png",
  };
}

function createDependencies(overrides: Partial<TemporaryDesignDependencies> = {}): {
  dependencies: TemporaryDesignDependencies;
  calls: {
    stored: string[];
    deleted: string[];
    persisted: Array<Record<string, unknown>>;
    transferStates: string[];
  };
} {
  const calls = {
    stored: [] as string[],
    deleted: [] as string[],
    persisted: [] as Array<Record<string, unknown>>,
    transferStates: [] as string[],
  };
  const dependencies: TemporaryDesignDependencies = {
    findDraft: async ({ draftId, tenantId }) =>
      draftId === "draft_1" && tenantId === "tenant_1"
        ? { id: draftId, storeId: "store_1", currentStep: 1 }
        : null,
    createTransfer: async () => ({
      id: "transfer_1",
      expiresAt: new Date("2026-07-25T00:00:00.000Z"),
    }),
    fetchImage: async () => importedImage(),
    putBuffer: async (key) => {
      calls.stored.push(key);
    },
    deleteStorage: async (key) => {
      calls.deleted.push(key);
    },
    markTransferReady: async () => {
      calls.transferStates.push("READY");
    },
    markTransferFailed: async () => {
      calls.transferStates.push("FAILED");
    },
    persistAttachment: async (input) => {
      calls.persisted.push(input as unknown as Record<string, unknown>);
      return {
        draftDesignId: "draft_design_1",
        pairs: [{ id: "pair_1", baseName: "Cat" }],
      };
    },
    createId: () => "design_1",
    now: () => new Date("2026-07-24T00:00:00.000Z"),
    ...overrides,
  };
  return { dependencies, calls };
}

test("binds draft lookup to tenant and refuses a draft from another tenant", async () => {
  let fetched = false;
  const { dependencies } = createDependencies({
    findDraft: async () => null,
    fetchImage: async () => {
      fetched = true;
      return importedImage();
    },
  });

  await assert.rejects(
    attachTemporaryDesignUrl(
      {
        tenantId: "tenant_2",
        profileId: "profile_1",
        ownerUserId: "admin_1",
        draftId: "draft_1",
        url: "https://assets.example.test/design.png",
        pairingMode: "AUTO",
      },
      dependencies,
    ),
    /Draft not found/,
  );
  assert.equal(fetched, false);
});

test("requires the draft to have a selected active store", async () => {
  const { dependencies } = createDependencies({
    findDraft: async () => ({ id: "draft_1", storeId: null, currentStep: 1 }),
  });
  await assert.rejects(
    attachTemporaryDesignUrl(
      {
        tenantId: "tenant_1",
        profileId: "profile_1",
        ownerUserId: "admin_1",
        draftId: "draft_1",
        url: "https://assets.example.test/design.png",
        pairingMode: "AUTO",
      },
      dependencies,
    ),
    /selected store/,
  );
});

test("stores a draft-scoped design, marks transfer attached, and auto-pairs", async () => {
  const { dependencies, calls } = createDependencies();
  const result = await attachTemporaryDesignUrl(
    {
      tenantId: "tenant_1",
      profileId: "profile_1",
      ownerUserId: "admin_1",
      draftId: "draft_1",
      url: "https://assets.example.test/Cat%20-%20S%C3%A1ng.png?token=secret",
      pairingMode: "AUTO",
    },
    dependencies,
  );

  assert.deepEqual(calls.stored, [
    "temporary/mcp/tenant_1/draft_1/designs/design_1.png",
    "temporary/mcp/tenant_1/draft_1/previews/design_1.webp",
  ]);
  assert.deepEqual(calls.transferStates, ["READY"]);
  assert.equal(calls.persisted.length, 1);
  assert.equal(calls.persisted[0].scope, "TEMPORARY_MCP");
  assert.equal(calls.persisted[0].storeId, "store_1");
  assert.equal(calls.persisted[0].ownerUserId, "admin_1");
  assert.equal(calls.persisted[0].pairingMode, "AUTO");
  assert.equal(calls.persisted[0].nextCurrentStep, 2);
  assert.equal(calls.persisted[0].mockupsStaleReason, "designs_changed");
  assert.equal(result.name, "Cat - Sáng");
  assert.equal(result.expiresAt.toISOString(), "2026-08-23T00:00:00.000Z");
  assert.deepEqual(result.pairs, [{ id: "pair_1", baseName: "Cat" }]);
});

test("removes both stored objects and marks the transfer failed when DB attachment rolls back", async () => {
  const { dependencies, calls } = createDependencies({
    persistAttachment: async () => {
      throw new Error("transaction failed");
    },
  });

  await assert.rejects(
    attachTemporaryDesignUrl(
      {
        tenantId: "tenant_1",
        profileId: "profile_1",
        ownerUserId: "admin_1",
        draftId: "draft_1",
        url: "https://assets.example.test/design.png",
        pairingMode: "NONE",
      },
      dependencies,
    ),
    /transaction failed/,
  );
  assert.deepEqual(calls.deleted.sort(), [
    "temporary/mcp/tenant_1/draft_1/designs/design_1.png",
    "temporary/mcp/tenant_1/draft_1/previews/design_1.webp",
  ]);
  assert.deepEqual(calls.transferStates, ["READY", "FAILED"]);
});
