import sharp from "sharp";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";
import { parseMockupSourceUrl } from "./source-url";
import { generateShirtSvg, type ShirtView } from "./svg-utils";

export interface ResolveMockupSourceOptions {
  colorHex?: string | null;
  fetchImpl?: typeof fetch;
}

export function isSyntheticMockupSource(sourceUrl: string): boolean {
  return parseMockupSourceUrl(sourceUrl).kind === "synthetic";
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
  const parsed = parseMockupSourceUrl(sourceUrl);

  if (parsed.kind === "custom") {
    const src = await prisma.customMockupSource.findUniqueOrThrow({
      where: { id: parsed.sourceId },
      select: { storagePath: true },
    });
    return getStorage().getBuffer(src.storagePath);
  }

  if (parsed.kind === "synthetic" || isLegacyPlaceholderSource(sourceUrl)) {
    // Extract view from sourceUrl (e.g. mockup://solid/front -> front)
    const view = parsed.kind === "synthetic" ? parsed.view : "front";
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
  view: ShirtView = "front",
): Promise<Buffer> {
  const hex = colorHex || "#F5F5F5";
  const svgString = generateShirtSvg(view, hex);

  return sharp(Buffer.from(svgString))
    .resize(1200, 1200, { fit: "fill" })
    .flatten({ background: "#f5f3ee" })
    .png()
    .toBuffer();
}
