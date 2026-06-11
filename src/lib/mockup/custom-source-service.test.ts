import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { buildStoragePaths, ValidationError, normalizeSourceBuffer, createWebpOutputBuffer } from "./custom-source-service.js";

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
    "custom-mockups/templates/store1/tmpl1/color1/src1-output.webp",
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
    "custom-mockups/drafts/draft1/color1/src2-output.webp",
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
  assert.ok(paths.outputPath.endsWith("-output.webp"));
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

// --- Buffer format tests ---

test("normalizeSourceBuffer produces real JPEG bytes from any input format", async () => {
  // Input: PNG
  const pngBuffer = await sharp({
    create: { width: 64, height: 64, channels: 4, background: "#ff0000" },
  }).png().toBuffer();

  const result = await normalizeSourceBuffer(pngBuffer);
  const meta = await sharp(result).metadata();

  assert.equal(meta.format, "jpeg");
  assert.ok(meta.width === 64 && meta.height === 64);
});

test("createWebpOutputBuffer produces real WebP bytes", async () => {
  // Input: JPEG
  const jpgBuffer = await sharp({
    create: { width: 128, height: 128, channels: 3, background: "#00ff00" },
  }).jpeg().toBuffer();

  const result = await createWebpOutputBuffer(jpgBuffer);
  const meta = await sharp(result).metadata();

  assert.equal(meta.format, "webp");
  assert.ok(meta.width === 128 && meta.height === 128);
});

test("normalizeSourceBuffer ↔ createWebpOutputBuffer encode different formats", async () => {
  const raw = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#0000ff" },
  }).png().toBuffer();

  const sourceMeta = await sharp(await normalizeSourceBuffer(raw)).metadata();
  const outputMeta = await sharp(await createWebpOutputBuffer(raw)).metadata();

  assert.equal(sourceMeta.format, "jpeg");
  assert.equal(outputMeta.format, "webp");
  // Both came from the same input — they just have different target formats
  assert.equal(sourceMeta.width, 32);
  assert.equal(outputMeta.width, 32);
});
