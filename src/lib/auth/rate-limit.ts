/**
 * In-memory rate limiter for login attempts
 * Key: email:IP → max 5 attempts / 15 minutes
 * Will upgrade to Redis in Phase 1
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Build rate limit key from email + IP
 */
function buildKey(email: string, ip: string): string {
  return `${email.toLowerCase()}:${ip}`;
}

/**
 * Check if login attempt is allowed
 * Returns { allowed, remainingAttempts, retryAfterSeconds }
 */
export function checkRateLimit(
  email: string,
  ip: string,
): {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
} {
  const key = buildKey(email, ip);
  const now = Date.now();
  const entry = store.get(key);

  // No entry or expired → allow
  if (!entry || entry.resetAt < now) {
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS, retryAfterSeconds: 0 };
  }

  // Under limit → allow
  if (entry.count < MAX_ATTEMPTS) {
    return {
      allowed: true,
      remainingAttempts: MAX_ATTEMPTS - entry.count,
      retryAfterSeconds: 0,
    };
  }

  // Over limit
  return {
    allowed: false,
    remainingAttempts: 0,
    retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
  };
}

/**
 * Record a failed login attempt
 */
export function recordFailedAttempt(email: string, ip: string): void {
  const key = buildKey(email, ip);
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

/**
 * Clear rate limit for a successful login
 */
export function clearRateLimit(email: string, ip: string): void {
  const key = buildKey(email, ip);
  store.delete(key);
}
