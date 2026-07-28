import assert from "node:assert/strict";
import test from "node:test";

import { resolveMockupSourceBuffer } from "./source";

test("draft custom source resolves its private storage object", async () => {
  const buffer = await resolveMockupSourceBuffer(
    "mockup://custom/draft/composite/source_1",
    {
      loadDraftSource: async (sourceId) => {
        assert.equal(sourceId, "source_1");
        return { storagePath: "temporary/source_1.png" };
      },
      getStorageBuffer: async (storagePath) => {
        assert.equal(storagePath, "temporary/source_1.png");
        return Buffer.from("draft mockup");
      },
    },
  );
  assert.equal(buffer.toString(), "draft mockup");
});

test("draft source backed by Mockup Library resolves the related library path", async () => {
  const buffer = await resolveMockupSourceBuffer(
    "mockup://custom/draft/composite/source_2",
    {
      loadDraftSource: async () => ({
        storagePath: null,
        mockupLibraryStoragePath: "mockup-library/item.png",
      }),
      getStorageBuffer: async (storagePath) => Buffer.from(storagePath),
    },
  );
  assert.equal(buffer.toString(), "mockup-library/item.png");
});

test("template custom source stays rejected", async () => {
  await assert.rejects(
    resolveMockupSourceBuffer("mockup://custom/template/composite/legacy"),
    /Legacy custom mockup source no longer supported/,
  );
});
