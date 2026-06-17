import assert from "node:assert/strict";
import test from "node:test";
import { assertNonEmptyVariantGroups, resolveVariantGroupsByColor } from "./variant-groups";

test("resolveVariantGroupsByColor maps Printify variant IDs through store colors to light and dark groups", () => {
  const groups = resolveVariantGroupsByColor({
    variants: [
      { id: 101, title: "White / S", options: { color: "White" } },
      { id: 102, title: "Black / S", options: { color: "Black" } },
      { id: 103, title: "Navy / M", options: { color: "Navy" } },
    ],
    storeColors: [
      { id: "white", name: "White", printifyColorId: null },
      { id: "black", name: "Black", printifyColorId: null },
      { id: "navy", name: "Navy", printifyColorId: null },
    ],
    effectiveColorGroups: new Map([
      ["white", "light"],
      ["black", "dark"],
      ["navy", "dark"],
    ]),
  });

  assert.deepEqual(groups.lightVariantIds, [101]);
  assert.deepEqual(groups.darkVariantIds, [102, 103]);
});

test("resolveVariantGroupsByColor handles printifyColorId matching", () => {
  const groups = resolveVariantGroupsByColor({
    variants: [
      { id: 201, title: "Heather Grey / L", options: { color: "Heather Grey" } },
    ],
    storeColors: [
      { id: "hgrey", name: "Heather Grey", printifyColorId: "heather grey" },
    ],
    effectiveColorGroups: new Map([["hgrey", "light"]]),
  });

  assert.deepEqual(groups.lightVariantIds, [201]);
  assert.deepEqual(groups.darkVariantIds, []);
});

test("assertNonEmptyVariantGroups blocks publish when either side has no variants", () => {
  assert.throws(
    () => assertNonEmptyVariantGroups({ lightVariantIds: [], darkVariantIds: [102] }),
    /No light color variants/,
  );
  assert.throws(
    () => assertNonEmptyVariantGroups({ lightVariantIds: [101], darkVariantIds: [] }),
    /No dark color variants/,
  );
});

test("assertNonEmptyVariantGroups passes when both sides have variants", () => {
  assert.doesNotThrow(() =>
    assertNonEmptyVariantGroups({ lightVariantIds: [101], darkVariantIds: [102] }),
  );
});
