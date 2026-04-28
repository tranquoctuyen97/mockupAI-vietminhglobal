import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPrintifyMockupImage } from "../printify/product";
import { buildMockupImageRows } from "./printify-poll-worker";

test("buildMockupImageRows creates one real row per color and auto-includes the hero", () => {
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

  const rows = buildMockupImageRows({
    mockups,
    variantColorLookup: new Map([
      [101, { colorName: "Royal Blue" }],
      [102, { colorName: "Gold" }],
    ]),
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

test("buildMockupImageRows dedupes size variants for the same color", () => {
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

  const rows = buildMockupImageRows({
    mockups,
    variantColorLookup: new Map([
      [101, { colorName: "Royal Blue" }],
      [102, { colorName: "Royal Blue" }],
      [201, { colorName: "Gold" }],
    ]),
  });

  assert.deepEqual(
    rows.map((row) => `${row.printifyMockupId}:${row.variantId}:${row.colorName}:${row.included}`),
    [
      "front-default:101:Royal Blue:true",
      "front-default:201:Gold:true",
    ],
  );
});
