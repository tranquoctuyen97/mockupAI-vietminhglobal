import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCustomMockupColorRefs,
  summarizeCustomMockupCoverage,
} from "@/lib/wizard/custom-mockup-contracts";

test('["all"] expands to the draft selected colors, not every store color', () => {
  assert.deepEqual(
    resolveCustomMockupColorRefs({
      refs: ["all"],
      selectedColorIds: ["white", "black"],
      storeColors: [
        { id: "white", name: "White" },
        { id: "black", name: "Black" },
        { id: "red", name: "Red" },
      ],
    }),
    { colorIds: ["white", "black"], appliesToAll: true },
  );
});

test("explicit color refs resolve by tenant-store color id or exact normalized name", () => {
  assert.deepEqual(
    resolveCustomMockupColorRefs({
      refs: ["white", "BLACK"],
      selectedColorIds: ["white", "black"],
      storeColors: [
        { id: "white", name: "White" },
        { id: "black", name: "Black" },
      ],
    }),
    { colorIds: ["white", "black"], appliesToAll: false },
  );
});

test("rejects colors outside the current draft selection", () => {
  assert.throws(
    () =>
      resolveCustomMockupColorRefs({
        refs: ["red"],
        selectedColorIds: ["white"],
        storeColors: [
          { id: "white", name: "White" },
          { id: "red", name: "Red" },
        ],
      }),
    /not selected/,
  );
});

test("coverage reports selected colors with no custom source", () => {
  assert.deepEqual(
    summarizeCustomMockupCoverage({
      selectedColorIds: ["white", "black", "navy"],
      sourceColorIds: [["white", "black"], ["black"]],
    }),
    {
      coveredColorIds: ["white", "black"],
      missingColorIds: ["navy"],
    },
  );
});
