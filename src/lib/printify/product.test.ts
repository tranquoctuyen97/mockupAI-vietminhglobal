import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PLACEMENT } from "../placement/types";
import type { PrintifyClient } from "./client";
import {
  PrintifyMockupTimeoutError,
  buildPrintifyProductPayload,
  parsePrintifyMockupImages,
  pollPrintifyMockups,
} from "./product";

const placementData = {
  version: "2.1" as const,
  variants: {
    _default: {
      front: { ...DEFAULT_PLACEMENT, xMm: 120 },
      back: { ...DEFAULT_PLACEMENT, xMm: 130 },
    },
  },
};

test("parsePrintifyMockupImages keeps real image urls and camera metadata", () => {
  const images = parsePrintifyMockupImages("product-1", [
    {
      id: "img-front",
      src: "https://images.printify.com/front.png",
      variant_ids: [101, 102],
      position: "front",
      is_default: true,
    },
    {
      id: "img-person-1",
      src: "https://images.printify.com/person.png",
      variant_ids: [101],
      position: "front",
      is_default: false,
    },
  ]);

  assert.equal(images.length, 2);
  assert.equal(images[0].printifyMockupId, "img-front");
  assert.equal(images[0].mockupType, "front");
  assert.equal(images[0].cameraLabel, "Front");
  assert.equal(images[0].isDefault, true);
  assert.deepEqual(images[0].variantIds, [101, 102]);
});

test("buildPrintifyProductPayload includes one placeholder per enabled placement view", () => {
  const payload = buildPrintifyProductPayload({
    title: "[DRAFT] Test",
    description: "Draft product",
    blueprintId: 384,
    printProviderId: 99,
    variantIds: [101, 102],
    imageId: "design-image-id",
    placementData,
  }) as {
    print_areas: Array<{ placeholders: Array<{ position: string }> }>;
    variants: Array<{ id: number }>;
    visible?: boolean;
    is_locked?: boolean;
  };

  assert.deepEqual(
    payload.print_areas.map((area) => area.placeholders.map((p) => p.position)),
    [["front", "back"]],
  );
  assert.deepEqual(payload.variants.map((v) => v.id), [101, 102]);
  assert.equal("visible" in payload, false);
  assert.equal("is_locked" in payload, false);
});

test("pollPrintifyMockups resolves when product images appear", async () => {
  let calls = 0;
  const client = {
    getProduct: async () => {
      calls += 1;
      return calls === 1
        ? { id: "p1", title: "Draft", images: [] }
        : { id: "p1", title: "Draft", images: [{ src: "https://img", position: "front" }] };
    },
  } as unknown as PrintifyClient;

  const images = await pollPrintifyMockups({
    client,
    shopId: 123,
    productId: "p1",
    maxWaitMs: 10_000,
    intervalMs: 1,
    sleep: async () => undefined,
  });

  assert.equal(images.length, 1);
  assert.equal(images[0].sourceUrl, "https://img");
});

test("pollPrintifyMockups throws a timeout when images never appear", async () => {
  let currentTime = 0;
  const client = {
    getProduct: async () => ({ id: "p1", title: "Draft", images: [] }),
  } as unknown as PrintifyClient;

  await assert.rejects(
    pollPrintifyMockups({
      client,
      shopId: 123,
      productId: "p1",
      maxWaitMs: 5,
      intervalMs: 2,
      now: () => currentTime,
      sleep: async (ms) => {
        currentTime += ms;
      },
    }),
    PrintifyMockupTimeoutError,
  );
});
