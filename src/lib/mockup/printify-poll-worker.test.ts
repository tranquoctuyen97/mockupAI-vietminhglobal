import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { ParsedPrintifyMockupImage } from "../printify/product";
import { buildMockupImageRows } from "./printify-poll-worker";

test("buildMockupImageRows creates one real row per color and auto-includes the hero", async () => {
  const mockups: ParsedPrintifyMockupImage[] = [
    {
      printifyMockupId: "front-default",
      variantIds: [101, 102],
      viewPosition: "front",
      sourceUrl: "https://img/front.png",
      mockupType: "front",
      isDefault: true,
      cameraLabel: "Front",
    },
    {
      printifyMockupId: "person-1",
      variantIds: [101],
      viewPosition: "front",
      sourceUrl: "https://img/person.png",
      mockupType: "person_1",
      isDefault: false,
      cameraLabel: "Person 1",
    },
  ];

  const rows = await buildMockupImageRows({
    mockups,
    variantColorLookup: new Map([
      [101, { colorName: "Royal Blue" }],
      [102, { colorName: "Gold" }],
    ]),
    cacheImage: async (url) => url,
  });

  assert.deepEqual(
    rows.map((row) => `${row.printifyMockupId}:${row.variantId}:${row.colorName}:${row.included}`),
    [
      "front-default:101:Royal Blue:true",
      "front-default:102:Gold:true",
      "person-1:101:Royal Blue:false",
    ],
  );
  assert.ok(rows.every((row) => row.compositeUrl === row.sourceUrl));
  assert.ok(rows.every((row) => row.compositeStatus === "completed"));
});

test("buildMockupImageRows dedupes size variants for the same color", async () => {
  const mockups: ParsedPrintifyMockupImage[] = [
    {
      printifyMockupId: "front-default",
      variantIds: [101, 102, 201],
      viewPosition: "front",
      sourceUrl: "https://img/front.png",
      mockupType: "front",
      isDefault: true,
      cameraLabel: "Front",
    },
    {
      printifyMockupId: "front-default",
      variantIds: [101, 102, 201],
      viewPosition: "front",
      sourceUrl: "https://img/front-duplicate.png",
      mockupType: "front",
      isDefault: true,
      cameraLabel: "Front",
    },
  ];

  const rows = await buildMockupImageRows({
    mockups,
    variantColorLookup: new Map([
      [101, { colorName: "Royal Blue" }],
      [102, { colorName: "Royal Blue" }],
      [201, { colorName: "Gold" }],
    ]),
    cacheImage: async (url) => url,
  });

  assert.deepEqual(
    rows.map((row) => `${row.printifyMockupId}:${row.variantId}:${row.colorName}:${row.included}`),
    [
      "front-default:101:Royal Blue:true",
      "front-default:201:Gold:true",
    ],
  );
});

test("buildMockupImageRows stores cached local composite url when available", async () => {
  const rows = await buildMockupImageRows({
    mockups: [
      {
        printifyMockupId: "front-default",
        variantIds: [101],
        viewPosition: "front",
        sourceUrl: "https://img/front.png",
        mockupType: "front",
        isDefault: true,
        cameraLabel: "Front",
      },
    ],
    variantColorLookup: new Map([[101, { colorName: "Royal Blue" }]]),
    cacheImage: async () => "mockups/printify_front-default_101_front.png",
  });

  assert.equal(rows[0].sourceUrl, "https://img/front.png");
  assert.equal(rows[0].compositeUrl, "mockups/printify_front-default_101_front.png");
});

test("printify poll worker resolves design from mockup job draftDesign first", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/mockup/printify-poll-worker.ts"),
    "utf8",
  );

  assert.match(source, /draftDesign:\s*{\s*include:\s*{\s*design:/);
  assert.match(source, /jobRecord\.draftDesign\?\.design\?\.storagePath/);
  assert.match(source, /jobRecord\.design\?\.storagePath/);
  assert.match(source, /jobRecord\.draft\.design\?\.storagePath/);
});
