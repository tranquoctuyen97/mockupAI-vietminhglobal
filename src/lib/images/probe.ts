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

/**
 * Probe image metadata and generate preview
 */
export async function probeAndPreview(buffer: Buffer): Promise<ProbeResult> {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error("Cannot read image metadata");
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
  const previewBuffer = await sharp(buffer)
    .resize(PREVIEW_MAX_WIDTH, undefined, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: PREVIEW_QUALITY })
    .toBuffer();

  return {
    width: metadata.width,
    height: metadata.height,
    dpi: metadata.density || null,
    fileSize: buffer.length,
    mimeType,
    format: metadata.format,
    previewBuffer,
  };
}
