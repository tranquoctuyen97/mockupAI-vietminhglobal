import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldCleanupPrintifyDraft } from "./cleanup-orphan-printify-products";

describe("shouldCleanupPrintifyDraft", () => {
  it("only selects old abandoned drafts with remote product ids", () => {
    const cutoff = new Date("2026-04-20T00:00:00.000Z");

    assert.equal(
      shouldCleanupPrintifyDraft({
        id: "draft-1",
        storeId: "store-1",
        printifyDraftProductId: "product-1",
        status: "ABANDONED",
        updatedAt: new Date("2026-04-19T00:00:00.000Z"),
      }, cutoff),
      true,
    );

    assert.equal(
      shouldCleanupPrintifyDraft({
        id: "draft-2",
        storeId: "store-1",
        printifyDraftProductId: "product-2",
        status: "DRAFT",
        updatedAt: new Date("2026-04-19T00:00:00.000Z"),
      }, cutoff),
      false,
    );

    assert.equal(
      shouldCleanupPrintifyDraft({
        id: "draft-3",
        storeId: "store-1",
        printifyDraftProductId: "product-3",
        status: "ABANDONED",
        updatedAt: new Date("2026-04-21T00:00:00.000Z"),
      }, cutoff),
      false,
    );
  });
});
