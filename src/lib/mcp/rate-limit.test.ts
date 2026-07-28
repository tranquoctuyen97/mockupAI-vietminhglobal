import assert from "node:assert/strict";
import test from "node:test";
import { createMcpRateLimiter, McpRateLimitError } from "./rate-limit";

class FakeRedis {
  private readonly counts = new Map<string, number>();

  async eval(_script: string, _keyCount: number, key: string, ttlMs: string) {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return [next, Number(ttlMs)];
  }
}

test("rate-limit buckets are isolated by profile and class", async () => {
  const limiter = createMcpRateLimiter(new FakeRedis());
  const first = await limiter.consumeMcpRateLimit("profile_1", "url_import");
  const otherProfile = await limiter.consumeMcpRateLimit("profile_2", "url_import");
  const otherClass = await limiter.consumeMcpRateLimit("profile_1", "discovery");
  assert.equal(first.remaining, 9);
  assert.equal(otherProfile.remaining, 9);
  assert.equal(otherClass.remaining, 119);
});

test("over-limit errors expose retryAfterSeconds", async () => {
  const limiter = createMcpRateLimiter(new FakeRedis());
  for (let index = 0; index < 6; index += 1) {
    await limiter.consumeMcpRateLimit("profile_1", "publish");
  }
  await assert.rejects(
    () => limiter.consumeMcpRateLimit("profile_1", "publish"),
    (error: unknown) => error instanceof McpRateLimitError && error.retryAfterSeconds === 60,
  );
});
