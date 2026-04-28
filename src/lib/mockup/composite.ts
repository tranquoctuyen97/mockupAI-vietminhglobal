/**
 * Mockup composite engine using sharp
 * Creates product mockup: colored background + design overlay (v1)
 * OR overlays design onto actual printify mockup image (v2)
 */

import sharp from "sharp";
import { Placement } from "../placement/types";

export interface CompositeImageOptions {
  mockupBuffer: Buffer;
  designBuffer: Buffer;
  placement: Placement;
  colorHex?: string;
  outputPath: string;
}

/**
 * Generate a mockup by overlaying design onto a mockup image
 */
export async function compositeImage(options: CompositeImageOptions): Promise<void> {
  const { mockupBuffer, designBuffer, placement, colorHex, outputPath } = options;

  let baseImage = sharp(mockupBuffer);
  const metadata = await baseImage.metadata();
  const outputWidth = 1200; // Resvg fitTo.value is 1200
  const outputHeight = 1400; // Because aspect ratio is 600x700 -> 1200x1400

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

  const resizedDesign = await sharp(designBuffer)
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
