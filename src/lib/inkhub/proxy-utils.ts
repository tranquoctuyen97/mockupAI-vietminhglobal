function firstHeaderValue(value: string | null): string | undefined {
  const first = value?.split(",", 1)[0]?.trim();
  return first || undefined;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function normalizeConfiguredOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.protocol === "http:" && !isLocalHost(url.hostname)) url.protocol = "https:";
    return url.origin;
  } catch {
    return undefined;
  }
}

export function getPublicOrigin(requestOrigin: string, headers?: Headers): string {
  const configuredOrigin = process.env.APP_PUBLIC_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL;

  if (configuredOrigin) {
    const normalizedOrigin = normalizeConfiguredOrigin(configuredOrigin);
    if (normalizedOrigin) return normalizedOrigin;
  }

  const requestUrl = new URL(requestOrigin);
  const forwardedHost = firstHeaderValue(headers?.get("x-forwarded-host") ?? null);
  const forwardedProto = firstHeaderValue(headers?.get("x-forwarded-proto") ?? null);
  const host = forwardedHost ?? requestUrl.host;
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : requestUrl.protocol === "https:" || isLocalHost(requestUrl.hostname)
        ? requestUrl.protocol.slice(0, -1)
        : "https";

  return `${protocol}://${host}`;
}

export function isTextContent(contentType: string): boolean {
  return (
    contentType.includes("text/html") ||
    contentType.includes("text/javascript") ||
    contentType.includes("application/javascript") ||
    contentType.includes("text/css")
  );
}

export function rewriteApiUrls(body: string, host: string): string {
  // The upstream client base URL already contains `/api`. Replace the full
  // base so `/api/auth/me` becomes `/api/inkhub-api/auth/me`, not
  // `/api/inkhub-api/api/auth/me`.
  return body.replace(
    /https?:\/\/api-inkhub-v2\.grabink\.co\/api(?=\/|["'`?)]|$)/g,
    `${host}/api/inkhub-api`,
  );
}

// Rewrite absolute paths (src="/..." href="/...") to go through the proxy.
// Skips protocol-relative (//...) and full URLs (https://...).
export function rewriteAbsolutePaths(html: string, proxyBase: string): string {
  return html
    .replace(/(src|href)="\/(?!\/)/g, `$1="${proxyBase}/`)
    .replace(/(src|href)='\/(?!\/)/g, `$1='${proxyBase}/`);
}

export function injectTokenScript(html: string, token: string, orgId: string): string {
  if (!html.includes("</head>")) return html;
  const script = `<script>localStorage.setItem('token','${token}');localStorage.setItem('organizationId','${orgId}');history.replaceState({},'','/');</script>`;
  return html.replace("</head>", `${script}</head>`);
}

// Rewrite root-relative static asset paths in JS/CSS string literals to go through the proxy.
// Matches quoted strings like "/logo.png" or "/icon.ico?v=2". Skips already-proxied paths.
export function rewriteRootAssets(body: string, proxyBase: string): string {
  return body.replace(
    /(["'])(\/(?!api\/)(?:[^"'?#]*\.)(?:ico|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot|otf)(?:\?[^"']*)?)\1/g,
    `$1${proxyBase}$2$1`,
  );
}
