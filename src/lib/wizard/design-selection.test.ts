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

test("normalizeDesignIds rejects more than eighty designs", () => {
  assert.throws(
    () => normalizeDesignIds(Array.from({ length: 81 }, (_, index) => `design_${index + 1}`)),
    /up to 80 designs/,
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
