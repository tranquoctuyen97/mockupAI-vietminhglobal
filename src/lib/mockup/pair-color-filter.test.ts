import assert from "node:assert/strict";
import test from "node:test";
import {
  assertColorFilterHasColors,
  resolveColorFilterForDraftDesign,
} from "./pair-color-filter";

const colors = [
  { id: "white", hex: "#FFFFFF", colorGroup: "auto" },
  { id: "black", hex: "#111111", colorGroup: "auto" },
  { id: "grey", hex: "#808080", colorGroup: "light" },
];

test("resolveColorFilterForDraftDesign maps light design to light colors", () => {
  assert.deepEqual(
    resolveColorFilterForDraftDesign({
      draftDesignId: "draft_light",
      selectedColorIds: ["white", "black", "grey"],
      storeColors: colors,
      pairs: [{ lightDraftDesignId: "draft_light", darkDraftDesignId: "draft_dark" }],
    }),
    { colorIds: ["white", "grey"], colorGroup: "light" },
  );
});

test("resolveColorFilterForDraftDesign maps dark design to dark colors", () => {
  assert.deepEqual(
    resolveColorFilterForDraftDesign({
      draftDesignId: "draft_dark",
      selectedColorIds: ["white", "black", "grey"],
      storeColors: colors,
      pairs: [{ lightDraftDesignId: "draft_light", darkDraftDesignId: "draft_dark" }],
    }),
    { colorIds: ["black"], colorGroup: "dark" },
  );
});

test("resolveColorFilterForDraftDesign keeps legacy unpaired designs on all selected colors", () => {
  assert.deepEqual(
    resolveColorFilterForDraftDesign({
      draftDesignId: "legacy",
      selectedColorIds: ["white", "black"],
      storeColors: colors,
      pairs: [],
    }),
    { colorIds: ["white", "black"], colorGroup: null },
  );
});

test("assertColorFilterHasColors blocks empty paired groups", () => {
  assert.throws(
    () => assertColorFilterHasColors({ colorIds: [], colorGroup: "light" }),
    /No light colors/,
  );
});
