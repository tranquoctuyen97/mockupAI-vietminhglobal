import assert from "node:assert/strict";
import test from "node:test";
import { isTextContent, rewriteApiUrls, injectTokenScript, rewriteAbsolutePaths, rewriteRootAssets } from "./proxy-utils";

test("isTextContent: returns true for text types", () => {
  assert.equal(isTextContent("text/html; charset=utf-8"), true);
  assert.equal(isTextContent("text/javascript"), true);
  assert.equal(isTextContent("application/javascript"), true);
  assert.equal(isTextContent("text/css"), true);
});

test("isTextContent: returns false for binary types", () => {
  assert.equal(isTextContent("image/png"), false);
  assert.equal(isTextContent("font/woff2"), false);
  assert.equal(isTextContent("application/octet-stream"), false);
});

test("rewriteApiUrls: replaces all occurrences", () => {
  const input =
    'fetch("https://api-inkhub-v2.grabink.co/api/orders"); fetch("https://api-inkhub-v2.grabink.co/api/auth")';
  const result = rewriteApiUrls(input, "https://app.example.com");
  assert.ok(!result.includes("api-inkhub-v2.grabink.co"));
  assert.equal(result.match(/app\.example\.com\/api\/inkhub-api/g)?.length, 2);
});

test("rewriteApiUrls: leaves unrelated URLs unchanged", () => {
  const input = 'fetch("https://fonts.googleapis.com/css")';
  const result = rewriteApiUrls(input, "https://app.example.com");
  assert.equal(result, input);
});

test("injectTokenScript: injects before </head>", () => {
  const html = "<html><head><title>App</title></head><body></body></html>";
  const result = injectTokenScript(html, "tok123", "1");
  assert.ok(result.includes("localStorage.setItem('token','tok123')"));
  assert.ok(result.includes("localStorage.setItem('organizationId','1')"));
  assert.ok(result.indexOf("<script>") < result.indexOf("</head>"));
});

test("injectTokenScript: no-op when </head> absent", () => {
  const html = "<html><body>no head</body></html>";
  const result = injectTokenScript(html, "tok", "1");
  assert.equal(result, html);
});

test("rewriteAbsolutePaths: rewrites src and href with double-quote", () => {
  const html = '<script src="/assets/app.js"></script><link href="/assets/app.css">';
  const result = rewriteAbsolutePaths(html, "/api/inkhub-proxy");
  assert.ok(result.includes('src="/api/inkhub-proxy/assets/app.js"'));
  assert.ok(result.includes('href="/api/inkhub-proxy/assets/app.css"'));
});

test("rewriteAbsolutePaths: rewrites src and href with single-quote", () => {
  const html = "<script src='/assets/app.js'></script>";
  const result = rewriteAbsolutePaths(html, "/api/inkhub-proxy");
  assert.ok(result.includes("src='/api/inkhub-proxy/assets/app.js'"));
});

test("rewriteAbsolutePaths: does not rewrite protocol-relative URLs", () => {
  const html = '<script src="//cdn.example.com/lib.js"></script>';
  const result = rewriteAbsolutePaths(html, "/api/inkhub-proxy");
  assert.equal(result, html);
});

test("rewriteAbsolutePaths: does not rewrite full https URLs", () => {
  const html = '<script src="https://cdn.example.com/lib.js"></script>';
  const result = rewriteAbsolutePaths(html, "/api/inkhub-proxy");
  assert.equal(result, html);
});

test("rewriteRootAssets: rewrites root-relative asset paths in JS double-quotes", () => {
  const js = 'const logo = "/shopify-logo.ico"; const img = "/brand.png";';
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.ok(result.includes('"/api/inkhub-proxy/shopify-logo.ico"'));
  assert.ok(result.includes('"/api/inkhub-proxy/brand.png"'));
});

test("rewriteRootAssets: rewrites root-relative asset paths in JS single-quotes", () => {
  const js = "const logo = '/shopify-logo.ico';";
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.ok(result.includes("'/api/inkhub-proxy/shopify-logo.ico'"));
});

test("rewriteRootAssets: does not rewrite already-proxied paths", () => {
  const js = 'const logo = "/api/inkhub-proxy/shopify-logo.ico";';
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.equal(result, js);
});

test("rewriteRootAssets: does not rewrite non-asset paths", () => {
  const js = 'router.push("/orders"); router.push("/login");';
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.equal(result, js);
});

test("rewriteRootAssets: handles query strings", () => {
  const js = 'const url = "/favicon.ico?v=2";';
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.ok(result.includes('"/api/inkhub-proxy/favicon.ico?v=2"'));
});

test("rewriteRootAssets: rewrites svg, webp, woff2 extensions", () => {
  const js = '"/icon.svg" "/hero.webp" "/font.woff2"';
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.ok(result.includes('"/api/inkhub-proxy/icon.svg"'));
  assert.ok(result.includes('"/api/inkhub-proxy/hero.webp"'));
  assert.ok(result.includes('"/api/inkhub-proxy/font.woff2"'));
});
