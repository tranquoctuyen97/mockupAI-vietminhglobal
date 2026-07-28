import assert from "node:assert/strict";
import test from "node:test";

import { normalizeManualWizardContent, normalizeWizardAssetTypes } from "./mutations";

test("manual content uses current tag and collection normalization", () => {
  assert.deepEqual(
    normalizeManualWizardContent({
      title: "  Sunset Tee  ",
      description: " Description ",
      tags: [" POD ", "pod", "Summer"],
      organizationCollections: [" Summer ", "summer", ""],
    }),
    {
      title: "Sunset Tee",
      description: "Description",
      tags: ["POD", "Summer"],
      collections: ["Summer"],
      altText: "",
      source: "manual",
    },
  );
});

test("asset generation requires at least one unique known type", () => {
  assert.deepEqual(normalizeWizardAssetTypes(["MOCKUPS", "MOCKUPS", "CONTENT"]), [
    "MOCKUPS",
    "CONTENT",
  ]);
  assert.throws(() => normalizeWizardAssetTypes([]), /asset type/);
});
