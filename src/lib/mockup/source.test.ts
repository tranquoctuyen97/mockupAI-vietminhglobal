import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { resolveMockupSourceBuffer } from "./source";

test("resolveMockupSourceBuffer creates a local PNG for mockup solid sources without network", async () => {
  let fetchCalled = false;

  const buffer = await resolveMockupSourceBuffer("mockup://solid/front", {
    colorHex: "#4169E1",
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("network should not be called");
    },
  });

  assert.equal(fetchCalled, false);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1200);
  assert.equal(metadata.format, "png");
});

test("resolveMockupSourceBuffer treats legacy placeholder URLs as local synthetic sources", async () => {
  let fetchCalled = false;

  const buffer = await resolveMockupSourceBuffer(
    "https://via.placeholder.com/1200/ffffff/000000?text=Front",
    {
      colorHex: "#FFD700",
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error("legacy placeholder should not use network");
      },
    },
  );

  assert.equal(fetchCalled, false);
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1200);
  assert.equal(metadata.format, "png");
});
