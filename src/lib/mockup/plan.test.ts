import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PLACEMENT } from "../placement/types";
import { buildMockupImagePlan } from "./plan";

const placementData = {
  version: "2.1" as const,
  variants: {
    _default: {
      front: { ...DEFAULT_PLACEMENT, xMm: 120 },
      back: { ...DEFAULT_PLACEMENT, xMm: 130 },
    },
  },
};

test("buildMockupImagePlan dedupes selected colors by view instead of size variant", () => {
  const plan = buildMockupImagePlan({
    selectedColorIds: ["royal-blue", "gold"],
    storeColors: [
      {
        id: "royal-blue",
        name: "Royal Blue",
        hex: "#4169E1",
        printifyColorId: "royal-blue",
      },
      { id: "gold", name: "Gold", hex: "#FFD700", printifyColorId: "gold" },
      { id: "black", name: "Black", hex: "#000000", printifyColorId: "black" },
    ],
    enabledVariantIds: [101, 102, 201, 202, 301],
    variants: [
      variant(101, "Royal Blue", "S"),
      variant(102, "Royal Blue", "M"),
      variant(201, "Gold", "S"),
      variant(202, "Gold", "M"),
      variant(301, "Black", "S"),
    ],
    placementData,
  });

  assert.deepEqual(
    plan.map((image) => `${image.colorName}:${image.viewPosition}:${image.variantId}`),
    [
      "Royal Blue:front:101",
      "Royal Blue:back:101",
      "Gold:front:201",
      "Gold:back:201",
    ],
  );
  assert.equal(plan.length, 4);
  assert.deepEqual(
    [...new Set(plan.map((image) => image.sourceUrl))],
    ["mockup://solid/front", "mockup://solid/back"],
  );
  assert.ok(plan.every((image) => !image.sourceUrl.includes("placeholder.com")));
  assert.equal(plan[0]?.colorHex, "#4169E1");
});

function variant(id: number, color: string, size: string) {
  return {
    id,
    title: `${color} / ${size}`,
    options: { color, size },
    placeholders: [],
  };
}
