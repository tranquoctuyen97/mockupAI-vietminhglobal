import assert from "node:assert/strict";
import test from "node:test";
import { isTextContent, rewriteApiUrls, injectTokenScript } from "./proxy-utils";

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
