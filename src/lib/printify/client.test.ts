import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PrintifyClient } from "./client";

const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");

test("PrintifyClient sends a User-Agent on every request", () => {
  assert.match(source, /"User-Agent":/);
  assert.match(source, /PRINTIFY_USER_AGENT/);
});

test("PrintifyClient exposes typed errors with status and retry metadata", () => {
  assert.match(source, /class PrintifyHttpError extends Error/);
  assert.match(source, /class PrintifyAuthenticationError extends PrintifyHttpError/);
  assert.match(source, /class PrintifyPermissionError extends PrintifyHttpError/);
  assert.match(source, /class PrintifyBillingError extends PrintifyHttpError/);
  assert.match(source, /class PrintifyRateLimitError extends PrintifyHttpError/);
  assert.match(source, /class PrintifyValidationError extends PrintifyHttpError/);
  assert.match(source, /class PrintifyServerError extends PrintifyHttpError/);
  assert.match(source, /retryAfterMs/);
  assert.match(source, /requestId/);
  assert.match(source, /responseBody/);
  assert.match(source, /endpoint/);
  assert.match(source, /method/);
});

test("PrintifyClient retries transient network failures for GET catalog requests", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("Connect Timeout Error"), {
          code: "UND_ERR_CONNECT_TIMEOUT",
        }),
      });
    }
    return new Response(JSON.stringify({ variants: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new PrintifyClient("token");
    const result = await client.getBlueprintVariants(12, 99);

    assert.deepEqual(result, { variants: [] });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PrintifyClient retries pre-connect network failures for POST requests", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    if (calls < 3) {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.printify.com"), {
          code: "ENOTFOUND",
        }),
      });
    }
    return new Response(JSON.stringify({ id: "image-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new PrintifyClient("token");
    const result = await client.uploadImageBase64({ fileName: "design.png", contentsBase64: "abc" });

    assert.equal(result.id, "image-1");
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PrintifyClient does not retry ambiguous POST network failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
      }),
    });
  }) as typeof fetch;

  try {
    const client = new PrintifyClient("token");
    await assert.rejects(
      () => client.uploadImageBase64({ fileName: "design.png", contentsBase64: "abc" }),
      /fetch failed/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
