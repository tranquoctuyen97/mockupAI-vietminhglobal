import assert from "node:assert/strict";
import test from "node:test";
import { buildStoragePaths, ValidationError } from "./custom-source-service.js";

// --- buildStoragePaths tests (pure function, no DB needed) ---

test("buildStoragePaths generates template scope paths", () => {
  const paths = buildStoragePaths({
    scope: "TEMPLATE",
    storeId: "store1",
    templateId: "tmpl1",
    colorId: "color1",
    sourceId: "src1",
    renderMode: "FINAL",
  });

  assert.equal(
    paths.storagePath,
    "custom-mockups/templates/store1/tmpl1/color1/src1-source.jpg",
  );
  assert.equal(
    paths.outputPath,
    "custom-mockups/templates/store1/tmpl1/color1/src1-output.jpg",
  );
});

test("buildStoragePaths generates draft scope paths", () => {
  const paths = buildStoragePaths({
    scope: "DRAFT",
    storeId: "store1",
    draftId: "draft1",
    colorId: "color1",
    sourceId: "src2",
    renderMode: "FINAL",
  });

  assert.equal(
    paths.storagePath,
    "custom-mockups/drafts/draft1/color1/src2-source.jpg",
  );
  assert.equal(
    paths.outputPath,
    "custom-mockups/drafts/draft1/color1/src2-output.jpg",
  );
});

test("buildStoragePaths returns null outputPath for COMPOSITE", () => {
  const templatePaths = buildStoragePaths({
    scope: "TEMPLATE",
    storeId: "store1",
    templateId: "tmpl1",
    colorId: "color1",
    sourceId: "src3",
    renderMode: "COMPOSITE",
  });
  assert.equal(templatePaths.outputPath, null);

  const draftPaths = buildStoragePaths({
    scope: "DRAFT",
    storeId: "store1",
    draftId: "draft1",
    colorId: "color1",
    sourceId: "src4",
    renderMode: "COMPOSITE",
  });
  assert.equal(draftPaths.outputPath, null);
});

test("buildStoragePaths FINAL returns non-null outputPath", () => {
  const paths = buildStoragePaths({
    scope: "TEMPLATE",
    storeId: "s",
    templateId: "t",
    colorId: "c",
    sourceId: "x",
    renderMode: "FINAL",
  });
  assert.ok(paths.outputPath);
  assert.ok(paths.outputPath.endsWith("-output.jpg"));
});

// --- ValidationError ---

test("ValidationError has correct name and status", () => {
  const err = new ValidationError("test error", 422);
  assert.equal(err.name, "ValidationError");
  assert.equal(err.message, "test error");
  assert.equal(err.status, 422);
});

test("ValidationError defaults to 400", () => {
  const err = new ValidationError("bad request");
  assert.equal(err.status, 400);
});
