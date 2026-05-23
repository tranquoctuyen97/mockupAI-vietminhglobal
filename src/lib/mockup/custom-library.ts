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
    region.imageWidth = imageWidth;
    region.imageHeight = imageHeight;
  }

  return region;
}

export function toJson(value: CompositeRegionPx | null): Prisma.InputJsonValue | undefined {
  return value ? (value as unknown as Prisma.InputJsonValue) : undefined;
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
