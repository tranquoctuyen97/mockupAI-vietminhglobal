import { normalizeCompositeRegionPx, type CompositeRegionPx } from "@/lib/mockup/custom-library";

export type CompositeRenderMode = "COMPOSITE";
export type MockupLibraryViewValue = "front" | "back" | "sleeve_left" | "sleeve_right" | "detail" | "lifestyle";
export type MockupLibrarySceneValue = "flat_lay" | "hanging" | "lifestyle" | "model" | "detail";

const MOCKUP_LIBRARY_VIEWS = new Set<MockupLibraryViewValue>(["front", "back", "sleeve_left", "sleeve_right", "detail", "lifestyle"]);
const MOCKUP_LIBRARY_SCENES = new Set<MockupLibrarySceneValue>(["flat_lay", "hanging", "lifestyle", "model", "detail"]);

export type TemplateMockupMatchItem = {
  id: string;
  appliesToColorIds: unknown;
  isPrimary: boolean;
  sortOrder: number;
  createdAt: Date;
};

export function normalizeCompositeRenderMode(value: unknown): CompositeRenderMode | null {
  if (value == null || value === "") return "COMPOSITE";
  return value === "COMPOSITE" ? "COMPOSITE" : null;
}

export function normalizeMockupLibraryView(value: unknown): MockupLibraryViewValue | null {
  return typeof value === "string" && MOCKUP_LIBRARY_VIEWS.has(value as MockupLibraryViewValue)
    ? (value as MockupLibraryViewValue)
    : null;
}

export function normalizeMockupLibraryScene(value: unknown): MockupLibrarySceneValue | null {
  return typeof value === "string" && MOCKUP_LIBRARY_SCENES.has(value as MockupLibrarySceneValue)
    ? (value as MockupLibrarySceneValue)
    : null;
}

export function buildSmartFitCompositeRegion(imageWidth: number, imageHeight: number): CompositeRegionPx {
  const side = Math.max(1, Math.round(Math.min(imageWidth, imageHeight) * 0.625));
  return {
    x: Math.max(0, Math.round((imageWidth - side) / 2)),
    y: Math.max(0, Math.round((imageHeight - side) / 2)),
    width: side,
    height: side,
    rotationDeg: 0,
    imageWidth,
    imageHeight,
  };
}

export function normalizeAppliesToColorIds(value: unknown, validColorIds: Set<string>): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || !validColorIds.has(raw)) return null;
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

export function readAppliesToColorIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function chooseTemplateMockupsForColor<T extends TemplateMockupMatchItem>(items: T[], colorId: string): T[] {
  const sorted = [...items].sort(compareTemplateMockupItems);
  const exact = sorted.filter((item) => readAppliesToColorIds(item.appliesToColorIds).includes(colorId));
  if (exact.length > 0) return exact;
  return sorted.filter((item) => readAppliesToColorIds(item.appliesToColorIds).length === 0);
}

export function compareTemplateMockupItems(a: TemplateMockupMatchItem, b: TemplateMockupMatchItem): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const created = a.createdAt.getTime() - b.createdAt.getTime();
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}

export function resolveLibraryCompositeRegion(params: {
  draftOverride: unknown;
  libraryRegion: unknown;
  imageWidth: number;
  imageHeight: number;
}): CompositeRegionPx {
  return (
    normalizeCompositeRegionPx(params.draftOverride) ??
    normalizeCompositeRegionPx(params.libraryRegion) ??
    buildSmartFitCompositeRegion(params.imageWidth, params.imageHeight)
  );
}
