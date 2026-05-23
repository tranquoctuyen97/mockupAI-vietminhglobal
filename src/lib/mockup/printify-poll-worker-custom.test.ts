import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomMockupImageRows,
  chooseIncludedSourceBucket,
  markPrintifyRowsExcludedForCustomColors,
} from "./printify-poll-worker.js";

// --- buildCustomMockupImageRows with scope ---

test("buildCustomMockupImageRows creates TEMPLATE rows with scope-aware source URLs", () => {
  const rows = buildCustomMockupImageRows({
    sources: [
      {
        id: "src_final",
        colorId: "color_black",
        label: "Hero flat lay",
        view: "front",
        sceneType: "flat_lay",
        renderMode: "FINAL",
        outputPath: "custom-mockups/templates/store/template/color/src-output.jpg",
        isPrimary: true,
        sortOrder: 2,
      },
      {
        id: "src_composite",
        colorId: "color_black",
        label: null,
        view: "lifestyle",
        sceneType: "model",
        renderMode: "COMPOSITE",
        outputPath: null,
        isPrimary: false,
        sortOrder: 1,
      },
    ],
    colorsById: new Map([
      ["color_black", { name: "Black" }],
    ]),
    variantColorLookup: new Map([[101, { colorName: "Black" }]]),
    scope: "TEMPLATE",
    sortOffset: 10000,
  });

  assert.deepEqual(
    rows.map((row) => ({
      sourceUrl: row.sourceUrl,
      compositeUrl: row.compositeUrl,
      compositeStatus: row.compositeStatus,
      included: row.included,
      isDefault: row.isDefault,
      sortOrder: row.sortOrder,
      variantId: row.variantId,
      cameraLabel: row.cameraLabel,
    })),
    [
      {
        sourceUrl: "mockup://custom/template/composite/src_composite",
        compositeUrl: null,
        compositeStatus: "pending",
        included: true,
        isDefault: false,
        sortOrder: 10001,
        variantId: 101,
        cameraLabel: null,
      },
      {
        sourceUrl: "mockup://custom/template/final/src_final",
        compositeUrl: "custom-mockups/templates/store/template/color/src-output.jpg",
        compositeStatus: "completed",
        included: true,
        isDefault: true,
        sortOrder: 10002,
        variantId: 101,
        cameraLabel: "Hero flat lay",
      },
    ],
  );
});

test("buildCustomMockupImageRows creates DRAFT rows with scope-aware source URLs", () => {
  const rows = buildCustomMockupImageRows({
    sources: [
      {
        id: "draft_src_1",
        colorId: "color_white",
        label: "Draft photo",
        view: "front",
        sceneType: "flat_lay",
        renderMode: "FINAL",
        outputPath: "custom-mockups/drafts/draft1/color/src-output.jpg",
        isPrimary: true,
        sortOrder: 0,
      },
    ],
    colorsById: new Map([["color_white", { name: "White" }]]),
    variantColorLookup: new Map([[201, { colorName: "White" }]]),
    scope: "DRAFT",
    sortOffset: 0,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceUrl, "mockup://custom/draft/final/draft_src_1");
  assert.equal(rows[0].sortOrder, 0);
});

// --- markPrintifyRowsExcludedForCustomColors ---

test("markPrintifyRowsExcludedForCustomColors leaves only colors without custom sources selected", () => {
  const rows = [
    { colorName: "Black", included: true },
    { colorName: "Navy", included: true },
  ];

  markPrintifyRowsExcludedForCustomColors(rows, new Set(["black"]));

  assert.deepEqual(rows, [
    { colorName: "Black", included: false },
    { colorName: "Navy", included: true },
  ]);
});

test("markPrintifyRowsExcludedForCustomColors adds 20000 offset to excluded rows", () => {
  const rows = [
    { colorName: "Black", included: true, sortOrder: 5 },
  ];

  markPrintifyRowsExcludedForCustomColors(rows, new Set(["black"]));

  assert.equal(rows[0].included, false);
  assert.equal(rows[0].sortOrder, 20005);
});

// --- chooseIncludedSourceBucket ---

test("chooseIncludedSourceBucket: CUSTOM prefers draft when available", () => {
  assert.equal(
    chooseIncludedSourceBucket({ mode: "CUSTOM", hasDraftRows: true, hasTemplateRows: true }),
    "draft",
  );
});

test("chooseIncludedSourceBucket: CUSTOM falls back to template when no draft", () => {
  assert.equal(
    chooseIncludedSourceBucket({ mode: "CUSTOM", hasDraftRows: false, hasTemplateRows: true }),
    "template",
  );
});

test("chooseIncludedSourceBucket: CUSTOM returns none when no custom", () => {
  assert.equal(
    chooseIncludedSourceBucket({ mode: "CUSTOM", hasDraftRows: false, hasTemplateRows: false }),
    "none",
  );
});

test("chooseIncludedSourceBucket: PRINTIFY uses printify even when draft rows exist", () => {
  assert.equal(
    chooseIncludedSourceBucket({ mode: "PRINTIFY", hasDraftRows: true, hasTemplateRows: true }),
    "printify",
  );
});

test("chooseIncludedSourceBucket: PRINTIFY uses printify when no draft rows exist", () => {
  assert.equal(
    chooseIncludedSourceBucket({ mode: "PRINTIFY", hasDraftRows: false, hasTemplateRows: true }),
    "printify",
  );
});

test("chooseIncludedSourceBucket: PRINTIFY uses printify even when only template rows exist", () => {
  assert.equal(
    chooseIncludedSourceBucket({ mode: "PRINTIFY", hasDraftRows: true, hasTemplateRows: true }),
    "printify",
  );
});

test("chooseIncludedSourceBucket: PRINTIFY falls back to printify when no template rows", () => {
  assert.equal(
    chooseIncludedSourceBucket({ mode: "PRINTIFY", hasDraftRows: true, hasTemplateRows: false }),
    "printify",
  );
});
