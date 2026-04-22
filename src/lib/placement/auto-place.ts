/**
 * Auto-place design into a Printify print area.
 * Uses "contain" fit (preserves aspect ratio) and centers by default.
 * Supports optional offset overrides from StoreMockupTemplate.
 */

export interface AutoPlaceInput {
  design: { widthPx: number; heightPx: number };
  printArea: { widthMm: number; heightMm: number; safeMarginMm: number };
  override?: {
    offsetXMm?: number | null;
    offsetYMm?: number | null;
    scalePercent?: number | null;
  };
}

export interface AutoPlaceResult {
  xMm: number;      // Horizontal offset from print area center (0 = centered)
  yMm: number;      // Vertical center position from top of print area
  widthMm: number;   // Fitted width
  heightMm: number;  // Fitted height
}

/**
 * Fit design into print area safe zone, centered, with optional offset.
 *
 * Coordinate system:
 * - xMm: 0 = horizontally centered, negative = left, positive = right
 * - yMm: distance from top of print area to center of design
 */
export function autoPlace({ design, printArea, override }: AutoPlaceInput): AutoPlaceResult {
  // Safe zone = print area minus margins on each side
  const safeWidth = printArea.widthMm - 2 * printArea.safeMarginMm;
  const safeHeight = printArea.heightMm - 2 * printArea.safeMarginMm;

  // Apply scale (default 100%)
  const scale = (override?.scalePercent ?? 100) / 100;
  const targetWidth = safeWidth * scale;
  const targetHeight = safeHeight * scale;

  // Contain fit: preserve aspect ratio, fit within target area
  const designAspect = design.widthPx / design.heightPx;
  const areaAspect = targetWidth / targetHeight;

  let fitWidth: number;
  let fitHeight: number;

  if (designAspect > areaAspect) {
    // Design is wider than area → constrain by width
    fitWidth = targetWidth;
    fitHeight = targetWidth / designAspect;
  } else {
    // Design is taller than area → constrain by height
    fitHeight = targetHeight;
    fitWidth = targetHeight * designAspect;
  }

  // Center position + optional offset
  const xMm = override?.offsetXMm ?? 0;
  const yMm = (printArea.heightMm / 2) + (override?.offsetYMm ?? 0);

  return {
    xMm,
    yMm,
    widthMm: Math.round(fitWidth * 100) / 100,
    heightMm: Math.round(fitHeight * 100) / 100,
  };
}
