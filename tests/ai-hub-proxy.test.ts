import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexUpstreamUrl,
  filterCodexRequestHeaders,
  filterCodexResponseHeaders,
  isAiHubTextContent,
  normalizeCodexLocalFilePath,
  rewriteCodexLocationHeader,
  rewriteCodexProxyPaths,
} from "../src/lib/ai-hub/proxy";

test("buildCodexUpstreamUrl preserves path and query", () => {
  assert.equal(
    buildCodexUpstreamUrl(["assets", "app.js"], "?v=1"),
    "http://127.0.0.1:8214/assets/app.js?v=1",
  );
  assert.equal(
    buildCodexUpstreamUrl(["@fs", "@fs", "private", "tmp", "image.png"], ""),
    "http://127.0.0.1:8214/@fs/private/tmp/image.png",
  );
  assert.equal(normalizeCodexLocalFilePath("/@fs/@fs/private/tmp/image.png"), "/@fs/private/tmp/image.png");
});

test("filterCodexRequestHeaders strips spoofed internal headers", () => {
  const input = new Headers({
    "accept": "text/html",
    "x-internal-member-id": "spoof",
    "x-internal-workspace": "spoof",
    "cookie": "session=secret",
  });
  const output = filterCodexRequestHeaders(input, "real-user");

  assert.equal(output.get("accept"), "text/html");
  assert.equal(output.get("x-internal-member-id"), "real-user");
  assert.equal(output.has("x-internal-workspace"), false);
  assert.equal(output.has("cookie"), false);
});

test("filterCodexResponseHeaders removes frame blockers", () => {
  const input = new Headers({
    "content-type": "text/html",
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors none",
  });
  const output = filterCodexResponseHeaders(input);

  assert.equal(output.get("content-type"), "text/html");
  assert.equal(output.has("x-frame-options"), false);
  assert.equal(output.has("content-security-policy"), false);
});

test("text detection covers html, js, and css", () => {
  assert.equal(isAiHubTextContent("text/html"), true);
  assert.equal(isAiHubTextContent("application/javascript"), true);
  assert.equal(isAiHubTextContent("text/css"), true);
  assert.equal(isAiHubTextContent("image/png"), false);
});

test("proxy path rewrite covers codex runtime endpoints and assets", () => {
  const input = [
    'fetch("/codex-api/provider-models?provider=openai")',
    "fetch(`/codex-api/prompts?${params.toString()}`)",
    'const image = "/codex-local-image?path=/tmp/a.png";',
    'const generated = "/@fs/tmp/ai-hub/codex-runtime/home/.codex/generated_images/a.png";',
    'navigator.serviceWorker.register("/sw.js")',
    'const logo = "/favicon.ico";',
    'const preload=function(e){return"/"+e};',
  ].join("\n");
  const output = rewriteCodexProxyPaths(input);

  assert.match(output, /"\/api\/codex-proxy\/codex-api\/provider-models\?provider=openai"/);
  assert.match(output, /`\/api\/codex-proxy\/codex-api\/prompts\?\$\{params\.toString\(\)\}`/);
  assert.match(output, /"\/api\/codex-proxy\/codex-local-image\?path=\/tmp\/a\.png"/);
  assert.match(output, /"\/api\/codex-proxy\/@fs\/tmp\/ai-hub\/codex-runtime\/home\/\.codex\/generated_images\/a\.png"/);
  assert.match(output, /"\/api\/codex-proxy\/sw\.js"/);
  assert.match(output, /"\/api\/codex-proxy\/favicon\.ico"/);
  assert.match(output, /return"\/api\/codex-proxy\/"\+e/);
});

test("proxy path rewrite leaves client routes and local filesystem paths alone", () => {
  const input = 'router.push("/skills"); const cwd = "/.codex/worktrees/app";';
  const output = rewriteCodexProxyPaths(input);

  assert.equal(output, input);
});

test("location header rewrite keeps codex redirects inside proxy", () => {
  assert.equal(rewriteCodexLocationHeader("/thread/abc"), "/api/codex-proxy/thread/abc");
  assert.equal(
    rewriteCodexLocationHeader("http://127.0.0.1:8214/thread/abc"),
    "/api/codex-proxy/thread/abc",
  );
  assert.equal(
    rewriteCodexLocationHeader("/api/codex-proxy/thread/abc"),
    "/api/codex-proxy/thread/abc",
  );
});
