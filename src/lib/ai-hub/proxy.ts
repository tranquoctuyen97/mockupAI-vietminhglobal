export const CODEX_PROXY_BASE = "/api/codex-proxy";

export function getCodexUpstreamBase(): string {
  return (process.env.CODEX_APP_URL ?? "http://127.0.0.1:8214").replace(/\/$/, "");
}

export function buildCodexUpstreamUrl(pathSegments: string[] | undefined, search: string): string {
  const normalizedPathSegments = normalizeCodexPathSegments(pathSegments);
  const upstreamPath = normalizedPathSegments?.length
    ? `/${normalizedPathSegments.map(encodeCodexPathSegment).join("/")}`
    : "/";
  return `${getCodexUpstreamBase()}${upstreamPath}${search}`;
}

function encodeCodexPathSegment(segment: string): string {
  return segment === "@fs" ? segment : encodeURIComponent(segment);
}

export function normalizeCodexPathSegments(pathSegments: string[] | undefined): string[] | undefined {
  if (pathSegments?.[0] === "@fs" && pathSegments[1] === "@fs") {
    return pathSegments.slice(1);
  }

  return pathSegments;
}

export function normalizeCodexLocalFilePath(pathname: string): string {
  return pathname.replace(/^\/@fs\/@fs(?=\/)/, "/@fs");
}

export function filterCodexRequestHeaders(input: Headers, memberId: string): Headers {
  const output = new Headers();
  const allowed = ["accept", "accept-language", "content-type", "user-agent"];

  for (const key of allowed) {
    const value = input.get(key);
    if (value) output.set(key, value);
  }

  output.set("accept-encoding", "identity");
  output.set("x-internal-member-id", memberId);
  return output;
}

export function filterCodexResponseHeaders(input: Headers): Headers {
  const output = new Headers();
  const allowed = ["content-type", "cache-control", "etag", "last-modified"];

  for (const key of allowed) {
    const value = input.get(key);
    if (value) output.set(key, value);
  }

  return output;
}

export function rewriteCodexLocationHeader(location: string | null): string | null {
  if (!location || location.startsWith(`${CODEX_PROXY_BASE}/`)) return location;
  if (location.startsWith("/") && !location.startsWith("//")) {
    return `${CODEX_PROXY_BASE}${location}`;
  }

  const upstreamBase = getCodexUpstreamBase();
  if (location.startsWith(`${upstreamBase}/`)) {
    return `${CODEX_PROXY_BASE}${location.slice(upstreamBase.length)}`;
  }

  return location;
}

export function isAiHubTextContent(contentType: string): boolean {
  return (
    contentType.includes("text/html") ||
    contentType.includes("text/javascript") ||
    contentType.includes("application/javascript") ||
    contentType.includes("text/css")
  );
}

export function rewriteCodexAbsolutePaths(html: string): string {
  return html
    .replace(/(src|href)="\/(?!\/)/g, `$1="${CODEX_PROXY_BASE}/`)
    .replace(/(src|href)='\/(?!\/)/g, `$1='${CODEX_PROXY_BASE}/`);
}

export function rewriteCodexProxyPaths(body: string): string {
  return body
    .replace(/return"\/"\+/g, `return"${CODEX_PROXY_BASE}/"+`)
    .replace(
      /(["'`])\/(?!api\/codex-proxy(?:\/|$))((?:@fs\/|codex-api(?:\/|\?|(?=["'`]))|codex-local-(?:image|browse|directories)(?:\/|\?|(?=["'`]))|sw\.js(?:\?|(?=["'`]))|assets\/|icons\/|manifest\.webmanifest(?:\?|(?=["'`]))|favicon\.ico(?:\?|(?=["'`]))))/g,
      `$1${CODEX_PROXY_BASE}/$2`,
    );
}
