/**
 * AI retry wrapper with exponential backoff — Phase 6.9
 * Only retries if parseAIError deems the error retryable.
 */
import { parseAIError } from "./errors";

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; initialDelayMs?: number } = {},
): Promise<T> {
  const { maxAttempts = 3, initialDelayMs = 1000 } = opts;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const parsed = parseAIError(err);

      if (!parsed.retryable || attempt === maxAttempts) {
        throw err;
      }

      const delay = parsed.retryAfterMs ?? initialDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[AI] Attempt ${attempt}/${maxAttempts} failed (${parsed.code}). Retrying in ${delay}ms…`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
