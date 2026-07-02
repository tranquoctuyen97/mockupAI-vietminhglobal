import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { probeAndPreview } from "./probe";

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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
