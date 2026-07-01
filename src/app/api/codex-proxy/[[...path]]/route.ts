import type { NextRequest } from "next/server";
import {
  buildCodexUpstreamUrl,
  filterCodexRequestHeaders,
  filterCodexResponseHeaders,
  isAiHubTextContent,
  rewriteCodexAbsolutePaths,
  rewriteCodexLocationHeader,
  rewriteCodexProxyPaths,
} from "@/lib/ai-hub/proxy";
import { ensureAiHubWorkspaces } from "@/lib/ai-hub/workspaces";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const session = await validateSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const ok = await hasFeature(session.tenantId, session.role, "ai_hub");
  if (!ok) return new Response("Forbidden", { status: 403 });

  const { path } = await params;
  if (!path?.length) {
    await ensureAiHubWorkspaces({ id: session.id, tenantId: session.tenantId });
  }

  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const upstream = await fetch(buildCodexUpstreamUrl(path, request.nextUrl.search), {
    method,
    headers: filterCodexRequestHeaders(request.headers, session.id),
    body: hasBody ? request.body : undefined,
    redirect: "manual",
    duplex: hasBody ? "half" : undefined,
  } as RequestInit & { duplex?: "half" });

  const contentType = upstream.headers.get("content-type") ?? "";
  const responseHeaders = filterCodexResponseHeaders(upstream.headers);
  const location = rewriteCodexLocationHeader(upstream.headers.get("location"));
  if (location) responseHeaders.set("location", location);

  if (!isAiHubTextContent(contentType)) {
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  }

  let body = await upstream.text();
  if (contentType.includes("text/html")) {
    body = rewriteCodexAbsolutePaths(body);
  }
  body = rewriteCodexProxyPaths(body);
  responseHeaders.delete("etag");
  responseHeaders.set("cache-control", "no-store");

  return new Response(body, { status: upstream.status, headers: responseHeaders });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
