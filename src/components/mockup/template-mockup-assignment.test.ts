import assert from "node:assert/strict";
import test from "node:test";

import { buildAssignMockupToColorOperations } from "./template-mockup-assignment";

const item = (id: string, mockupId: string, appliesToColorIds: string[]) => ({
  id,
  mockupId,
  appliesToColorIds,
});

test("creates a color-specific attachment for a new mockup", () => {
  assert.deepEqual(buildAssignMockupToColorOperations([], "mockup-1", "color-red"), [
    { type: "post", mockupId: "mockup-1", appliesToColorIds: ["color-red"] },
  ]);
});

test("patches an existing mockup attachment when assigning the same mockup to a second color", () => {
  assert.deepEqual(
    buildAssignMockupToColorOperations([item("item-1", "mockup-1", ["color-red"])], "mockup-1", "color-blue"),
    [{ type: "patch", itemId: "item-1", appliesToColorIds: ["color-red", "color-blue"] }],
  );
});

test("replacing a color mockup removes that color from the old item and attaches the chosen mockup", () => {
  assert.deepEqual(
    buildAssignMockupToColorOperations(
      [
        item("old-item", "mockup-old", ["color-red", "color-blue"]),
        item("new-item", "mockup-new", ["color-green"]),
      ],
      "mockup-new",
      "color-red",
    ),
    [
      { type: "patch", itemId: "old-item", appliesToColorIds: ["color-blue"] },
      { type: "patch", itemId: "new-item", appliesToColorIds: ["color-green", "color-red"] },
    ],
  );
});

test("removing the last color from an old item deletes it instead of patching appliesToColorIds to empty", () => {
  assert.deepEqual(
    buildAssignMockupToColorOperations([item("old-item", "mockup-old", ["color-red"])], "mockup-new", "color-red"),
    [
      { type: "delete", itemId: "old-item" },
      { type: "post", mockupId: "mockup-new", appliesToColorIds: ["color-red"] },
    ],
  );
});
