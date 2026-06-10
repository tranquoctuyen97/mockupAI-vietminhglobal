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

type ImageInput = {
  colorName: string;
  included: boolean;
  compositeUrl?: string | null;
  sourceUrl?: string | null;
};

function makeImages(images: ImageInput[]) {
  return images;
}

function legacyDraftWithMockups(images: ImageInput[]) {
  return {
    designId: "design_1",
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
      id: "design_1",
      width: 1000,
      height: 1000,
      dpi: 300,
    },
    mockupsStale: false,
    mockupJobs: [
      {
        id: "job-legacy",
        designId: "design_1",
        status: "completed",
        createdAt: "2026-05-24T10:00:00.000Z",
        images,
      },
    ],
  };
}

function multiDesignDraft() {
  return {
    designId: "design_a",
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
      id: "design_a",
      width: 1000,
      height: 1000,
      dpi: 300,
    },
    draftDesigns: [
      {
        id: "draft-design-a",
        designId: "design_a",
        sortOrder: 0,
        design: {
          id: "design_a",
          name: "Design A",
          storagePath: "designs/a.png",
          previewPath: null,
        },
      },
      {
        id: "draft-design-b",
        designId: "design_b",
        sortOrder: 1,
        design: {
          id: "design_b",
          name: "Design B",
          storagePath: "designs/b.png",
          previewPath: null,
        },
      },
    ],
    mockupsStale: false,
  };
}

describe("buildChecklist", () => {
  it("counts included mockup images per selected color for the legacy single design", async () => {
    const checklist = await buildChecklist(
      legacyDraftWithMockups(
        makeImages([
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
      ),
    );

    assert.equal(checklist.mockupsMatchColors, true);
    assert.equal(checklist.readyToPublish, true);
  });

  it("requires every selected design to have matching mockups", async () => {
    const draft = multiDesignDraft();
    const checklist = await buildChecklist({
      ...draft,
      mockupJobs: [
        {
          id: "job-a",
          draftDesignId: "draft-design-a",
          designId: "design_a",
          status: "completed",
          createdAt: "2026-05-24T10:00:00.000Z",
          images: makeImages([
            {
              colorName: "Royal Blue",
              included: true,
              compositeUrl: "https://images-api.printify.com/mockup/a-blue.png",
              sourceUrl: "https://images-api.printify.com/mockup/a-blue.png",
            },
            {
              colorName: "Gold",
              included: true,
              compositeUrl: "https://images-api.printify.com/mockup/a-gold.png",
              sourceUrl: "https://images-api.printify.com/mockup/a-gold.png",
            },
          ]),
        },
        {
          id: "job-b",
          draftDesignId: "draft-design-b",
          designId: "design_b",
          status: "completed",
          createdAt: "2026-05-24T11:00:00.000Z",
          images: makeImages([
            {
              colorName: "Royal Blue",
              included: true,
              compositeUrl: "https://images-api.printify.com/mockup/b-blue.png",
              sourceUrl: "https://images-api.printify.com/mockup/b-blue.png",
            },
            {
              colorName: "Gold",
              included: true,
              compositeUrl: "https://images-api.printify.com/mockup/b-gold.png",
              sourceUrl: "https://images-api.printify.com/mockup/b-gold.png",
            },
          ]),
        },
      ],
    });

    assert.equal(checklist.mockupsMatchColors, true);
    assert.equal(checklist.readyToPublish, true);
  });

  it("fails when any selected design is missing one of the selected colors", async () => {
    const draft = multiDesignDraft();
    const checklist = await buildChecklist({
      ...draft,
      mockupJobs: [
        {
          id: "job-a",
          draftDesignId: "draft-design-a",
          designId: "design_a",
          status: "completed",
          createdAt: "2026-05-24T10:00:00.000Z",
          images: makeImages([
            {
              colorName: "Royal Blue",
              included: true,
              compositeUrl: "https://images-api.printify.com/mockup/a-blue.png",
              sourceUrl: "https://images-api.printify.com/mockup/a-blue.png",
            },
            {
              colorName: "Gold",
              included: true,
              compositeUrl: "https://images-api.printify.com/mockup/a-gold.png",
              sourceUrl: "https://images-api.printify.com/mockup/a-gold.png",
            },
          ]),
        },
        {
          id: "job-b",
          draftDesignId: "draft-design-b",
          designId: "design_b",
          status: "completed",
          createdAt: "2026-05-24T11:00:00.000Z",
          images: makeImages([
            {
              colorName: "Royal Blue",
              included: true,
              compositeUrl: "https://images-api.printify.com/mockup/b-blue.png",
              sourceUrl: "https://images-api.printify.com/mockup/b-blue.png",
            },
            { colorName: "Gold", included: false },
          ]),
        },
      ],
    });

    assert.equal(checklist.mockupsMatchColors, false);
    assert.equal(checklist.readyToPublish, false);
  });

  it("requires real remote Printify mockups when strict real flag is enabled", async () => {
    const checklist = await buildChecklist(
      legacyDraftWithMockups(
        makeImages([
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
      ),
    );

    assert.equal(checklist.mockupsMatchColors, false);
    assert.equal(checklist.readyToPublish, false);
  });

  it("accepts local cached media when the original source is a real Printify URL", async () => {
    const checklist = await buildChecklist(
      legacyDraftWithMockups(
        makeImages([
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
      ),
    );

    assert.equal(checklist.mockupsMatchColors, true);
    assert.equal(checklist.readyToPublish, true);
  });

  it("marks contentComplete when only title is provided (description and tags optional)", async () => {
    const checklist = await buildChecklist(
      legacyDraftWithMockups(
        makeImages([
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
        ]),
      ),
    );

    // Override aiContent to only have title
    const draft = legacyDraftWithMockups(
      makeImages([
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
      ]),
    );
    draft.aiContent = { title: "My Product" } as typeof draft.aiContent;
    const titleOnlyChecklist = await buildChecklist(draft);
    assert.equal(titleOnlyChecklist.contentComplete, true);
    assert.equal(titleOnlyChecklist.readyToPublish, true);
  });
});
