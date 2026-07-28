import Redis from "ioredis";

export type McpRateClass =
  | "discovery"
  | "wizard_mutation"
  | "url_import"
  | "generation"
  | "publish";

export const DEFAULT_MCP_LIMITS = {
  discovery: { limit: 120, windowSeconds: 60 },
  wizard_mutation: { limit: 60, windowSeconds: 60 },
  url_import: { limit: 10, windowSeconds: 60 },
  generation: { limit: 6, windowSeconds: 60 },
  publish: { limit: 6, windowSeconds: 60 },
} as const;

const RATE_LIMIT_LUA = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {count, ttl}
`;

type RedisEval = {
  eval(script: string, keyCount: number, key: string, ttlMs: string): Promise<unknown>;
};

export class McpRateLimitError extends Error {
  constructor(
    public readonly rateClass: McpRateClass,
    public readonly retryAfterSeconds: number,
  ) {
    super(`MCP rate limit exceeded for ${rateClass}`);
    this.name = "McpRateLimitError";
  }
}

export function createMcpRateLimiter(redis: RedisEval) {
  async function consumeMcpRateLimit(
    profileId: string,
    rateClass: McpRateClass,
  ): Promise<{ remaining: number; retryAfterSeconds: number | null }> {
    const config = DEFAULT_MCP_LIMITS[rateClass];
    const windowMs = config.windowSeconds * 1000;
    const window = Math.floor(Date.now() / windowMs);
    const key = `mockupai:mcp:rate:${profileId}:${rateClass}:${window}`;
    const raw = await redis.eval(RATE_LIMIT_LUA, 1, key, String(windowMs));
    const [countValue, ttlValue] = raw as [number | string, number | string];
    const count = Number(countValue);
    const ttlMs = Math.max(0, Number(ttlValue));
    const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    if (count > config.limit) {
      throw new McpRateLimitError(rateClass, retryAfterSeconds);
    }
    return {
      remaining: Math.max(0, config.limit - count),
      retryAfterSeconds: null,
    };
  }

  return { consumeMcpRateLimit };
}

const globalForMcpRateLimit = globalThis as unknown as {
  mcpRateLimitRedis?: Redis;
};

function getRateLimitRedis(): Redis {
  if (!globalForMcpRateLimit.mcpRateLimitRedis) {
    globalForMcpRateLimit.mcpRateLimitRedis = new Redis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        lazyConnect: true,
        enableOfflineQueue: true,
        maxRetriesPerRequest: 1,
      },
    );
  }
  return globalForMcpRateLimit.mcpRateLimitRedis;
}

export async function consumeMcpRateLimit(profileId: string, rateClass: McpRateClass) {
  return createMcpRateLimiter(getRateLimitRedis() as unknown as RedisEval).consumeMcpRateLimit(
    profileId,
    rateClass,
  );
}
