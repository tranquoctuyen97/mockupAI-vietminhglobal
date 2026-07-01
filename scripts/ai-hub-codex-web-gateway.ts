import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  CODEX_PROXY_BASE,
  filterCodexResponseHeaders,
  isAiHubTextContent,
  rewriteCodexAbsolutePaths,
  rewriteCodexLocationHeader,
  rewriteCodexProxyPaths,
} from "../src/lib/ai-hub/proxy";

loadEnv();

const port = Number(process.env.AI_HUB_GATEWAY_PORT ?? "8215");
const appOrigin = (process.env.AI_HUB_APP_ORIGIN ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const codexOrigin = (process.env.CODEX_APP_URL ?? "http://127.0.0.1:8214").replace(/\/$/, "");
const internalToken = process.env.AI_HUB_INTERNAL_TOKEN ?? "";
const sessionCacheTtlMs = 5_000;

interface AiHubSession {
  memberId: string;
  tenantId: string;
}

const sessionCache = new Map<string, { expiresAt: number; session: AiHubSession }>();

function getHeaderValue(headers: IncomingHttpHeaders, key: string): string | undefined {
  const value = headers[key.toLowerCase()];
  if (Array.isArray(value)) return value.join("; ");
  return value;
}

function getCacheKey(request: IncomingMessage): string {
  return getHeaderValue(request.headers, "cookie") ?? "";
}

async function validateAiHubSession(request: IncomingMessage): Promise<AiHubSession | null> {
  if (!internalToken) return null;

  const cacheKey = getCacheKey(request);
  const cached = cacheKey ? sessionCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.session;

  const response = await fetch(`${appOrigin}/api/internal/ai-hub/session`, {
    headers: {
      authorization: `Bearer ${internalToken}`,
      cookie: getHeaderValue(request.headers, "cookie") ?? "",
      "user-agent": getHeaderValue(request.headers, "user-agent") ?? "",
      "x-forwarded-for": getHeaderValue(request.headers, "x-forwarded-for") ?? "",
      "x-forwarded-proto": getHeaderValue(request.headers, "x-forwarded-proto") ?? "https",
    },
  });

  if (!response.ok) return null;

  const session = (await response.json()) as AiHubSession;
  if (!session.memberId || !session.tenantId) return null;
  if (cacheKey) sessionCache.set(cacheKey, { expiresAt: Date.now() + sessionCacheTtlMs, session });
  return session;
}

function toUpstreamUrl(requestUrl = "/"): URL | null {
  const url = new URL(requestUrl, "http://ai-hub-gateway.local");
  if (url.pathname === CODEX_PROXY_BASE) {
    return new URL(`/${url.search}`, codexOrigin);
  }
  if (url.pathname.startsWith(`${CODEX_PROXY_BASE}/`)) {
    return new URL(`${url.pathname.slice(CODEX_PROXY_BASE.length)}${url.search}`, codexOrigin);
  }
  if (url.pathname.startsWith("/__backend/")) {
    return new URL(`${url.pathname}${url.search}`, codexOrigin);
  }
  return null;
}

function buildRequestHeaders(request: IncomingMessage, memberId: string): Headers {
  const headers = new Headers();
  for (const key of ["accept", "accept-language", "content-type", "user-agent"]) {
    const value = getHeaderValue(request.headers, key);
    if (value) headers.set(key, value);
  }
  headers.set("accept-encoding", "identity");
  headers.set("x-internal-member-id", memberId);
  return headers;
}

function writeHeaders(response: ServerResponse, upstream: Response, bodyWasRewritten: boolean) {
  const headers = filterCodexResponseHeaders(upstream.headers);
  const location = rewriteCodexLocationHeader(upstream.headers.get("location"));
  if (location) headers.set("location", location);
  if (bodyWasRewritten) {
    headers.delete("etag");
    headers.set("cache-control", "no-store");
  }
  headers.forEach((value, key) => response.setHeader(key, value));
}

async function proxyHttp(request: IncomingMessage, response: ServerResponse) {
  const upstreamUrl = toUpstreamUrl(request.url);
  if (!upstreamUrl) {
    response.writeHead(404).end("Not found");
    return;
  }

  const session = await validateAiHubSession(request);
  if (!session) {
    response.writeHead(401).end("Unauthorized");
    return;
  }

  const method = request.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const upstream = await fetch(upstreamUrl, {
    method,
    headers: buildRequestHeaders(request, session.memberId),
    body: hasBody ? request : undefined,
    redirect: "manual",
    duplex: hasBody ? "half" : undefined,
  } as RequestInit & { duplex?: "half" });

  const contentType = upstream.headers.get("content-type") ?? "";
  const shouldRewrite = isAiHubTextContent(contentType);
  writeHeaders(response, upstream, shouldRewrite);
  response.writeHead(upstream.status);

  if (!shouldRewrite) {
    if (upstream.body) {
      for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        response.write(chunk);
      }
    }
    response.end();
    return;
  }

  let body = await upstream.text();
  if (contentType.includes("text/html")) body = rewriteCodexAbsolutePaths(body);
  body = rewriteCodexProxyPaths(body);
  response.end(body);
}

async function proxyWebSocket(request: IncomingMessage, socket: Duplex, head: Buffer) {
  const upstreamUrl = toUpstreamUrl(request.url);
  if (!upstreamUrl || upstreamUrl.pathname !== "/__backend/ipc") {
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    return;
  }

  const session = await validateAiHubSession(request);
  if (!session) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }

  const target = new URL(codexOrigin);
  const upstream = net.connect(Number(target.port || "80"), target.hostname, () => {
    const rawHeaders = [
      `GET ${upstreamUrl.pathname}${upstreamUrl.search} HTTP/1.1`,
      `Host: ${target.host}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      `Sec-WebSocket-Key: ${getHeaderValue(request.headers, "sec-websocket-key") ?? ""}`,
      `Sec-WebSocket-Version: ${getHeaderValue(request.headers, "sec-websocket-version") ?? "13"}`,
      `Origin: ${getHeaderValue(request.headers, "origin") ?? appOrigin}`,
      `User-Agent: ${getHeaderValue(request.headers, "user-agent") ?? ""}`,
      `x-internal-member-id: ${session.memberId}`,
      "",
      "",
    ].join("\r\n");

    upstream.write(rawHeaders);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

const server = http.createServer((request, response) => {
  proxyHttp(request, response).catch((error: Error) => {
    console.error("[ai-hub-gateway] HTTP proxy failed", error);
    if (!response.headersSent) response.writeHead(502);
    response.end("Bad gateway");
  });
});

server.on("upgrade", (request, socket, head) => {
  proxyWebSocket(request, socket, head).catch((error: Error) => {
    console.error("[ai-hub-gateway] WebSocket proxy failed", error);
    socket.destroy();
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[ai-hub-gateway] listening at http://127.0.0.1:${port}`);
});
