import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import sharp from "sharp";
import { compositeImageOnCustomMockup } from "./composite.js";

async function withTempOutput(run: (outputPath: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "custom-mockup-composite-"));
  try {
    await run(join(dir, "output.jpg"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("compositeImageOnCustomMockup keeps native mockup dimensions", async () => {
  const mockupBuffer = await sharp({
    create: {
      width: 800,
      height: 1000,
      channels: 3,
      background: "#ffffff",
    },
  }).jpeg().toBuffer();
  const designBuffer = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 4,
      background: "#ff0000",
    },
  }).png().toBuffer();

  await withTempOutput(async (outputPath) => {
    await compositeImageOnCustomMockup(
      mockupBuffer,
      designBuffer,
      { x: 100, y: 150, width: 300, height: 400, rotationDeg: 0 },
      outputPath,
    );

    const metadata = await sharp(await readFile(outputPath)).metadata();
    assert.equal(metadata.width, 800);
    assert.equal(metadata.height, 1000);
    assert.equal(metadata.format, "jpeg");
  });
});

test("compositeImageOnCustomMockup supports rotated designs", async () => {
  const mockupBuffer = await sharp({
    create: {
      width: 640,
      height: 640,
      channels: 3,
      background: "#eeeeee",
    },
  }).jpeg().toBuffer();
  const designBuffer = await sharp({
    create: {
      width: 160,
      height: 80,
      channels: 4,
      background: "#0000ff",
    },
  }).png().toBuffer();

  await withTempOutput(async (outputPath) => {
    await compositeImageOnCustomMockup(
      mockupBuffer,
      designBuffer,
      { x: 40, y: 60, width: 220, height: 160, rotationDeg: 45 },
      outputPath,
    );

    const metadata = await sharp(await readFile(outputPath)).metadata();
    assert.equal(metadata.width, 640);
    assert.equal(metadata.height, 640);
  });
});
