import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPairingIsPublishable,
  buildPairRowsFromDraftDesigns,
  stablePairKey,
} from "./design-pairs";

test("buildPairRowsFromDraftDesigns maps selected design ids to draft design ids", () => {
  const rows = buildPairRowsFromDraftDesigns({
    pairing: {
      pairs: [
        {
          baseName: "Cat",
          lightDesignId: "design_light",
          darkDesignId: "design_dark",
          lightDesignName: "Cat - sáng",
          darkDesignName: "Cat - tối",
        },
      ],
    },
    draftDesigns: [
      { id: "draft_design_dark", designId: "design_dark" },
      { id: "draft_design_light", designId: "design_light" },
    ],
  });

  assert.deepEqual(rows, [
    {
      baseName: "Cat",
      lightDraftDesignId: "draft_design_light",
      darkDraftDesignId: "draft_design_dark",
      sortOrder: 0,
    },
  ]);
});

test("stablePairKey changes when either side of a pair changes", () => {
  assert.equal(
    stablePairKey({
      baseName: "Cat",
      lightDraftDesignId: "light_1",
      darkDraftDesignId: "dark_1",
    }),
    "Cat::light_1::dark_1",
  );

  assert.notEqual(
    stablePairKey({
      baseName: "Cat",
      lightDraftDesignId: "light_1",
      darkDraftDesignId: "dark_1",
    }),
    stablePairKey({
      baseName: "Cat",
      lightDraftDesignId: "light_2",
      darkDraftDesignId: "dark_1",
    }),
  );
});

test("assertPairingIsPublishable blocks unpaired selections", () => {
  assert.throws(
    () =>
      assertPairingIsPublishable({
        pairs: [],
        unpaired: [{ id: "design_1", name: "Cat - sáng", reason: "missing_pair_match" }],
        independent: [],
        hasPairIntent: true,
      }),
    /unpaired/i,
  );
});

test("assertPairingIsPublishable allows single independent design", () => {
  assert.doesNotThrow(() =>
    assertPairingIsPublishable({
      pairs: [],
      unpaired: [],
      independent: [{ id: "design_1", name: "My Design" }],
      hasPairIntent: false,
    }),
  );
});
