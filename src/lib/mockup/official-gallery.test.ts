import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowInOfficialGallery } from "./official-gallery.js";

test("custom template official gallery excludes Printify and keeps custom sources", () => {
  assert.equal(
    shouldShowInOfficialGallery(
      {
        sourceUrl: "https://images.printify.com/mockup/front-black.png",
        compositeUrl: "https://images.printify.com/mockup/front-black.png",
      },
      "CUSTOM",
    ),
    false,
  );
  assert.equal(
    shouldShowInOfficialGallery(
      {
        sourceUrl: "mockup://custom/template/final/library1",
        compositeUrl: "/media/custom/library1.webp",
      },
      "CUSTOM",
    ),
    true,
  );
  assert.equal(
    shouldShowInOfficialGallery(
      {
        sourceUrl: "mockup://custom/draft/composite/override1",
        compositeUrl: "/media/custom/override1.webp",
      },
      "CUSTOM",
    ),
    true,
  );
});

test("printify template official gallery keeps Printify plus listing overrides only", () => {
  assert.equal(
    shouldShowInOfficialGallery(
      {
        sourceUrl: "https://images.printify.com/mockup/front-black.png",
        compositeUrl: "https://images.printify.com/mockup/front-black.png",
      },
      "PRINTIFY",
    ),
    true,
  );
  assert.equal(
    shouldShowInOfficialGallery(
      {
        sourceUrl: "mockup://custom/draft/composite/override1",
        compositeUrl: "/media/custom/override1.webp",
      },
      "PRINTIFY",
    ),
    true,
  );
  assert.equal(
    shouldShowInOfficialGallery(
      {
        sourceUrl: "mockup://custom/template/final/library1",
        compositeUrl: "/media/custom/library1.webp",
      },
      "PRINTIFY",
    ),
    false,
  );
});
