import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { MAX_PRINTIFY_DESIGN_SIDE, probeAndPreview } from "./probe";

test("probeAndPreview reads image files from disk and reports file size", async () => {
  const dir = await mkdtemp(join(tmpdir(), "probe-image-"));
  try {
    const filePath = join(dir, "design.png");
    const input = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 4,
        background: "#336699",
      },
    })
      .png()
      .toBuffer();
    await writeFile(filePath, input);

    const result = await probeAndPreview(filePath);

    assert.equal(result.width, 12);
    assert.equal(result.height, 8);
    assert.equal(result.fileSize, (await stat(filePath)).size);
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.format, "png");
    assert.equal(result.previewBuffer.length > 0, true);
    assert.equal(result.normalizedBuffer, null);
    assert.equal(result.wasNormalized, false);
    assert.equal(result.originalWidth, 12);
    assert.equal(result.originalHeight, 8);
    assert.equal(result.originalFileSize, (await stat(filePath)).size);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("probeAndPreview normalizes oversized designs for Printify", async () => {
  const dir = await mkdtemp(join(tmpdir(), "probe-large-image-"));
  try {
    const filePath = join(dir, "large-design.png");
    const input = await sharp({
      create: {
        width: MAX_PRINTIFY_DESIGN_SIDE + 1_000,
        height: MAX_PRINTIFY_DESIGN_SIDE + 2_000,
        channels: 4,
        background: "#ff3366",
      },
    })
      .png()
      .toBuffer();
    await writeFile(filePath, input);

    const result = await probeAndPreview(filePath);
    const normalizedMetadata = await sharp(result.normalizedBuffer!).metadata();

    assert.equal(result.wasNormalized, true);
    assert.equal(result.normalizedBuffer instanceof Buffer, true);
    assert.equal(result.height, MAX_PRINTIFY_DESIGN_SIDE);
    assert.equal(result.width, 5_250);
    assert.equal(result.fileSize, result.normalizedBuffer!.length);
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.format, "png");
    assert.equal(result.originalWidth, MAX_PRINTIFY_DESIGN_SIDE + 1_000);
    assert.equal(result.originalHeight, MAX_PRINTIFY_DESIGN_SIDE + 2_000);
    assert.equal(result.originalFileSize, (await stat(filePath)).size);
    assert.equal(normalizedMetadata.width, result.width);
    assert.equal(normalizedMetadata.height, result.height);
    assert.equal(result.previewBuffer.length > 0, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
