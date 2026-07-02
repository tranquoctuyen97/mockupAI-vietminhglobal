import { stat } from "node:fs/promises";

import sharp from "sharp";

export interface ImageMetadata {
  width: number;
  height: number;
  dpi: number | null;
  fileSize: number;
  mimeType: string;
  format: string;
}

export interface ProbeResult extends ImageMetadata {
  previewBuffer: Buffer;
}

const PREVIEW_MAX_WIDTH = 512;
const PREVIEW_QUALITY = 80;
const MAX_SIDE = 30_000;
const MAX_INPUT_PIXELS = MAX_SIDE * MAX_SIDE;
const SHARP_OPTIONS = { limitInputPixels: MAX_INPUT_PIXELS };

/**
 * Probe image metadata and generate preview
 */
export async function probeAndPreview(filePath: string): Promise<ProbeResult> {
  const { size } = await stat(filePath);
  const image = sharp(filePath, SHARP_OPTIONS);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error("Cannot read image metadata");
  }

  if (metadata.width > MAX_SIDE || metadata.height > MAX_SIDE) {
    throw new Error("Image dimensions exceed the 30,000px limit");
  }

  // Map sharp format to mime type
  const formatMimeMap: Record<string, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    webp: "image/webp",
  };

  const mimeType = formatMimeMap[metadata.format] || `image/${metadata.format}`;

  // Generate preview (512px wide, maintain aspect ratio, webp)
  const previewBuffer = await sharp(filePath, SHARP_OPTIONS)
    .resize(PREVIEW_MAX_WIDTH, undefined, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: PREVIEW_QUALITY })
    .toBuffer();

  return {
    width: metadata.width,
    height: metadata.height,
    dpi: metadata.density || null,
    fileSize: size,
    mimeType,
    format: metadata.format,
    previewBuffer,
  };
}
