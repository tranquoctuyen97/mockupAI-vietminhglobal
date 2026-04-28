import {
  DEFAULT_PLACEMENT,
  type Placement,
  type PlacementData,
  type ViewKey,
  VIEW_KEYS,
} from "../placement/types";
import { resolvePlacement } from "../placement/resolver";

export interface MockupPlanColor {
  id: string;
  name: string;
  hex: string;
  printifyColorId?: string | null;
}

export interface MockupPlanVariant {
  id: number;
  title: string;
  options?: Record<string, string | undefined> | null;
}

export interface BuildMockupImagePlanInput {
  selectedColorIds: string[];
  storeColors: MockupPlanColor[];
  enabledVariantIds: number[];
  variants: MockupPlanVariant[];
  placementData?: PlacementData | null;
}

export interface PlannedMockupImage {
  printifyMockupId: string;
  variantId: number;
  colorName: string;
  colorHex: string;
  viewPosition: ViewKey;
  sourceUrl: string;
  placement: Placement;
  sortOrder: number;
}

export class MockupPlanningError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MockupPlanningError";
    this.status = status;
  }
}

export function buildMockupImagePlan(
  input: BuildMockupImagePlanInput,
): PlannedMockupImage[] {
  const selectedColors = resolveSelectedColors(
    input.selectedColorIds,
    input.storeColors,
  );
  if (selectedColors.length === 0) {
    throw new MockupPlanningError("No colors selected");
  }

  if (input.enabledVariantIds.length === 0) {
    throw new MockupPlanningError("No enabled variants");
  }

  if (input.variants.length === 0) {
    throw new MockupPlanningError("No Printify variants available", 502);
  }

  const enabledVariantSet = new Set(input.enabledVariantIds);
  const views = resolvePlacementViews(input.placementData);
  const images: PlannedMockupImage[] = [];

  for (const color of selectedColors) {
    const representative = input.variants.find(
      (variant) => enabledVariantSet.has(variant.id) && variantMatchesColor(variant, color),
    );

    if (!representative) {
      throw new MockupPlanningError(
        `No enabled Printify variant matches selected color "${color.name}"`,
      );
    }

    for (const view of views) {
      images.push({
        printifyMockupId: `solid-${view}-${representative.id}`,
        variantId: representative.id,
        colorName: color.name,
        colorHex: color.hex,
        viewPosition: view,
        sourceUrl: `mockup://solid/${view}`,
        placement: input.placementData
          ? resolvePlacement(input.placementData, view) ?? DEFAULT_PLACEMENT
          : DEFAULT_PLACEMENT,
        sortOrder: images.length,
      });
    }
  }

  return images;
}

export function resolveEffectivePlacementData(
  placementOverride: unknown,
  defaultPlacement: unknown,
): PlacementData | null {
  return coercePlacementData(placementOverride) ?? coercePlacementData(defaultPlacement);
}

export function resolvePlacementViews(placementData?: PlacementData | null): ViewKey[] {
  if (!placementData) return ["front"];

  const configuredViews = VIEW_KEYS.filter((view) =>
    Boolean(resolvePlacement(placementData, view)),
  );

  return configuredViews.length > 0 ? configuredViews : ["front"];
}

function resolveSelectedColors(
  selectedColorIds: string[],
  storeColors: MockupPlanColor[],
): MockupPlanColor[] {
  const selected = new Set(selectedColorIds);
  return storeColors.filter((color) => selected.has(color.id));
}

function variantMatchesColor(
  variant: MockupPlanVariant,
  color: MockupPlanColor,
): boolean {
  const variantColor = variant.options?.color ?? "";
  const variantKeys = new Set([
    normalizeColorKey(variantColor),
    normalizeColorKey(variant.title),
  ]);

  return [
    color.printifyColorId,
    color.name,
  ].some((value) => value && variantKeys.has(normalizeColorKey(value)));
}

function normalizeColorKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function coercePlacementData(value: unknown): PlacementData | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PlacementData>;
  if (!candidate.variants || typeof candidate.variants !== "object") return null;
  return candidate as PlacementData;
}
