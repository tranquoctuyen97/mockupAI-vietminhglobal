export function isTextContent(contentType: string): boolean {
  return (
    contentType.includes("text/html") ||
    contentType.includes("text/javascript") ||
    contentType.includes("application/javascript") ||
    contentType.includes("text/css")
  );
}

export function rewriteApiUrls(body: string, host: string): string {
  return body.replaceAll("api-inkhub-v2.grabink.co", `${host}/api/inkhub-api`);
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
