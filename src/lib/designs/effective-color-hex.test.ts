import assert from "node:assert/strict";
import test from "node:test";
import { resolveColorGroups } from "./color-classifier";
import { applyEffectivePrintifyColorHexes, buildPrintifyColorHexByName } from "./effective-color-hex";

test("applyEffectivePrintifyColorHexes uses Printify cache hex before stored hex", () => {
  const colors = applyEffectivePrintifyColorHexes(
    [{ id: "tahiti", name: "Solid Tahiti Blue", hex: "#0000FF", colorGroup: "auto" }],
    [{ colorName: "Solid Tahiti Blue", colorHex: "#34cdd7" }],
  );
  const groups = resolveColorGroups(colors);

  assert.equal(colors[0]?.hex, "#34cdd7");
  assert.equal(groups.get("tahiti"), "light");
});

test("applyEffectivePrintifyColorHexes keeps Heather Mauve business override dark", () => {
  const colors = applyEffectivePrintifyColorHexes(
    [{ id: "heather-mauve", name: "Heather Mauve", hex: "#CCCCCC", colorGroup: "auto" }],
    [{ colorName: "Heather Mauve", colorHex: "#C68EA3" }],
  );
  const groups = resolveColorGroups(colors);

  assert.equal(colors[0]?.hex, "#C68EA3");
  assert.equal(groups.get("heather-mauve"), "dark");
});

test("buildPrintifyColorHexByName keeps first valid hex per color name", () => {
  const colorHexByName = buildPrintifyColorHexByName([
    { colorName: "Solid Tahiti Blue", colorHex: "#34cdd7" },
    { colorName: "solid tahiti blue", colorHex: "#0000FF" },
    { colorName: "Solid Black", colorHex: null },
  ]);

  assert.equal(colorHexByName.get("solid tahiti blue"), "#34cdd7");
  assert.equal(colorHexByName.has("solid black"), false);
});
