/**
 * Listing-ready default artwork placement.
 *
 * IMPORTANT: This does NOT change the Printify print area (the maximum printable
 * boundary from the blueprint/print provider). It only computes a smaller, well
 * positioned default *artwork* placement *inside* that print area, so an uploaded
 * design lands at a listing-ready size/position without manual adjustment.
 *
 * All spatial values are millimeters (mm). `xMm`/`yMm` are the TOP-LEFT corner of
 * the artwork (matching the rest of the placement model + `mmToPrintifyCoords`).
 */

import { DEFAULT_PLACEMENT, type Placement, type PrintArea, type ViewKey } from "./types";

export interface PlacementProfile {
  /** Artwork width as a fraction of the print-area width (0..1). */
  widthRatio: number;
  /** Artwork vertical center as a fraction of the print-area height (0..1). */
  centerYRatio: number;
}

export interface PlacementDesignSize {
  widthPx: number;
  heightPx: number;
}

/** Canonical product-type keys we tune profiles for. */
export type ProductTypeKey = "T-Shirt" | "Hoodie" | "Sweatshirt";

/**
 * Per product-type, per-view default placement ratios. Front views are tuned so
 * the artwork sits around the chest (centerYRatio < 0.5) at a listing-ready size.
 */
export const DEFAULT_PLACEMENT_PROFILE: Record<
  ProductTypeKey,
  Partial<Record<ViewKey, PlacementProfile>>
> = {
  "T-Shirt": {
    front: { widthRatio: 0.48, centerYRatio: 0.43 },
    back: { widthRatio: 0.55, centerYRatio: 0.45 },
  },
  Hoodie: {
    front: { widthRatio: 0.44, centerYRatio: 0.45 },
    back: { widthRatio: 0.52, centerYRatio: 0.45 },
  },
  Sweatshirt: {
    front: { widthRatio: 0.46, centerYRatio: 0.44 },
    back: { widthRatio: 0.54, centerYRatio: 0.45 },
  },
};

/** Used when the product type and/or view has no tuned profile. */
export const FALLBACK_PLACEMENT_PROFILE: PlacementProfile = {
  widthRatio: 0.47,
  centerYRatio: 0.44,
};

export interface ProductTypeInput {
  productType?: string | null;
  blueprintTitle?: string | null;
  blueprintBrand?: string | null;
}

/**
 * Soft product-type inference. Prefers an explicit product type, then falls back
 * to keyword matching against the blueprint title/brand. Returns `null` when
 * nothing recognizable is found (callers should use the fallback profile).
 */
export function resolveProductType(input: ProductTypeInput): ProductTypeKey | null {
  const haystack = [input.productType, input.blueprintTitle, input.blueprintBrand]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!haystack) return null;

  // Order matters: check more specific garments before the generic "shirt".
  if (/\bhoodie\b|\bhooded\b|\bpullover hood\b/.test(haystack)) return "Hoodie";
  if (/\bsweat\s?shirt\b|\bcrewneck\b|\bcrew neck\b/.test(haystack)) return "Sweatshirt";
  if (/\bt-?shirt\b|\btee\b|\bshirt\b/.test(haystack)) return "T-Shirt";

  return null;
}

/**
 * Resolve the placement profile for a template + view. Falls back gracefully:
 * explicit product type → blueprint keywords → view default → global fallback.
 */
export function resolvePlacementProfile(input: ProductTypeInput, view: ViewKey): PlacementProfile {
  const productType = resolveProductType(input);
  const byType = productType ? DEFAULT_PLACEMENT_PROFILE[productType] : undefined;
  return byType?.[view] ?? FALLBACK_PLACEMENT_PROFILE;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Clamp a placement so it stays fully inside the print area (respecting the safe
 * margin). If the artwork is larger than the usable area it is scaled down while
 * preserving its aspect ratio, then re-centered on its original center.
 */
export function clampPlacementToPrintArea(placement: Placement, printArea: PrintArea): Placement {
  const margin = Math.max(0, printArea.safeMarginMm);
  const usableWidth = Math.max(0, printArea.widthMm - 2 * margin);
  const usableHeight = Math.max(0, printArea.heightMm - 2 * margin);

  // Original center, so we can re-center after any shrink.
  const centerX = placement.xMm + placement.widthMm / 2;
  const centerY = placement.yMm + placement.heightMm / 2;

  let width = placement.widthMm;
  let height = placement.heightMm;

  // Shrink (preserve aspect) if the artwork exceeds the usable area.
  const widthScale = usableWidth > 0 && width > usableWidth ? usableWidth / width : 1;
  const heightScale = usableHeight > 0 && height > usableHeight ? usableHeight / height : 1;
  const shrink = Math.min(widthScale, heightScale);
  if (shrink < 1) {
    width = width * shrink;
    height = height * shrink;
  }

  // Re-center, then clamp the top-left corner within the margins.
  const minX = margin;
  const minY = margin;
  const maxX = Math.max(margin, printArea.widthMm - margin - width);
  const maxY = Math.max(margin, printArea.heightMm - margin - height);

  const xMm = Math.min(Math.max(centerX - width / 2, minX), maxX);
  const yMm = Math.min(Math.max(centerY - height / 2, minY), maxY);

  return {
    ...placement,
    xMm: round2(xMm),
    yMm: round2(yMm),
    widthMm: round2(width),
    heightMm: round2(height),
  };
}

export interface BuildDefaultPlacementInput {
  printArea: PrintArea;
  design: PlacementDesignSize;
  profile: PlacementProfile;
}

/**
 * Build a listing-ready default placement from a ratio profile + design size.
 *
 * - Artwork width = printArea.widthMm * profile.widthRatio.
 * - Height derived from the design aspect ratio (preserve aspect).
 * - Horizontally centered; vertical center = printArea.heightMm * centerYRatio.
 * - Converted to TOP-LEFT coordinates and clamped inside the print area.
 *
 * Because x/y/scale are ratios of the print area, `mmToPrintifyCoords` yields
 * x ≈ 0.5, y ≈ centerYRatio, scale ≈ widthRatio when the same print area is used.
 */
export function buildDefaultPlacementFromRatio(input: BuildDefaultPlacementInput): Placement {
  const { printArea, design, profile } = input;

  const designAspect =
    design.widthPx > 0 && design.heightPx > 0 ? design.widthPx / design.heightPx : 1;

  const widthMm = printArea.widthMm * profile.widthRatio;
  const heightMm = widthMm / designAspect;

  const centerX = printArea.widthMm / 2;
  const centerY = printArea.heightMm * profile.centerYRatio;

  const placement: Placement = {
    ...DEFAULT_PLACEMENT,
    xMm: centerX - widthMm / 2,
    yMm: centerY - heightMm / 2,
    widthMm,
    heightMm,
    rotationDeg: 0,
    lockAspect: true,
    placementMode: "preserve",
    mirrored: false,
    presetKey: undefined,
  };

  return clampPlacementToPrintArea(placement, printArea);
}
