import assert from "node:assert/strict";
import test from "node:test";
import { pairDesigns, parseDesignName } from "./design-pairing";

test("parseDesignName detects Vietnamese and English suffixes", () => {
  assert.deepEqual(parseDesignName("Cat - Sáng"), {
    baseName: "Cat",
    type: "LIGHT",
    originalSuffix: "Sáng",
  });
  assert.deepEqual(parseDesignName("Cat_toi"), {
    baseName: "Cat",
    type: "DARK",
    originalSuffix: "toi",
  });
  assert.deepEqual(parseDesignName("Cat light"), {
    baseName: "Cat",
    type: "LIGHT",
    originalSuffix: "light",
  });
  assert.equal(parseDesignName("Cat main"), null);
});

test("parseDesignName strips file extension", () => {
  assert.deepEqual(parseDesignName("1 - sáng.png"), {
    baseName: "1",
    type: "LIGHT",
    originalSuffix: "sáng",
  });
});

test("parseDesignName normalizes Vietnamese accents", () => {
  assert.deepEqual(parseDesignName("Áo - Sáng"), {
    baseName: "Áo",
    type: "LIGHT",
    originalSuffix: "Sáng",
  });
});

test("parseDesignName supports bracketed suffixes", () => {
  assert.deepEqual(parseDesignName("1 (sáng)"), {
    baseName: "1",
    type: "LIGHT",
    originalSuffix: "sáng",
  });
});

test("pairDesigns pairs exact light+dark matches", () => {
  const result = pairDesigns([
    { id: "1", name: "1 - sáng" },
    { id: "2", name: "1 - tối" },
  ]);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].baseName, "1");
  assert.deepEqual(result.unpaired, []);
  assert.deepEqual(result.independent, []);
  assert.equal(result.hasPairIntent, true);
});

test("pairDesigns creates sorted light dark pairs, reports unpaired pair-intent, and separates independent designs", () => {
  const result = pairDesigns([
    { id: "d2", name: "Dog - Tối" },
    { id: "c1", name: "Cat - Sáng" },
    { id: "c2", name: "Cat - Tối" },
    { id: "u1", name: "Bird - Sáng" },
    { id: "d1", name: "Dog - Sáng" },
    { id: "x1", name: "Plain" },
  ]);

  assert.deepEqual(result.pairs.map((pair) => pair.baseName), ["Cat", "Dog"]);
  assert.equal(result.pairs[0].lightDesignId, "c1");
  assert.equal(result.pairs[0].darkDesignId, "c2");
  // Only Bird - Sáng has a pair marker but is missing its dark counterpart
  assert.deepEqual(result.unpaired.map((entry) => entry.id), ["u1"]);
  // Plain has no light/dark suffix → independent, not unpaired
  assert.deepEqual(result.independent.map((entry) => entry.id), ["x1"]);
  assert.equal(result.hasPairIntent, true);
});

test("pairDesigns treats designs without markers as independent", () => {
  const result = pairDesigns([
    { id: "a", name: "Cool Tee" },
    { id: "b", name: "Nice Hoodie" },
  ]);
  assert.equal(result.pairs.length, 0);
  assert.deepEqual(result.unpaired, []);
  assert.deepEqual(result.independent.map((e) => e.id), ["a", "b"]);
  assert.equal(result.hasPairIntent, false);
});
