/**
 * Convert Placement (mm) → Printify API payload (px, scale, angle)
 * Used by Phase 7 auto-fulfill worker and placement mode POC script.
 */
import type { Placement, PlacementMode } from "./types";

export interface BlueprintPrintAreaPx {
  widthMm: number;
  heightMm: number;
  widthPx: number;   // Printify's native pixel width for this print area
  heightPx: number;
}

export interface PrintifyPlacementPayload {
  x: number;        // px from top-left origin
  y: number;        // px from top-left origin
  scale: number;    // scale ratio (1.0 = 100% of design native size)
  angle: number;    // rotation degrees
  placement?: PlacementMode; // optional Printify field
}

/**
 * Convert our mm-based placement → Printify API payload.
 *
 * Printify coordinate system:
 *   - Origin: top-left of print area
 *   - x/y: center of the placed design image
 *
 * @param placement  The placement object (mm-based, center-anchored)
 * @param printAreaPx  Blueprint print area with both mm and px dimensions
 * @param designPx   Original design pixel dimensions
 */
export function toPrintifyPayload(
  placement: Placement,
  printAreaPx: BlueprintPrintAreaPx,
  designPx: { width: number; height: number },
): PrintifyPlacementPayload {
  const pxPerMm = printAreaPx.widthPx / printAreaPx.widthMm;

  // Our xMm is relative to center of print area.
  // Printify x is from top-left, measured to center of design.
  const x = Math.round(printAreaPx.widthPx / 2 + placement.xMm * pxPerMm);
  // Our yMm is relative to top of print area (y=0 = top edge).
  const y = Math.round(placement.yMm * pxPerMm);

  // Scale = how much to scale the original design image so its width = placement.widthMm in px
  const placementWidthPx = placement.widthMm * pxPerMm;
  const scale = placementWidthPx / designPx.width;

  return {
    x,
    y,
    scale: Math.round(scale * 10000) / 10000, // 4 decimal places
    angle: placement.rotationDeg,
    placement: placement.placementMode,
  };
}

/**
 * Reverse: Printify payload → mm Placement (for import/sync).
 * Useful when syncing back from Printify product data.
 */
export function fromPrintifyPayload(
  payload: PrintifyPlacementPayload,
  printAreaPx: BlueprintPrintAreaPx,
  designPx: { width: number; height: number },
): Partial<Placement> {
  const mmPerPx = printAreaPx.widthMm / printAreaPx.widthPx;

  const xMm = (payload.x - printAreaPx.widthPx / 2) * mmPerPx;
  const yMm = payload.y * mmPerPx;
  const widthMm = payload.scale * designPx.width * mmPerPx;
  const heightMm = (widthMm / designPx.width) * designPx.height;

  return {
    xMm: Math.round(xMm * 100) / 100,
    yMm: Math.round(yMm * 100) / 100,
    widthMm: Math.round(widthMm * 100) / 100,
    heightMm: Math.round(heightMm * 100) / 100,
    rotationDeg: payload.angle,
    placementMode: payload.placement ?? "preserve",
  };
}
