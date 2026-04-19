/**
 * Mockup composite engine using sharp
 * Creates product mockup: colored background + design overlay
 */

import sharp from "sharp";

export interface CompositeOptions {
  designBuffer: Buffer;
  colorHex: string;
  placement: {
    x: number;   // 0-1 relative position
    y: number;   // 0-1 relative position
    scale: number; // 0.5-1.0
    position: "FRONT" | "BACK" | "SLEEVE";
  };
  outputWidth?: number;
  outputHeight?: number;
}

const DEFAULT_SIZE = 1200;

// Product template dimensions (design area within canvas)
const DESIGN_AREA = {
  FRONT: { x: 0.2, y: 0.15, w: 0.6, h: 0.55 },
  BACK:  { x: 0.2, y: 0.15, w: 0.6, h: 0.55 },
  SLEEVE: { x: 0.15, y: 0.3, w: 0.25, h: 0.3 },
};

/**
 * Generate a mockup image
 * 1. Create canvas with solid color background
 * 2. Resize design to fit placement area
 * 3. Composite design onto canvas
 */
export async function generateMockup(options: CompositeOptions): Promise<Buffer> {
  const {
    designBuffer,
    colorHex,
    placement,
    outputWidth = DEFAULT_SIZE,
    outputHeight = DEFAULT_SIZE,
  } = options;

  // Parse hex color to RGB
  const hex = colorHex.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Get design area for position
  const area = DESIGN_AREA[placement.position] || DESIGN_AREA.FRONT;

  // Calculate design dimensions
  const designAreaW = Math.round(outputWidth * area.w * placement.scale);
  const designAreaH = Math.round(outputHeight * area.h * placement.scale);

  // Resize design to fit area (maintain aspect ratio)
  const resizedDesign = await sharp(designBuffer)
    .resize(designAreaW, designAreaH, {
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  // Get actual resized dimensions
  const resizedMeta = await sharp(resizedDesign).metadata();
  const actualW = resizedMeta.width || designAreaW;
  const actualH = resizedMeta.height || designAreaH;

  // Calculate position (centered within design area, adjusted by placement x/y)
  const areaLeft = Math.round(outputWidth * area.x);
  const areaTop = Math.round(outputHeight * area.y);
  const offsetX = Math.round((outputWidth * area.w - actualW) * placement.x);
  const offsetY = Math.round((outputHeight * area.h - actualH) * placement.y);

  const left = areaLeft + offsetX;
  const top = areaTop + offsetY;

  // Create canvas + composite
  const mockup = await sharp({
    create: {
      width: outputWidth,
      height: outputHeight,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .composite([
      {
        input: resizedDesign,
        left: Math.max(0, left),
        top: Math.max(0, top),
      },
    ])
    .webp({ quality: 85 })
    .toBuffer();

  return mockup;
}
