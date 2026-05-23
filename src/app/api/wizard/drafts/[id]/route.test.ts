import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChecklist } from "./checklist";

const placement = {
  version: "2.1",
  variants: {
    _default: {
      front: {
        xMm: 77.8,
        yMm: 78.2,
        widthMm: 100,
        heightMm: 100,
        rotationDeg: 0,
        lockAspect: true,
        placementMode: "preserve",
        mirrored: false,
      },
    },
  },
};

function draftWithMockups(
  images: Array<{
    colorName: string;
    included: boolean;
    compositeUrl?: string | null;
    sourceUrl?: string | null;
  }>,
) {
  return {
    enabledColorIds: ["blue", "gold"],
    store: {
      colors: [
        { id: "blue", name: "Royal Blue" },
        { id: "gold", name: "Gold" },
      ],
      template: {
        defaultPlacement: placement,
      },
    },
    aiContent: {
      title: "Title",
      description: "Description",
      tags: ["tag"],
    },
    design: {
      width: 1000,
      height: 1000,
      dpi: 300,
    },
    mockupsStale: false,
    mockupJobs: [
      {
        status: "completed",
        images,
      },
    ],
  };
}

describe("buildChecklist", () => {
  it("counts included mockup images per selected color", async () => {
    const checklist = await buildChecklist(
      draftWithMockups([
        {
          colorName: "Royal Blue",
          included: true,
          compositeUrl: "https://images-api.printify.com/mockup/blue.png",
          sourceUrl: "https://images-api.printify.com/mockup/blue.png",
        },
        {
          colorName: "Gold",
          included: true,
          compositeUrl: "https://images-api.printify.com/mockup/gold.png",
          sourceUrl: "https://images-api.printify.com/mockup/gold.png",
        },
        { colorName: "Gold", included: false },
      ]),
    );

    assert.equal(checklist.mockupsMatchColors, true);
    assert.equal(checklist.readyToPublish, true);
  });

  it("fails when any selected color has no included mockup image", async () => {
    const checklist = await buildChecklist(
      draftWithMockups([
        {
          colorName: "Royal Blue",
          included: true,
          compositeUrl: "https://images-api.printify.com/mockup/blue.png",
          sourceUrl: "https://images-api.printify.com/mockup/blue.png",
        },
        { colorName: "Gold", included: false },
      ]),
    );

    assert.equal(checklist.mockupsMatchColors, false);
    assert.equal(checklist.readyToPublish, false);
  });

  it("requires real remote Printify mockups when strict real flag is enabled", async () => {
    const checklist = await buildChecklist(
      draftWithMockups([
        {
          colorName: "Royal Blue",
          included: true,
          compositeUrl: "mockups/local-blue.png",
          sourceUrl: "mockup://solid/front",
        },
        {
          colorName: "Gold",
          included: true,
          compositeUrl: "https://images-api.printify.com/mockup/gold.png",
          sourceUrl: "https://images-api.printify.com/mockup/gold.png",
        },
      ]),
    );

    assert.equal(checklist.mockupsMatchColors, false);
    assert.equal(checklist.readyToPublish, false);
  });

  it("accepts local cached media when the original source is a real Printify URL", async () => {
    const checklist = await buildChecklist(
      draftWithMockups([
        {
          colorName: "Royal Blue",
          included: true,
          compositeUrl: "mockups/printify-blue.png",
          sourceUrl: "https://images-api.printify.com/mockup/blue.png",
        },
        {
          colorName: "Gold",
          included: true,
          compositeUrl: "mockups/printify-gold.png",
          sourceUrl: "https://images-api.printify.com/mockup/gold.png",
        },
      ]),
    );

    assert.equal(checklist.mockupsMatchColors, true);
    assert.equal(checklist.readyToPublish, true);
  });
});
