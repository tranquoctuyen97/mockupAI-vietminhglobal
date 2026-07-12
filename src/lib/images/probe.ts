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
  normalizedBuffer: Buffer | null;
  wasNormalized: boolean;
  originalWidth: number;
  originalHeight: number;
  originalFileSize: number;
}

const PREVIEW_MAX_WIDTH = 512;
const PREVIEW_QUALITY = 80;
const MAX_SIDE = 30_000;
const MAX_INPUT_PIXELS = MAX_SIDE * MAX_SIDE;
export const MAX_PRINTIFY_DESIGN_SIDE = 6_000;
export const SHARP_OPTIONS = { limitInputPixels: MAX_INPUT_PIXELS };

const FORMAT_MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
};

function mimeTypeForFormat(format: string): string {
  return FORMAT_MIME_MAP[format] || `image/${format}`;
}

function storageFormatForSharp(format: string): "jpeg" | "png" {
  return format === "jpeg" || format === "jpg" ? "jpeg" : "png";
}

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

  let width = metadata.width;
  let height = metadata.height;
  let format = metadata.format;
  let mimeType = mimeTypeForFormat(metadata.format);
  let fileSize = size;
  let normalizedBuffer: Buffer | null = null;

  if (metadata.width > MAX_PRINTIFY_DESIGN_SIDE || metadata.height > MAX_PRINTIFY_DESIGN_SIDE) {
    const storageFormat = storageFormatForSharp(metadata.format);
    let normalizedImage = sharp(filePath, SHARP_OPTIONS)
      .resize({
        width: MAX_PRINTIFY_DESIGN_SIDE,
        height: MAX_PRINTIFY_DESIGN_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .withMetadata(metadata.density ? { density: metadata.density } : undefined);

    normalizedImage =
      storageFormat === "jpeg"
        ? normalizedImage.jpeg({ quality: 95, mozjpeg: true })
        : normalizedImage.png({ compressionLevel: 9 });

    const normalized = await normalizedImage.toBuffer({ resolveWithObject: true });
    normalizedBuffer = normalized.data;
    width = normalized.info.width;
    height = normalized.info.height;
    format = storageFormat;
    mimeType = mimeTypeForFormat(storageFormat);
    fileSize = normalized.data.length;
  }

  // Generate preview (512px wide, maintain aspect ratio, webp)
  const previewInput = normalizedBuffer ?? filePath;
  const previewBuffer = await sharp(previewInput, SHARP_OPTIONS)
    .resize(PREVIEW_MAX_WIDTH, undefined, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: PREVIEW_QUALITY })
    .toBuffer();

  return {
    width,
    height,
    dpi: metadata.density || null,
    fileSize,
    mimeType,
    format,
    previewBuffer,
    normalizedBuffer,
    wasNormalized: normalizedBuffer !== null,
    originalWidth: metadata.width,
    originalHeight: metadata.height,
    originalFileSize: size,
  };
}
