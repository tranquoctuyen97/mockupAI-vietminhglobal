import assert from "node:assert/strict";
import test from "node:test";
import {
  getTemplateReadiness,
  getTemplateReadinessLabel,
  TEMPLATE_MISSING_LABELS,
} from "./template-readiness";

const placement = {
  version: "2.1",
  variants: {
    _default: {
      front: {
        xMm: 77.8,
        yMm: 78.2,
        widthMm: 200,
        heightMm: 250,
        rotationDeg: 0,
        lockAspect: true,
        mirrored: false,
        placementMode: "preserve",
      },
    },
  },
};

function template(overrides: Record<string, unknown> = {}) {
  return {
    printifyBlueprintId: 12,
    printifyPrintProviderId: 34,
    enabledVariantIds: [101],
    defaultPlacement: placement,
    colors: [{ id: "tc_1" }],
    isDefault: false,
    ...overrides,
  };
}

test("getTemplateReadiness returns ready for a runnable template", () => {
  assert.deepEqual(getTemplateReadiness(template()), {
    ready: true,
    missing: [],
  });
});

test("getTemplateReadiness reports every missing setup item", () => {
  assert.deepEqual(
    getTemplateReadiness(
      template({
        printifyBlueprintId: 0,
        printifyPrintProviderId: 0,
        enabledVariantIds: [],
        defaultPlacement: null,
        colors: [],
      }),
    ),
    {
      ready: false,
      missing: ["blueprint", "provider", "variants", "colors", "placement"],
    },
  );
});

test("getTemplateReadiness does not count fallback front placement", () => {
  assert.deepEqual(
    getTemplateReadiness(template({ defaultPlacement: { version: "2.1", variants: {} } })),
    {
      ready: false,
      missing: ["placement"],
    },
  );
});

test("getTemplateReadinessLabel distinguishes default incomplete from default ready", () => {
  assert.equal(getTemplateReadinessLabel(template({ isDefault: true })), "DEFAULT");
  assert.equal(
    getTemplateReadinessLabel(template({ isDefault: true, enabledVariantIds: [] })),
    "DEFAULT INCOMPLETE",
  );
  assert.equal(getTemplateReadinessLabel(template({ isDefault: false })), "READY");
  assert.equal(
    getTemplateReadinessLabel(template({ isDefault: false, colors: [] })),
    "INCOMPLETE",
  );
});

test("TEMPLATE_MISSING_LABELS has stable user-facing labels", () => {
  assert.equal(TEMPLATE_MISSING_LABELS.blueprint, "Blueprint");
  assert.equal(TEMPLATE_MISSING_LABELS.provider, "Provider");
  assert.equal(TEMPLATE_MISSING_LABELS.variants, "Variants");
  assert.equal(TEMPLATE_MISSING_LABELS.colors, "Colors");
  assert.equal(TEMPLATE_MISSING_LABELS.placement, "Placement");
  assert.equal(TEMPLATE_MISSING_LABELS.mockups, "Mockups");
});

test("getTemplateReadiness accepts Prisma include colors shape", () => {
  const readiness = getTemplateReadiness(
    template({
      colors: [
        {
          id: "template_color_1",
          color: { id: "color_1", name: "Black", hex: "#000000" },
        },
      ],
    }),
  );

  assert.equal(readiness.ready, true);
});

test("custom templates use mockup coverage instead of template placement", () => {
  assert.deepEqual(
    getTemplateReadiness(
      template({
        defaultMockupSource: "CUSTOM",
        defaultPlacement: null,
        colors: [
          { colorId: "navy", color: { id: "navy", name: "Navy" } },
          { colorId: "red", color: { id: "red", name: "Red" } },
        ],
        mockupItems: [
          {
            appliesToColorIds: ["navy"],
            mockup: {
              renderMode: "COMPOSITE",
              compositeRegionPx: { x: 1, y: 1, width: 10, height: 10, imageWidth: 20, imageHeight: 20 },
            },
          },
          {
            appliesToColorIds: ["red"],
            mockup: {
              renderMode: "COMPOSITE",
              compositeRegionPx: { x: 2, y: 2, width: 10, height: 10, imageWidth: 20, imageHeight: 20 },
            },
          },
        ],
      }),
    ),
    { ready: true, missing: [] },
  );
});

test("custom templates report mockups when coverage or composite region is missing", () => {
  assert.deepEqual(
    getTemplateReadiness(
      template({
        defaultMockupSource: "CUSTOM",
        defaultPlacement: null,
        colors: [{ colorId: "navy" }],
        mockupItems: [],
      }),
    ),
    { ready: false, missing: ["mockups"] },
  );

  assert.deepEqual(
    getTemplateReadiness(
      template({
        defaultMockupSource: "CUSTOM",
        defaultPlacement: null,
        colors: [{ colorId: "navy" }],
        mockupItems: [{ appliesToColorIds: ["navy"], mockup: { renderMode: "COMPOSITE", compositeRegionPx: null } }],
      }),
    ),
    { ready: false, missing: ["mockups"] },
  );
});
