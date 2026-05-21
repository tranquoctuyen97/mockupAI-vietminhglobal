import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTemplateReadyForDefault,
  pickNextReadyDefaultTemplate,
  shouldCreateTemplateAsDefault,
  TemplateNotReadyError,
} from "./store-service";

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
    id: "tpl_1",
    printifyBlueprintId: 1,
    printifyPrintProviderId: 2,
    enabledVariantIds: [101],
    defaultPlacement: placement,
    colors: [{ id: "tc_1" }],
    ...overrides,
  };
}

describe("default template service guards", () => {
  it("blocks incomplete templates", () => {
    assert.throws(
      () =>
        assertTemplateReadyForDefault(
          template({
            enabledVariantIds: [],
            defaultPlacement: null,
            colors: [],
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof TemplateNotReadyError);
        assert.deepEqual(error.missing, ["variants", "colors", "placement"]);
        return true;
      },
    );
  });

  it("allows ready templates", () => {
    assert.doesNotThrow(() => assertTemplateReadyForDefault(template()));
  });

  it("does not auto-default first incomplete template", () => {
    assert.equal(
      shouldCreateTemplateAsDefault(0, template({ enabledVariantIds: [] })),
      false,
    );
  });

  it("auto-defaults first ready template", () => {
    assert.equal(shouldCreateTemplateAsDefault(0, template()), true);
  });

  it("does not auto-default later ready templates", () => {
    assert.equal(shouldCreateTemplateAsDefault(1, template()), false);
  });

  it("promotes the first ready template after deleting a default", () => {
    const next = pickNextReadyDefaultTemplate([
      template({ id: "incomplete", enabledVariantIds: [] }),
      template({ id: "ready" }),
    ]);

    assert.equal(next?.id, "ready");
  });
});
