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

export function injectTokenScript(html: string, token: string, orgId: string): string {
  if (!html.includes("</head>")) return html;
  const script = `<script>localStorage.setItem('token','${token}');localStorage.setItem('organizationId','${orgId}');</script>`;
  return html.replace("</head>", `${script}</head>`);
}
