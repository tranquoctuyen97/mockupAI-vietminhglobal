import sharp from "sharp";
import { generateShirtSvg, ShirtView } from "./svg-utils";

export interface ResolveMockupSourceOptions {
  colorHex?: string | null;
  fetchImpl?: typeof fetch;
}

export function isSyntheticMockupSource(sourceUrl: string): boolean {
  return sourceUrl.startsWith("mockup://solid/");
}

export function isLegacyPlaceholderSource(sourceUrl: string): boolean {
  try {
    return new URL(sourceUrl).hostname === "via.placeholder.com";
  } catch {
    return false;
  }
}

export async function resolveMockupSourceBuffer(
  sourceUrl: string,
  options: ResolveMockupSourceOptions = {},
): Promise<Buffer> {
  if (isSyntheticMockupSource(sourceUrl) || isLegacyPlaceholderSource(sourceUrl)) {
    // Extract view from sourceUrl (e.g. mockup://solid/front -> front)
    let view = "front";
    if (sourceUrl.startsWith("mockup://solid/")) {
      view = sourceUrl.split("/").pop() || "front";
    }
    return createSvgMockupBuffer(options.colorHex, view as ShirtView);
  }

  if (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch mockup source: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error(`Unsupported mockup source URL: ${sourceUrl}`);
}

export async function createSvgMockupBuffer(
  colorHex?: string | null,
  view: ShirtView = "front"
): Promise<Buffer> {
  const hex = colorHex || "#F5F5F5";
  const svgString = generateShirtSvg(view, hex);

  return sharp(Buffer.from(svgString))
    .resize(1200, 1200, { fit: "fill" })
    .flatten({ background: "#f5f3ee" })
    .png()
    .toBuffer();
}
