import { getToken } from "@/lib/inkhub/token";
import type { NextRequest } from "next/server";

const UPSTREAM = "https://api-inkhub-v2.grabink.co";

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const upstreamUrl = `${UPSTREAM}/${path.join("/")}${request.nextUrl.search}`;

  const { token } = await getToken();

  const headers = new Headers();
  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("accept", request.headers.get("accept") ?? "application/json, text/plain, */*");
  headers.set("authorization", `Bearer ${token}`);
  headers.set("origin", "https://inkhub.grabink.co");
  headers.set("referer", "https://inkhub.grabink.co/");

  const body =
    request.method !== "GET" && request.method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined;

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body,
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("access-control-allow-origin", "*");

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
