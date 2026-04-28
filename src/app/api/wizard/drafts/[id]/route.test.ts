import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChecklist } from "./route";

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
        { colorName: "Royal Blue", included: true },
        { colorName: "Gold", included: true },
        { colorName: "Gold", included: false },
      ]),
      { getFeatureFlag: async () => ({ enabled: false }) },
    );

    assert.equal(checklist.mockupsMatchColors, true);
    assert.equal(checklist.readyToPublish, true);
  });

  it("fails when any selected color has no included mockup image", async () => {
    const checklist = await buildChecklist(
      draftWithMockups([
        { colorName: "Royal Blue", included: true },
        { colorName: "Gold", included: false },
      ]),
      { getFeatureFlag: async () => ({ enabled: false }) },
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
      {
        getFeatureFlag: async (key) => ({
          enabled: key === "printify_real_mockups",
        }),
      },
    );

    assert.equal(checklist.mockupsMatchColors, false);
    assert.equal(checklist.readyToPublish, false);
  });
});
