import assert from "node:assert/strict";
import test from "node:test";
import { filterChangedDraftPatch } from "./use-wizard-store";

test("filterChangedDraftPatch drops structurally unchanged values", () => {
  const draft = {
    enabledColorIds: ["color_1"],
    placementOverride: null,
    currentStep: 3,
  };

  assert.deepEqual(
    filterChangedDraftPatch(draft, {
      enabledColorIds: ["color_1"],
      placementOverride: undefined,
      currentStep: 3,
    }),
    {},
  );
});

test("filterChangedDraftPatch keeps changed values", () => {
  const draft = {
    enabledColorIds: ["color_1"],
    currentStep: 3,
  };

  assert.deepEqual(
    filterChangedDraftPatch(draft, {
      enabledColorIds: ["color_1", "color_2"],
      currentStep: 4,
    }),
    {
      enabledColorIds: ["color_1", "color_2"],
      currentStep: 4,
    },
  );
});
