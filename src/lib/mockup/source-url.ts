export type MockupSourceType =
  | {
      kind: "custom";
      scope: "template" | "draft";
      renderMode: "FINAL" | "COMPOSITE";
      sourceId: string;
    }
  | {
      kind: "library";
      templateMockupItemId: string;
      colorId: string;
    }
  | { kind: "synthetic"; view: string }
  | { kind: "printify" };

// New scope-aware URL format: mockup://custom/{scope}/{mode}/{sourceId}
const CUSTOM_PREFIX = "mockup://custom/";
// New library format: mockup://library/<templateMockupItemId>/<colorId>
const LIBRARY_PREFIX = "mockup://library/";
const SYNTHETIC_PREFIX = "mockup://solid/";

// Legacy URL prefixes (pre-rev3, treated as scope=template)
const LEGACY_CUSTOM_FINAL_PREFIX = "mockup://custom-final/";
const LEGACY_CUSTOM_COMPOSITE_PREFIX = "mockup://custom-composite/";

export function parseMockupSourceUrl(sourceUrl: string): MockupSourceType {
  // New scope-aware format: mockup://custom/{scope}/{renderMode}/{sourceId}
  if (sourceUrl.startsWith(CUSTOM_PREFIX)) {
    const remainder = sourceUrl.slice(CUSTOM_PREFIX.length);
    const parts = remainder.split("/");
    if (parts.length >= 3) {
      const scope = parts[0] as "template" | "draft";
      const mode = parts[1].toUpperCase() as "FINAL" | "COMPOSITE";
      const sourceId = parts.slice(2).join("/");
      if (
        (scope === "template" || scope === "draft") &&
        (mode === "FINAL" || mode === "COMPOSITE") &&
        sourceId
      ) {
        return { kind: "custom", scope, renderMode: mode, sourceId };
      }
    }
    // Fallback for old-format custom URLs with fewer than 3 parts
    // e.g. mockup://custom/tuyen/custom 1-Solid Forest Green-front.png
    return {
      kind: "custom",
      scope: "template",
      renderMode: "COMPOSITE",
      sourceId: remainder,
    };
  }

  // Legacy: mockup://custom-final/<id> → scope=template, renderMode=FINAL
  if (sourceUrl.startsWith(LEGACY_CUSTOM_FINAL_PREFIX)) {
    return {
      kind: "custom",
      scope: "template",
      renderMode: "FINAL",
      sourceId: sourceUrl.slice(LEGACY_CUSTOM_FINAL_PREFIX.length),
    };
  }

  // Legacy: mockup://custom-composite/<id> → scope=template, renderMode=COMPOSITE
  if (sourceUrl.startsWith(LEGACY_CUSTOM_COMPOSITE_PREFIX)) {
    return {
      kind: "custom",
      scope: "template",
      renderMode: "COMPOSITE",
      sourceId: sourceUrl.slice(LEGACY_CUSTOM_COMPOSITE_PREFIX.length),
    };
  }

  // New library format: mockup://library/<templateMockupItemId>/<colorId>
  if (sourceUrl.startsWith(LIBRARY_PREFIX)) {
    const remainder = sourceUrl.slice(LIBRARY_PREFIX.length);
    const parts = remainder.split("/");
    if (parts.length >= 2) {
      const templateMockupItemId = parts[0];
      const colorId = parts[1];
      if (templateMockupItemId && colorId) {
        return { kind: "library", templateMockupItemId, colorId };
      }
    }
  }

  if (sourceUrl.startsWith(SYNTHETIC_PREFIX)) {
    return {
      kind: "synthetic",
      view: sourceUrl.slice(SYNTHETIC_PREFIX.length) || "front",
    };
  }

  return { kind: "printify" };
}

export function buildCustomMockupSourceUrl(
  sourceId: string,
  scope: "TEMPLATE" | "DRAFT",
  renderMode: "FINAL" | "COMPOSITE",
): string {
  return `mockup://custom/${scope.toLowerCase()}/${renderMode.toLowerCase()}/${sourceId}`;
}

export function buildLibraryMockupUrl(templateMockupItemId: string, colorId: string): string {
  return `mockup://library/${templateMockupItemId}/${colorId}`;
}
