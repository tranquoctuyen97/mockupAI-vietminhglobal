import { getToken } from "@/lib/inkhub/token";
import { validateSession } from "@/lib/auth/session";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

const UPSTREAM = "https://api-inkhub-v2.grabink.co";

// ── POST dedup: block identical POST requests within a short window ──
const DEDUP_WINDOW_MS = 3_000; // 3 seconds
const recentPosts = new Map<string, { ts: number; response: Response }>();

// Purge stale entries every 30s to prevent memory leaks
setInterval(() => {
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const [key, entry] of recentPosts) {
    if (entry.ts < cutoff) recentPosts.delete(key);
  }
}, 30_000).unref?.();

function computeDedupKey(
  tenantId: string,
  url: string,
  body?: ArrayBuffer,
): string {
  const h = createHash("sha256");
  h.update(tenantId);
  h.update(url);
  if (body) h.update(Buffer.from(body));
  return h.digest("hex");
}

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await validateSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { path } = await params;
  const upstreamUrl = `${UPSTREAM}/${path.join("/")}${request.nextUrl.search}`;

  const { token } = await getToken(session.tenantId);

  const headers = new Headers();
  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("accept", request.headers.get("accept") ?? "application/json, text/plain, */*");
  headers.set("authorization", `Bearer ${token}`);
  headers.set("origin", "https://inkhub.grabink.co");
  headers.set("referer", "https://inkhub.grabink.co/");
  const orgId = request.headers.get("organization-id");
  if (orgId) headers.set("organization-id", orgId);

  const body =
    request.method !== "GET" && request.method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined;

  // ── Dedup check: silently return cached response for duplicate POST ──
  if (request.method === "POST" && body) {
    const dedupKey = computeDedupKey(session.tenantId, upstreamUrl, body);
    const now = Date.now();
    const cached = recentPosts.get(dedupKey);
    if (cached && now - cached.ts < DEDUP_WINDOW_MS) {
      console.warn(
        `[inkhub-api] Duplicate POST blocked: ${path.join("/")} tenant=${session.tenantId}`,
      );
      // Return a clone of the original successful response so SPA sees 200
      return cached.response.clone();
    }

    // Forward to upstream, then cache the response
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
    });

    const responseBody = await upstream.arrayBuffer();
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("access-control-allow-origin", "*");
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");

    const response = new Response(responseBody, {
      status: upstream.status,
      headers: responseHeaders,
    });

    // Only cache successful responses (2xx)
    if (upstream.status >= 200 && upstream.status < 300) {
      recentPosts.set(dedupKey, { ts: now, response: response.clone() });
      setTimeout(() => recentPosts.delete(dedupKey), DEDUP_WINDOW_MS);
    }

    return response;
  }

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body,
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("access-control-allow-origin", "*");
  // Node fetch decompresses the body; strip encoding/length headers so the browser doesn't try to decompress again.
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
