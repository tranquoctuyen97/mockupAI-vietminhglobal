import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { deleteDraftWithPrintifyCleanup } from "./cleanup";

describe("deleteDraftWithPrintifyCleanup", () => {
  it("deletes remote Printify draft product before deleting the local draft", async () => {
    const calls: string[] = [];
    const deleteProduct = mock.fn(async () => {
      calls.push("remote");
    });
    const db = {
      wizardDraft: {
        findFirst: mock.fn(async () => ({
          id: "draft-1",
          storeId: "store-1",
          printifyDraftProductId: "product-1",
        })),
        delete: mock.fn(async () => {
          calls.push("local");
          return { id: "draft-1" };
        }),
      },
    };

    await deleteDraftWithPrintifyCleanup("draft-1", "tenant-1", {
      db: db as any,
      getClientForStore: mock.fn(async () => ({
        client: { deleteProduct },
        externalShopId: 123,
      })) as any,
    });

    assert.deepEqual(calls, ["remote", "local"]);
    const deleteProductArgs = deleteProduct.mock.calls[0].arguments as unknown[];
    assert.equal(deleteProductArgs[0], 123);
    assert.equal(deleteProductArgs[1], "product-1");
  });

  it("still deletes local draft when Printify cleanup fails", async () => {
    const logger = { warn: mock.fn() };
    const db = {
      wizardDraft: {
        findFirst: mock.fn(async () => ({
          id: "draft-1",
          storeId: "store-1",
          printifyDraftProductId: "product-1",
        })),
        delete: mock.fn(async () => ({ id: "draft-1" })),
      },
    };

    await deleteDraftWithPrintifyCleanup("draft-1", "tenant-1", {
      db: db as any,
      getClientForStore: mock.fn(async () => {
        throw new Error("Printify unavailable");
      }) as any,
      logger,
    });

    assert.equal(db.wizardDraft.delete.mock.calls.length, 1);
    assert.equal(logger.warn.mock.calls.length, 1);
  });
});
