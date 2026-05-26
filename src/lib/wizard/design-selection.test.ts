import assert from "node:assert/strict";
import test from "node:test";
import {
  getDraftDesignIds,
  normalizeDesignIds,
  sameDesignSelection,
} from "./design-selection";

test("normalizeDesignIds keeps unique ids in order", () => {
  assert.deepEqual(
    normalizeDesignIds(["design_1", "design_2", "design_1", "design_3"]),
    ["design_1", "design_2", "design_3"],
  );
});

test("normalizeDesignIds rejects more than five designs", () => {
  assert.throws(
    () => normalizeDesignIds(["design_1", "design_2", "design_3", "design_4", "design_5", "design_6"]),
    /up to 5 designs/,
  );
});

test("getDraftDesignIds prefers child rows and falls back to legacy designId", () => {
  assert.deepEqual(
    getDraftDesignIds({
      designId: "legacy_design",
      draftDesigns: [
        { designId: "design_1" },
        { designId: "design_2" },
      ],
    }),
    ["design_1", "design_2"],
  );

  assert.deepEqual(getDraftDesignIds({ designId: "legacy_design" }), ["legacy_design"]);
  assert.deepEqual(getDraftDesignIds({ designId: null, draftDesigns: [] }), []);
});

test("sameDesignSelection compares ordered design ids", () => {
  assert.equal(sameDesignSelection(["design_1", "design_2"], ["design_1", "design_2"]), true);
  assert.equal(sameDesignSelection(["design_1", "design_2"], ["design_2", "design_1"]), false);
});
