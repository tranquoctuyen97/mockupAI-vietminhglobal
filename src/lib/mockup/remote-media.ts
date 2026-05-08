import { extname } from "node:path";
import { getStorage } from "../storage/local-disk";

const ALLOWED_CONTENT_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/webp", ".webp"],
]);

export async function cacheRemoteMockupImage(
  url: string,
  keySeed: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return url;

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to cache Printify mockup image: ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = resolveImageExtension(url, contentType);
  const buffer = Buffer.from(await response.arrayBuffer());
  const key = `mockups/printify_${sanitizeKeySeed(keySeed)}${ext}`;
  await getStorage().putBuffer(key, buffer);
  return key;
}

export function resolveImageExtension(url: string, contentType: string): string {
  const byContentType = ALLOWED_CONTENT_TYPES.get(contentType);
  if (byContentType) return byContentType;

  try {
    const pathname = new URL(url).pathname;
    const ext = extname(pathname).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  } catch {
    // Ignore invalid URL and use default.
  }

  return ".jpg";
}

function sanitizeKeySeed(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 120);
}
