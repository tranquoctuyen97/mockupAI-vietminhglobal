import assert from "node:assert/strict";
import test from "node:test";
import { classifyColorHex, resolveColorGroups } from "./color-classifier";

test("classifyColorHex uses direct luma threshold", () => {
  assert.equal(classifyColorHex("#FFFFFF"), "light");
  assert.equal(classifyColorHex("#FFFDD0"), "light");
  assert.equal(classifyColorHex("#9B9B9B"), "light");
  assert.equal(classifyColorHex("#808080"), "dark");
  assert.equal(classifyColorHex("#111111"), "dark");
});

test("resolveColorGroups honors manual override before auto classification", () => {
  const groups = resolveColorGroups([
    { id: "white", hex: "#FFFFFF", colorGroup: "auto" },
    { id: "grey", hex: "#808080", colorGroup: "light" },
    { id: "navy", hex: "#131E3A", colorGroup: "dark" },
  ]);

  assert.equal(groups.get("white"), "light");
  assert.equal(groups.get("grey"), "light");
  assert.equal(groups.get("navy"), "dark");
});

test("resolveColorGroups defaults Heather Mauve to dark", () => {
  const groups = resolveColorGroups([
    { id: "heather-mauve", name: "Heather Mauve", hex: "#C68EA3", colorGroup: "auto" },
    { id: "forced-light", name: "Heather Mauve", hex: "#C68EA3", colorGroup: "light" },
  ]);

  assert.equal(groups.get("heather-mauve"), "dark");
  assert.equal(groups.get("forced-light"), "light");
});
