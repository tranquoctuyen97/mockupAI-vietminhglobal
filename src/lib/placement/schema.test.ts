import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PLACEMENT } from "./types";
import { PlacementDataSchema, ViewKeySchema } from "./schema";

test("ViewKeySchema accepts all placement views used by the wizard API", () => {
  assert.equal(ViewKeySchema.safeParse("front").success, true);
  assert.equal(ViewKeySchema.safeParse("back").success, true);
  assert.equal(ViewKeySchema.safeParse("sleeve_left").success, true);
  assert.equal(ViewKeySchema.safeParse("sleeve_right").success, true);
  assert.equal(ViewKeySchema.safeParse("neck_label").success, true);
  assert.equal(ViewKeySchema.safeParse("hem").success, true);
});

test("ViewKeySchema rejects unknown views", () => {
  assert.equal(ViewKeySchema.safeParse("hood").success, false);
});

test("PlacementDataSchema accepts v2.1 data with neck label and hem", () => {
  const parsed = PlacementDataSchema.safeParse({
    version: "2.1",
    variants: {
      _default: {
        front: { ...DEFAULT_PLACEMENT },
        neck_label: { ...DEFAULT_PLACEMENT, widthMm: 55 },
        hem: { ...DEFAULT_PLACEMENT, widthMm: 80 },
      },
    },
  });

  assert.equal(parsed.success, true);
});

test("PlacementDataSchema rejects unknown view keys", () => {
  const parsed = PlacementDataSchema.safeParse({
    version: "2.1",
    variants: {
      _default: {
        front: { ...DEFAULT_PLACEMENT },
        hood: { ...DEFAULT_PLACEMENT },
      },
    },
  });

  assert.equal(parsed.success, false);
});
