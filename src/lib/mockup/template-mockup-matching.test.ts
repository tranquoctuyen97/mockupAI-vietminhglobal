import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTemplateMockupPickPlan,
  findMissingMockupColorIds,
} from "./template-mockup-matching";

const item = (id: string, appliesToColorIds: string[], sortOrder = 0, isPrimary = false) => ({
  id,
  appliesToColorIds,
  sortOrder,
  isPrimary,
  createdAt: new Date("2026-01-01"),
});

test("buildTemplateMockupPickPlan uses exact match instead of generic", () => {
  const plan = buildTemplateMockupPickPlan({
    selectedColorIds: ["white"],
    templateMockupItems: [item("generic", []), item("exact", ["white"], 2, true)],
    existingPicks: [],
  });
  assert.deepEqual(plan.create.map((entry) => [entry.templateMockupItemId, entry.colorId]), [["exact", "white"]]);
});

test("buildTemplateMockupPickPlan uses generic fallback when no exact match exists", () => {
  const plan = buildTemplateMockupPickPlan({
    selectedColorIds: ["black"],
    templateMockupItems: [item("generic", [])],
    existingPicks: [],
  });
  assert.deepEqual(plan.create.map((entry) => [entry.templateMockupItemId, entry.colorId]), [["generic", "black"]]);
});

test("findMissingMockupColorIds reports colors with no exact or generic mockup", () => {
  assert.deepEqual(findMissingMockupColorIds(["white"], [item("black-only", ["black"])]), ["white"]);
});

test("buildTemplateMockupPickPlan preserves overrides for unchanged keys and deletes stale picks", () => {
  const override = { x: 1, y: 2, width: 3, height: 4, rotationDeg: 0, imageWidth: 100, imageHeight: 100 };
  const plan = buildTemplateMockupPickPlan({
    selectedColorIds: ["white"],
    templateMockupItems: [item("exact", ["white"], 7, true)],
    existingPicks: [
      { id: "keep", templateMockupItemId: "exact", colorId: "white", compositeRegionPx: override },
      { id: "delete", templateMockupItemId: "old", colorId: "white", compositeRegionPx: null },
    ],
  });
  assert.deepEqual(plan.update, [{ id: "keep", sortOrder: 7, isPrimary: true, compositeRegionPx: override }]);
  assert.deepEqual(plan.deleteIds, ["delete"]);
});
