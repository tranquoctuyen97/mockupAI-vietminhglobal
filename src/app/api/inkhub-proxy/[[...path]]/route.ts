import { getToken } from "@/lib/inkhub/token";
import { injectTokenScript, isTextContent, rewriteAbsolutePaths, rewriteApiUrls, rewriteRootAssets } from "@/lib/inkhub/proxy-utils";
import { validateSession } from "@/lib/auth/session";
import type { NextRequest } from "next/server";

const UPSTREAM_UI = "https://inkhub.grabink.co";

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const session = await validateSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { path } = await params;
  const upstreamPath = path?.length ? `/${path.join("/")}` : "/";
  const upstreamUrl = `${UPSTREAM_UI}${upstreamPath}${request.nextUrl.search}`;

  const reqHeaders = new Headers();
  reqHeaders.set("accept", request.headers.get("accept") ?? "*/*");
  reqHeaders.set(
    "accept-language",
    request.headers.get("accept-language") ?? "en-US,en;q=0.9",
  );
  reqHeaders.set("accept-encoding", "identity"); // disable compression so we can read and modify text
  reqHeaders.set(
    "user-agent",
    request.headers.get("user-agent") ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  );

  const upstream = await fetch(upstreamUrl, {
    method: "GET",
    headers: reqHeaders,
    redirect: "follow",
  });

  const contentType = upstream.headers.get("content-type") ?? "";
  const responseHeaders = new Headers();
  responseHeaders.set("content-type", contentType);

  if (!isTextContent(contentType)) {
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  }

  const host = request.nextUrl.origin;
  const { token, orgId } = await getToken(session.tenantId);
  let body = await upstream.text();

  body = rewriteApiUrls(body, host);

  if (contentType.includes("text/html")) {
    body = rewriteAbsolutePaths(body, "/api/inkhub-proxy");
    body = injectTokenScript(body, token, orgId);
  }

  body = rewriteRootAssets(body, "/api/inkhub-proxy");

  return new Response(body, { status: upstream.status, headers: responseHeaders });
}

export const GET = handler;
