/**
 * Print area math & bad-region detection for Custom Composite Mockup placement.
 *
 * Single source of truth for:
 *   - Converting mm print-area dimensions → centered pixel bounds
 *   - Computing placement regions (Smart Fit, Max Fit, Logo)
 *   - Detecting legacy/bad regions that should be replaced
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Millimeter dimensions from DB printAreasByView */
export interface PrintAreaMm {
  widthMm: number;
  heightMm: number;
}

/** Pixel bounds on a mockup image (compatible with CanvasPlacementEditor.PrintAreaBounds) */
export interface PrintAreaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A raw region (no imageWidth/imageHeight — compatible with CustomCompositeRegion) */
export interface RawRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Print Area Computation ───────────────────────────────────────────────────

/**
 * Compute derived print-area pixel bounds from mm dimensions, centered on the image.
 *
 * ⚠️ This is a **derived/centered approximation**. The DB only stores {widthMm, heightMm}
 * without positional offsets, so we cannot know the exact print-area position on the
 * mockup photo — only the aspect ratio. We center it and cap at 80 % of the image.
 */
export function computeCustomPrintAreaPx(
  printAreaMm: PrintAreaMm,
  imageWidth: number,
  imageHeight: number,
): PrintAreaBounds {
  const aspect = printAreaMm.widthMm / printAreaMm.heightMm;
  const maxW = imageWidth * 0.8;
  const maxH = imageHeight * 0.8;

  let w: number;
  let h: number;
  if (aspect > maxW / maxH) {
    w = Math.round(maxW);
    h = Math.round(w / aspect);
  } else {
    h = Math.round(maxH);
    w = Math.round(h * aspect);
  }

  return {
    x: Math.round((imageWidth - w) / 2),
    y: Math.round((imageHeight - h) / 2),
    width: w,
    height: h,
  };
}

// ─── Region Computation ────────────────────────────────────────────────────────

/**
 * Smart Fit — listing-ready default placement.
 * Design ~48 % of print-area width, capped at 55 % height, centered at upper-chest.
 */
export function computeListingReadyRegion(
  printArea: PrintAreaBounds,
  designW: number,
  designH: number,
): RawRegion {
  const widthRatio = 0.48;
  const centerYRatio = 0.43;
  const maxHeightRatio = 0.55;

  const designAspect = designW / Math.max(1, designH);

  let width = Math.round(printArea.width * widthRatio);
  let height = Math.round(width / designAspect);

  // Guard for tall / portrait designs — cap height so it doesn't overflow the print area
  const maxHeight = Math.round(printArea.height * maxHeightRatio);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * designAspect);
  }

  const x = Math.round(printArea.x + (printArea.width - width) / 2);
  const y = Math.round(printArea.y + printArea.height * centerYRatio - height / 2);

  return clampRawRegion({ x, y, width, height }, printArea);
}

/**
 * Max Fit — fill the print area as much as possible while preserving aspect ratio.
 * Only used when the user explicitly clicks "Max Fit".
 */
export function computeFitRegion(
  printArea: PrintAreaBounds,
  designW: number,
  designH: number,
): RawRegion {
  const designAspect = designW / Math.max(1, designH);
  const areaAspect = printArea.width / Math.max(1, printArea.height);

  let w: number;
  let h: number;
  if (designAspect > areaAspect) {
    w = printArea.width;
    h = Math.round(w / designAspect);
  } else {
    h = printArea.height;
    w = Math.round(h * designAspect);
  }

  return clampRawRegion(
    {
      x: Math.round(printArea.x + (printArea.width - w) / 2),
      y: Math.round(printArea.y + (printArea.height - h) / 2),
      width: w,
      height: h,
    },
    printArea,
  );
}

/**
 * Logo — small left-chest placement.
 * 18 % print-area width, offset left of center, at ~30 % from top.
 */
export function computeLogoRegion(
  printArea: PrintAreaBounds,
  designW: number,
  designH: number,
): RawRegion {
  const widthRatio = 0.18;
  const centerYRatio = 0.30;
  const centerXShiftRatio = -0.16;
  const maxHeightRatio = 0.25;

  const designAspect = designW / Math.max(1, designH);

  let width = Math.round(printArea.width * widthRatio);
  let height = Math.round(width / designAspect);

  // Guard for tall / portrait logo designs
  const maxHeight = Math.round(printArea.height * maxHeightRatio);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * designAspect);
  }

  const centerX =
    printArea.x + printArea.width / 2 + printArea.width * centerXShiftRatio;
  const centerY = printArea.y + printArea.height * centerYRatio;

  return clampRawRegion(
    {
      x: Math.round(centerX - width / 2),
      y: Math.round(centerY - height / 2),
      width,
      height,
    },
    printArea,
  );
}

// ─── Bad-Region Detection ─────────────────────────────────────────────────────

/**
 * True when the region extends beyond the print-area boundary on any side.
 */
export function isOutOfBounds(
  region: RawRegion,
  printArea: PrintAreaBounds,
): boolean {
  return (
    region.x < printArea.x ||
    region.y < printArea.y ||
    region.x + region.width > printArea.x + printArea.width ||
    region.y + region.height > printArea.y + printArea.height
  );
}

/**
 * True when the region fills almost the entire print area (legacy max-fit bug).
 * Uses AND (not OR) so intentional Max Fit (wide but not tall) is not flagged.
 */
export function isLikelyLegacyHugeRegion(
  region: { width: number; height: number },
  printArea: { width: number; height: number },
): boolean {
  return (
    region.width / printArea.width >= 0.95 &&
    region.height / printArea.height >= 0.90
  );
}

/**
 * True when the region should be rejected and replaced with Smart Fit.
 * Catches both legacy huge regions and out-of-bounds placements.
 */
export function isBadCompositeRegion(
  region: RawRegion,
  printArea: PrintAreaBounds,
): boolean {
  return (
    isOutOfBounds(region, printArea) ||
    isLikelyLegacyHugeRegion(region, printArea)
  );
}

/**
 * True when the region is a sentinel (0,0,w,h) — not a real placement.
 */
export function isSentinelRegion(
  region: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): boolean {
  return (
    region.x === 0 &&
    region.y === 0 &&
    region.width === imageWidth &&
    region.height === imageHeight
  );
}

// ─── Clamping ──────────────────────────────────────────────────────────────────

/**
 * Clamp a raw region so it stays completely within the print-area bounds.
 */
export function clampRawRegion(
  region: RawRegion,
  printArea: PrintAreaBounds,
): RawRegion {
  const x = Math.max(printArea.x, Math.min(region.x, printArea.x + printArea.width - region.width));
  const y = Math.max(printArea.y, Math.min(region.y, printArea.y + printArea.height - region.height));
  return { x, y, width: region.width, height: region.height };
}

/**
 * Clamp a region to the print area (or full image when printArea is null).
 * When printArea is null, clamps within [0, imgW] and [0, imgH] — no negative coords.
 */
export function clampRegionToPrintArea(
  region: RawRegion,
  printArea: PrintAreaBounds | null,
  imageWidth: number,
  imageHeight: number,
): RawRegion {
  const bounds = printArea ?? { x: 0, y: 0, width: imageWidth, height: imageHeight };
  return clampRawRegion(region, bounds);
}
