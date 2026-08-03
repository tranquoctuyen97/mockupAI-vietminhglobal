import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const COOLDOWN_KEY = "triple-whale:cooldown:global";
const DEFAULT_RATE_LIMIT_DELAY_MS = 60_000;

type RedisLike = Pick<Redis, "pttl" | "set" | "disconnect">;

export interface TripleWhaleRateLimitMetadata {
  retryAfterMs: number | null;
  policy: string | null;
  limit: string | null;
}

export function parseRetryAfterMs(value: string | null, now = new Date()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - now.getTime());
}

export function parseTripleWhaleRateLimitHeaders(
  headers: Headers,
  now = new Date(),
): TripleWhaleRateLimitMetadata {
  return {
    retryAfterMs: parseRetryAfterMs(headers.get("Retry-After"), now),
    policy: headers.get("RateLimit-Policy"),
    limit: headers.get("RateLimit"),
  };
}

export class TWCooldownActiveError extends Error {
  public readonly retryAt: Date;

  constructor(retryAt: Date) {
    super("Triple Whale cooldown is active");
    this.name = "TWCooldownActiveError";
    this.retryAt = retryAt;
  }
}

export class TripleWhaleRequestGate {
  private readonly redis: RedisLike;
  private readonly ownsRedis: boolean;
  private readonly jitter: () => number;

  constructor(input: { redis?: RedisLike; jitter?: () => number } = {}) {
    this.redis = input.redis ?? createRedisClient();
    this.ownsRedis = !input.redis;
    this.jitter = input.jitter ?? (() => Math.floor(Math.random() * 5_000));
  }

  async beforeRequest(): Promise<void> {
    try {
      const ttlMs = await this.redis.pttl(COOLDOWN_KEY);
      if (ttlMs > 0) throw new TWCooldownActiveError(new Date(Date.now() + ttlMs));
    } catch (error) {
      if (error instanceof TWCooldownActiveError) throw error;
      console.warn("[TripleWhaleRequestGate] Cooldown check failed; continuing:", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async afterRateLimit(input: { retryAfterMs?: number | null }): Promise<void> {
    const baseDelayMs = input.retryAfterMs ?? DEFAULT_RATE_LIMIT_DELAY_MS;
    const delayMs = baseDelayMs + Math.max(0, this.jitter());
    await this.redis.set(COOLDOWN_KEY, String(Date.now() + delayMs), "PX", delayMs);
  }

  close(): void {
    if (this.ownsRedis) this.redis.disconnect();
  }
}

function createRedisClient(): Redis {
  return new Redis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 1,
  });
}
