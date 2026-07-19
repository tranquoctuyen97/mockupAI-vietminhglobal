import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PLACEMENT } from "../placement/types";
import {
  PrintifyAuthenticationError,
  PrintifyBillingError,
  type PrintifyClient,
  type PrintifyErrorMetadata,
  PrintifyPermissionError,
  PrintifyRateLimitError,
  PrintifyServerError,
  PrintifyValidationError,
} from "./client";
import {
  buildPrintifyProductPayload,
  ensurePrintifyImage,
  PrintifyMockupTimeoutError,
  parsePrintifyMockupImages,
  pollPrintifyMockups,
  resolvePrintifyUploadUrl,
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
  assert.deepEqual(
    payload.variants.map((v) => v.id),
    [101, 102],
  );
  assert.equal("visible" in payload, false);
  assert.equal("is_locked" in payload, false);
});

test("buildPrintifyProductPayload normalizes placement with per-view print areas", () => {
  const payload = buildPrintifyProductPayload({
    title: "Per-view placement",
    description: "Description",
    blueprintId: 1,
    printProviderId: 2,
    variantIds: [101],
    imageId: "image",
    placementData: {
      version: "2.1" as const,
      variants: {
        _default: {
          front: {
            ...DEFAULT_PLACEMENT,
            xMm: 10,
            yMm: 20,
            widthMm: 100,
            heightMm: 200,
            rotationDeg: 15,
          },
          back: {
            ...DEFAULT_PLACEMENT,
            xMm: 10,
            yMm: 20,
            widthMm: 100,
            heightMm: 200,
            rotationDeg: 15,
          },
        },
      },
    },
    printAreaByView: {
      front: { widthMm: 200, heightMm: 400, safeMarginMm: 3 },
      back: { widthMm: 400, heightMm: 800, safeMarginMm: 3 },
    },
  });

  const placeholders = (
    payload.print_areas as Array<{
      placeholders: Array<{
        position: string;
        images: Array<{ x: number; y: number; scale: number; angle: number }>;
      }>;
    }>
  )[0].placeholders;

  assert.deepEqual(
    placeholders.map((placeholder) => ({
      position: placeholder.position,
      x: placeholder.images[0].x,
      y: placeholder.images[0].y,
      scale: placeholder.images[0].scale,
      angle: placeholder.images[0].angle,
    })),
    [
      { position: "front", x: 0.3, y: 0.3, scale: 0.5, angle: 15 },
      { position: "back", x: 0.15, y: 0.15, scale: 0.25, angle: 15 },
    ],
  );
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

test("buildPrintifyProductPayload supports separate images by variant group", () => {
  const payload = buildPrintifyProductPayload({
    title: "Pair Product",
    description: "Description",
    blueprintId: 1,
    printProviderId: 2,
    variantIds: [101, 102],
    imageId: "legacy",
    placementData: {
      version: "2.1" as const,
      variants: {
        _default: {
          front: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100, rotationDeg: 0 },
        },
      },
    },
    imageGroups: [
      { imageId: "light-image", variantIds: [101] },
      { imageId: "dark-image", variantIds: [102] },
    ],
  });

  const printAreas = payload.print_areas as Array<{
    variant_ids: number[];
    placeholders: Array<{ images: Array<{ id: string }> }>;
  }>;
  assert.deepEqual(
    printAreas.map((area) => area.variant_ids),
    [[101], [102]],
  );
  assert.equal(printAreas[0].placeholders[0].images[0].id, "light-image");
  assert.equal(printAreas[1].placeholders[0].images[0].id, "dark-image");
});

test("buildPrintifyProductPayload legacy single image still creates one print_area", () => {
  const payload = buildPrintifyProductPayload({
    title: "Single Design",
    description: "Description",
    blueprintId: 1,
    printProviderId: 2,
    variantIds: [101, 102, 103],
    imageId: "single-image",
    placementData: {
      version: "2.1" as const,
      variants: {
        _default: {
          front: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100, rotationDeg: 0 },
        },
      },
    },
  });

  const printAreas = payload.print_areas as Array<{
    variant_ids: number[];
    placeholders: Array<{ images: Array<{ id: string }> }>;
  }>;
  assert.equal(printAreas.length, 1);
  assert.deepEqual(printAreas[0].variant_ids, [101, 102, 103]);
  assert.equal(printAreas[0].placeholders[0].images[0].id, "single-image");
});

test("buildPrintifyProductPayload sends Shopify sales channel collections", () => {
  const payload = buildPrintifyProductPayload({
    title: "Collection Product",
    description: "Description",
    blueprintId: 1,
    printProviderId: 2,
    variantIds: [101],
    imageId: "image",
    placementData: {
      version: "2.1" as const,
      variants: {
        _default: {
          front: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100, rotationDeg: 0 },
        },
      },
    },
    salesChannelCollections: ["Patriotic", "T-Shirts"],
  });

  assert.deepEqual(payload.sales_channel_properties, {
    collections: ["Patriotic", "T-Shirts"],
  });
});

test("resolvePrintifyUploadUrl builds public /api/files URLs", () => {
  assert.equal(
    resolvePrintifyUploadUrl({
      publicBaseUrl: "https://example.ngrok-free.dev/",
      storagePath: "originals/design one.png",
    }),
    "https://example.ngrok-free.dev/api/files/originals/design%20one.png",
  );
});

test("resolvePrintifyUploadUrl rejects local and private URLs", () => {
  for (const publicBaseUrl of [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://10.0.0.2",
    "http://172.16.1.5",
    "http://192.168.1.10",
  ]) {
    assert.equal(
      resolvePrintifyUploadUrl({
        publicBaseUrl,
        storagePath: "originals/design.png",
      }),
      null,
    );
  }
});

test("ensurePrintifyImage uploads by URL before reading local file when public base URL is valid", async () => {
  const calls: string[] = [];
  const client = {
    uploadImageUrl: async (input: { fileName: string; url: string }) => {
      calls.push(`url:${input.fileName}:${input.url}`);
      return { id: "url-image-id" };
    },
    uploadImageBase64: async () => {
      calls.push("base64");
      return { id: "base64-image-id" };
    },
  } as unknown as PrintifyClient;

  const id = await ensurePrintifyImage({
    client,
    designStoragePath: "originals/design.png",
    publicBaseUrl: "https://example.ngrok-free.dev",
    storage: {
      getBuffer: async () => {
        throw new Error("base64 fallback should not read storage");
      },
    } as any,
  });

  assert.equal(id, "url-image-id");
  assert.deepEqual(calls, [
    "url:design_design.png:https://example.ngrok-free.dev/api/files/originals/design.png",
  ]);
});

function printifyErrorMetadata(
  overrides: Partial<PrintifyErrorMetadata> = {},
): PrintifyErrorMetadata {
  return {
    status: 500,
    endpoint: "/uploads/images.json",
    method: "POST",
    responseBody: "{}",
    retryAfterMs: null,
    requestId: null,
    ...overrides,
  };
}

test("ensurePrintifyImage does not fallback to base64 for non-download URL upload errors", async () => {
  const errors: Error[] = [
    new PrintifyAuthenticationError("auth", printifyErrorMetadata({ status: 401 })),
    new PrintifyPermissionError("permission", printifyErrorMetadata({ status: 403 })),
    new PrintifyBillingError("billing", printifyErrorMetadata({ status: 402 })),
    new PrintifyRateLimitError("rate limit", printifyErrorMetadata({ status: 429 })),
    new PrintifyValidationError("validation", printifyErrorMetadata({ status: 422 })),
    new PrintifyServerError("server", printifyErrorMetadata({ status: 500 })),
    new Error("network timeout"),
  ];

  for (const error of errors) {
    let base64Called = false;
    const client = {
      uploadImageUrl: async () => {
        throw error;
      },
      uploadImageBase64: async () => {
        base64Called = true;
        return { id: "base64-image-id" };
      },
    } as unknown as PrintifyClient;

    await assert.rejects(
      () =>
        ensurePrintifyImage({
          client,
          designStoragePath: "originals/design.png",
          publicBaseUrl: "https://example.ngrok-free.dev",
          storage: {
            getBuffer: async () => {
              throw new Error("base64 fallback should not read storage");
            },
          } as any,
        }),
      error,
    );
    assert.equal(base64Called, false, `base64 should not be called for ${error.name}`);
  }
});

test("ensurePrintifyImage falls back to base64 for Printify remote URL download failure", async () => {
  const calls: string[] = [];
  const downloadError = new PrintifyValidationError(
    "Printify could not download image",
    printifyErrorMetadata({
      status: 400,
      responseBody: JSON.stringify({ code: 10300 }),
    }),
  );
  const client = {
    uploadImageUrl: async () => {
      calls.push("url");
      throw downloadError;
    },
    uploadImageBase64: async (input: { fileName: string; contentsBase64: string }) => {
      calls.push(`base64:${input.fileName}:${input.contentsBase64}`);
      return { id: "base64-image-id" };
    },
  } as unknown as PrintifyClient;

  const id = await ensurePrintifyImage({
    client,
    designStoragePath: "originals/design.png",
    publicBaseUrl: "https://example.ngrok-free.dev",
    storage: {
      getBuffer: async () => Buffer.from("image-bytes"),
    } as any,
  });

  assert.equal(id, "base64-image-id");
  assert.deepEqual(calls, ["url", "base64:design_design.png:aW1hZ2UtYnl0ZXM="]);
});

test("ensurePrintifyImage falls back to base64 when public base URL is local", async () => {
  const calls: string[] = [];
  const client = {
    uploadImageUrl: async () => {
      calls.push("url");
      return { id: "url-image-id" };
    },
    uploadImageBase64: async (input: { fileName: string; contentsBase64: string }) => {
      calls.push(`base64:${input.fileName}:${input.contentsBase64}`);
      return { id: "base64-image-id" };
    },
  } as unknown as PrintifyClient;

  const id = await ensurePrintifyImage({
    client,
    designStoragePath: "originals/design.png",
    publicBaseUrl: "http://localhost:3001",
    storage: {
      getBuffer: async () => Buffer.from("image-bytes"),
    } as any,
  });

  assert.equal(id, "base64-image-id");
  assert.deepEqual(calls, ["base64:design_design.png:aW1hZ2UtYnl0ZXM="]);
});
