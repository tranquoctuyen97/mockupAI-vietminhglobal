import assert from "node:assert/strict";
import test from "node:test";
import { isRealPrintifyMockupMedia } from "./real-printify-media.js";

test("custom final mockups with local output are treated as usable mockup media", () => {
  assert.equal(
    isRealPrintifyMockupMedia({
      sourceUrl: "mockup://custom-final/source1",
      compositeUrl: "custom-mockups/store/template/color/source1-output.webp",
    }),
    true,
  );
});

test("custom composite mockups are usable only after composite output exists", () => {
  assert.equal(
    isRealPrintifyMockupMedia({
      sourceUrl: "mockup://custom-composite/source1",
      compositeUrl: null,
    }),
    false,
  );
  assert.equal(
    isRealPrintifyMockupMedia({
      sourceUrl: "mockup://custom-composite/source1",
      compositeUrl: "custom-mockups/store/template/color/source1-output.webp",
    }),
    true,
  );
});

test("synthetic mockup sources remain excluded", () => {
  assert.equal(
    isRealPrintifyMockupMedia({
      sourceUrl: "mockup://solid/front",
      compositeUrl: "mockups/local.png",
    }),
    false,
  );
});
