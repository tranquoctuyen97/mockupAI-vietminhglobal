import { prisma } from "@/lib/db";
import { type ProbeResult, probeAndPreviewBuffer } from "@/lib/images/probe";

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ImportedImage = {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  extension: "png" | "jpg";
  width: number;
  height: number;
  dpi: number | null;
  previewBuffer: Buffer;
  normalizedBuffer: Buffer | null;
  fileSizeBytes: number;
  redactedSourceUrl: string;
};

export type FetchMcpImageOptions = {
  fetchImpl?: FetchLike;
  /** Test seam; production callers use the fixed 100 MB ceiling. */
  maxBytes?: number;
  /** Test seam; production callers use the fixed 30-second total timeout. */
  timeoutMs?: number;
};

export type McpImageImportErrorCode =
  | "INVALID_IMAGE_URL"
  | "FETCH_FAILED"
  | "FETCH_TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "IMAGE_TOO_LARGE"
  | "UNSUPPORTED_IMAGE";

export class McpImageImportError extends Error {
  constructor(
    public readonly code: McpImageImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "McpImageImportError";
  }
}

export function redactSourceUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

function parseHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new McpImageImportError("INVALID_IMAGE_URL", "Image URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new McpImageImportError("INVALID_IMAGE_URL", "Image URL must use HTTP or HTTPS");
  }
  return url;
}

function detectSupportedImage(buffer: Buffer): {
  mimeType: "image/png" | "image/jpeg";
  extension: "png" | "jpg";
} {
  const isPng =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (isPng) return { mimeType: "image/png", extension: "png" };

  const isJpeg =
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isJpeg) return { mimeType: "image/jpeg", extension: "jpg" };

  throw new McpImageImportError("UNSUPPORTED_IMAGE", "Only PNG and JPEG image data is supported");
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new McpImageImportError("IMAGE_TOO_LARGE", `Image exceeds the ${maxBytes}-byte limit`);
    }
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new McpImageImportError(
          "IMAGE_TOO_LARGE",
          `Image exceeds the ${maxBytes}-byte limit`,
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function fetchMcpImage(
  rawUrl: string,
  options: FetchMcpImageOptions = {},
): Promise<ImportedImage> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let currentUrl = parseHttpUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { Accept: "image/png,image/jpeg" },
        });
      } catch {
        if (controller.signal.aborted) {
          throw new McpImageImportError(
            "FETCH_TIMEOUT",
            `Image fetch timed out for ${redactSourceUrl(currentUrl.toString())}`,
          );
        }
        throw new McpImageImportError(
          "FETCH_FAILED",
          `Unable to fetch image from ${redactSourceUrl(currentUrl.toString())}`,
        );
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new McpImageImportError(
            "FETCH_FAILED",
            `Image redirect has no Location for ${redactSourceUrl(currentUrl.toString())}`,
          );
        }
        if (redirectCount >= MAX_REDIRECTS) {
          throw new McpImageImportError(
            "TOO_MANY_REDIRECTS",
            `Image URL exceeded ${MAX_REDIRECTS} redirects`,
          );
        }
        currentUrl = parseHttpUrl(new URL(location, currentUrl).toString());
        continue;
      }

      if (!response.ok) {
        throw new McpImageImportError(
          "FETCH_FAILED",
          `Image server returned HTTP ${response.status} for ${redactSourceUrl(currentUrl.toString())}`,
        );
      }

      const buffer = await readBoundedBody(response, maxBytes);
      const detected = detectSupportedImage(buffer);
      let probe: ProbeResult;
      try {
        probe = await probeAndPreviewBuffer(buffer);
      } catch {
        throw new McpImageImportError(
          "UNSUPPORTED_IMAGE",
          "Image data could not be decoded safely",
        );
      }

      return {
        buffer,
        ...detected,
        width: probe.width,
        height: probe.height,
        dpi: probe.dpi,
        previewBuffer: probe.previewBuffer,
        normalizedBuffer: probe.normalizedBuffer,
        fileSizeBytes: probe.fileSize,
        redactedSourceUrl: redactSourceUrl(currentUrl.toString()),
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function createMcpAssetTransfer(input: {
  tenantId: string;
  profileId: string;
  draftId: string;
  kind: "DESIGN" | "MOCKUP";
  sourceUrlRedacted: string;
}): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return prisma.mcpAssetTransfer.create({
    data: {
      ...input,
      status: "FETCHING",
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });
}
