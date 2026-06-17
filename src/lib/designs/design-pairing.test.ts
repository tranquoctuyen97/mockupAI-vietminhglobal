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

test("pairDesigns creates sorted light dark pairs and reports unpaired designs", () => {
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
  assert.deepEqual(result.unpaired.map((entry) => entry.id), ["u1", "x1"]);
});
