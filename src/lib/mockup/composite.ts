/**
 * Mockup composite engine using sharp
 * Creates product mockup: colored background + design overlay (v1)
 * OR overlays design onto actual printify mockup image (v2)
 */

import sharp from "sharp";
import { SHARP_OPTIONS } from "../images/probe";
import type { Placement } from "../placement/types";

export interface CompositeImageOptions {
  mockupBuffer: Buffer;
  designBuffer: Buffer;
  placement: Placement;
  colorHex?: string;
  outputPath: string;
}

export interface CustomCompositeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
}

/**
 * Generate a mockup by overlaying design onto a mockup image
 */
export async function compositeImage(options: CompositeImageOptions): Promise<void> {
  const { mockupBuffer, designBuffer, placement, outputPath } = options;

  const baseImage = sharp(mockupBuffer, SHARP_OPTIONS);
  const outputWidth = 1200; // Resvg fitTo.value is 1200

  // Map LivePreview logic:
  // SVG_VIEWBOX = 600x700
  // output is 1200x1400 (scale factor = 2)
  const scale = outputWidth / 600; // = 2

  // Print area from LivePreview:
  const PRINT_AREA_SVG_HEIGHT = 280;
  const PRINT_AREA_CENTER_X = 300;
  const PRINT_AREA_CENTER_Y = 380;

  // We need to know the physical print area height to map mm -> SVG units
  // Standard print area in mm for apparel front (from presets)
  // Real implementation would pull this from DB print_areas_by_view,
  // but for Option B v1 we'll use the standard apparel front dimensions:
  const printAreaHeightMm = 406.4;
  const printAreaWidthMm = 355.6;

  // Compute print area dimensions in SVG coords
  const mmToSvg = PRINT_AREA_SVG_HEIGHT / printAreaHeightMm;
  const printAreaAspect = printAreaWidthMm / printAreaHeightMm;
  const paSvgH = PRINT_AREA_SVG_HEIGHT;
  const paSvgW = paSvgH * printAreaAspect;
  const paSvgX = PRINT_AREA_CENTER_X - paSvgW / 2;
  const paSvgY = PRINT_AREA_CENTER_Y - paSvgH / 2;

  // Design position in SVG coords
  const designSvgX = paSvgX + placement.xMm * mmToSvg;
  const designSvgY = paSvgY + placement.yMm * mmToSvg;
  const designSvgW = placement.widthMm * mmToSvg;
  const designSvgH = placement.heightMm * mmToSvg;

  // Convert SVG coords to final pixel output
  const designW = Math.max(1, Math.round(designSvgW * scale));
  const designH = Math.max(1, Math.round(designSvgH * scale));
  const left = Math.round(designSvgX * scale);
  const top = Math.round(designSvgY * scale);

  const resizedDesign = await sharp(designBuffer, SHARP_OPTIONS)
    .resize(designW, designH, {
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  await baseImage
    .composite([
      {
        input: resizedDesign,
        left: Math.max(0, left),
        top: Math.max(0, top),
      },
    ])
    .png()
    .toFile(outputPath);
}

export async function compositeImageOnCustomMockup(
  mockupBuffer: Buffer,
  designBuffer: Buffer,
  region: CustomCompositeRegion,
  outputPath: string,
): Promise<void> {
  // Get actual mockup dimensions to clamp region safely
  const { width: mockupW = 9999, height: mockupH = 9999 } = await sharp(mockupBuffer, SHARP_OPTIONS).metadata();

  const left = Math.max(0, Math.min(Math.round(region.x), mockupW - 1));
  const top  = Math.max(0, Math.min(Math.round(region.y), mockupH - 1));
  // Clamp design size to not exceed remaining space after offset
  const designWidth  = Math.max(1, Math.min(Math.round(region.width),  mockupW - left));
  const designHeight = Math.max(1, Math.min(Math.round(region.height), mockupH - top));

  let design = sharp(designBuffer, SHARP_OPTIONS)
    .resize(designWidth, designHeight, {
      fit: "contain",
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png();

  if (region.rotationDeg !== 0) {
    design = design.rotate(region.rotationDeg, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  const overlay = await design.toBuffer();

  await sharp(mockupBuffer, SHARP_OPTIONS)
    .composite([{ input: overlay, left, top }])
    .webp({ quality: 90 })
    .toFile(outputPath);
}
