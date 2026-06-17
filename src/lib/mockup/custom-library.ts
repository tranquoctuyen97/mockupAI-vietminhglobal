import type { Prisma } from "@prisma/client";
import { getStorage } from "@/lib/storage/local-disk";

export const CUSTOM_MOCKUP_VIEWS = [
  "front",
  "back",
  "sleeve_left",
  "sleeve_right",
  "detail",
  "lifestyle",
] as const;

export const CUSTOM_MOCKUP_SCENES = [
  "flat_lay",
  "hanging",
  "lifestyle",
  "model",
  "detail",
] as const;

export const CUSTOM_RENDER_MODES = ["FINAL", "COMPOSITE"] as const;

export type CustomMockupViewValue = (typeof CUSTOM_MOCKUP_VIEWS)[number];
export type CustomMockupSceneValue = (typeof CUSTOM_MOCKUP_SCENES)[number];
export type CustomRenderModeValue = (typeof CUSTOM_RENDER_MODES)[number];

export interface CompositeRegionPx {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  imageWidth?: number;
  imageHeight?: number;
}

export function isCustomMockupView(value: unknown): value is CustomMockupViewValue {
  return typeof value === "string" && CUSTOM_MOCKUP_VIEWS.includes(value as CustomMockupViewValue);
}

export function isCustomMockupScene(value: unknown): value is CustomMockupSceneValue {
  return typeof value === "string" && CUSTOM_MOCKUP_SCENES.includes(value as CustomMockupSceneValue);
}

export function isCustomRenderMode(value: unknown): value is CustomRenderModeValue {
  return typeof value === "string" && CUSTOM_RENDER_MODES.includes(value as CustomRenderModeValue);
}

export function parseCompositeRegionPx(value: unknown): CompositeRegionPx | null {
  if (!value) return null;

  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<CompositeRegionPx>;
  const region: CompositeRegionPx = {
    x: Number(candidate.x),
    y: Number(candidate.y),
    width: Number(candidate.width),
    height: Number(candidate.height),
    rotationDeg: Number(candidate.rotationDeg ?? 0),
  };
  const imageWidth = Number(candidate.imageWidth);
  const imageHeight = Number(candidate.imageHeight);

  if (
    !Number.isInteger(region.x) ||
    !Number.isInteger(region.y) ||
    !Number.isInteger(region.width) ||
    !Number.isInteger(region.height) ||
    !Number.isFinite(region.rotationDeg) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    region.rotationDeg < -360 ||
    region.rotationDeg > 360
  ) {
    return null;
  }

  if (candidate.imageWidth !== undefined || candidate.imageHeight !== undefined) {
    if (
      !Number.isInteger(imageWidth) ||
      !Number.isInteger(imageHeight) ||
      imageWidth < 1 ||
      imageHeight < 1
    ) {
      return null;
    }
    // Validate region stays within image bounds
    if (
      region.x + region.width > imageWidth ||
      region.y + region.height > imageHeight
    ) {
      return null;
    }
    region.imageWidth = imageWidth;
    region.imageHeight = imageHeight;
  }

  return region;
}

/**
 * Validate placement JSON structure + finite numeric fields.
 * Relaxed validation: allows negative x/y (valid for manual placement).
 * Does NOT enforce print-area bounds.
 * Used for placementsBySourceId in PUT mockup-library-picks.
 */
export function isValidCompositeRegionPx(value: unknown): value is CompositeRegionPx {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.x === "number" && Number.isFinite(r.x) &&
    typeof r.y === "number" && Number.isFinite(r.y) &&
    typeof r.width === "number" && Number.isFinite(r.width) && r.width > 0 &&
    typeof r.height === "number" && Number.isFinite(r.height) && r.height > 0 &&
    typeof r.imageWidth === "number" && Number.isFinite(r.imageWidth) && r.imageWidth > 0 &&
    typeof r.imageHeight === "number" && Number.isFinite(r.imageHeight) && r.imageHeight > 0
  );
}

/**
 * Normalize + validate placement JSON.
 * Returns canonical CompositeRegionPx with rotationDeg defaulted to 0.
 * Returns null if structure invalid.
 * Server must save normalized output, not raw client JSON.
 */
export function normalizeCompositeRegionPx(value: unknown): CompositeRegionPx | null {
  if (!isValidCompositeRegionPx(value)) return null;
  const r = value as unknown as Record<string, unknown>;
  return {
    x: r.x as number,
    y: r.y as number,
    width: r.width as number,
    height: r.height as number,
    rotationDeg:
      typeof r.rotationDeg === "number" && Number.isFinite(r.rotationDeg)
        ? r.rotationDeg as number
        : 0,
    imageWidth: r.imageWidth as number,
    imageHeight: r.imageHeight as number,
  };
}

export function toJson(value: CompositeRegionPx | null): Prisma.InputJsonValue | undefined {
  return value ? (value as unknown as Prisma.InputJsonValue) : undefined;
}

export function scaleCompositeRegionToImage(
  region: CompositeRegionPx,
  imageWidth: number,
  imageHeight: number,
): CompositeRegionPx {
  if (
    !region.imageWidth ||
    !region.imageHeight ||
    (region.imageWidth === imageWidth && region.imageHeight === imageHeight)
  ) {
    return { ...region, imageWidth, imageHeight };
  }

  const scaleX = imageWidth / region.imageWidth;
  const scaleY = imageHeight / region.imageHeight;
  return {
    x: Math.round(region.x * scaleX),
    y: Math.round(region.y * scaleY),
    width: Math.max(1, Math.round(region.width * scaleX)),
    height: Math.max(1, Math.round(region.height * scaleY)),
    rotationDeg: region.rotationDeg,
    imageWidth,
    imageHeight,
  };
}

/**
 * Resolve the effective composite region by merging source and pick placements.
 * Pure function — callers are responsible for fetching pick data from the DB.
 *
 * Precedence:
 *   DRAFT:    sourceRegion > pickRegion > templateDefaultRegion > null
 *   TEMPLATE: pickRegion > sourceRegion > templateDefaultRegion > null
 *
 * This mirrors the logic in GET mockup-sources serializeWithPickPlacement()
 * and MUST be used by any code path that reads placement for rendering.
 */
export function resolveEffectiveCompositeRegion(params: {
  scope: "DRAFT" | "TEMPLATE";
  sourceRegion: unknown;
  pickRegion: unknown;
  templateDefaultRegion?: unknown;
  imageSize?: { width: number; height: number };
}): CompositeRegionPx | null {
  const parsedSource = parseCompositeRegionPx(params.sourceRegion);
  const parsedPick = parseCompositeRegionPx(params.pickRegion);
  const parsedTemplateDefault = parseCompositeRegionPx(params.templateDefaultRegion);

  const resolved =
    params.scope === "DRAFT"
      ? parsedSource ?? parsedPick ?? parsedTemplateDefault
      : parsedPick ?? parsedSource ?? parsedTemplateDefault;

  if (!resolved || !params.imageSize) return resolved;
  return scaleCompositeRegionToImage(resolved, params.imageSize.width, params.imageSize.height);
}

export function storageUrl(key: string | null | undefined): string | null {
  return key ? getStorage().getPublicUrl(key) : null;
}

export function serializeCustomMockupSource<T extends {
  storagePath: string;
  outputPath: string | null;
  compositeRegionPx?: unknown;
}>(source: T, dimensions?: { width: number | null; height: number | null }) {
  const compositeRegion = source.compositeRegionPx && typeof source.compositeRegionPx === "object"
    ? source.compositeRegionPx as Partial<CompositeRegionPx>
    : null;
  return {
    ...source,
    imageUrl: storageUrl(source.storagePath),
    outputUrl: storageUrl(source.outputPath),
    imageWidth: dimensions?.width ?? compositeRegion?.imageWidth ?? null,
    imageHeight: dimensions?.height ?? compositeRegion?.imageHeight ?? null,
  };
}
