import { describe, expect, it } from "vitest";

import {
  parseRetryAfterMs,
  parseTripleWhaleRateLimitHeaders,
  TripleWhaleRequestGate,
  TWCooldownActiveError,
} from "./request-gate";

describe("Triple Whale request gate", () => {
  it("parses Retry-After seconds and HTTP dates", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    expect(parseRetryAfterMs("120", now)).toBe(120_000);
    expect(parseRetryAfterMs("Sat, 01 Aug 2026 00:02:00 GMT", now)).toBe(120_000);
    expect(parseRetryAfterMs("invalid", now)).toBeNull();
  });

  it("reads documented rate-limit response headers", () => {
    const headers = new Headers({
      "Retry-After": "90",
      "RateLimit-Policy": "100;w=60",
      RateLimit: "limit=100, remaining=0, reset=90",
    });
    expect(parseTripleWhaleRateLimitHeaders(headers, new Date("2026-08-01T00:00:00Z"))).toEqual({
      retryAfterMs: 90_000,
      policy: "100;w=60",
      limit: "limit=100, remaining=0, reset=90",
    });
  });

  it("blocks requests while the shared cooldown is active", async () => {
    const redis = {
      async pttl() {
        return 30_000;
      },
      async set() {
        return "OK";
      },
      disconnect() {},
    };
    const gate = new TripleWhaleRequestGate({ redis });
    await expect(gate.beforeRequest()).rejects.toBeInstanceOf(TWCooldownActiveError);
  });

  it("persists an upstream cooldown", async () => {
    const calls: unknown[][] = [];
    const redis = {
      async pttl() {
        return -2;
      },
      async set(...args: unknown[]) {
        calls.push(args);
        return "OK";
      },
      disconnect() {},
    };
    const gate = new TripleWhaleRequestGate({ redis, jitter: () => 500 });
    await gate.afterRateLimit({ retryAfterMs: 10_000 });
    expect(calls).toEqual([["triple-whale:cooldown:global", expect.any(String), "PX", 10_500]]);
  });
});
