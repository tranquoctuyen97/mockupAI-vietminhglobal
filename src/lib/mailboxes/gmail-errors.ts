export const GMAIL_RATE_LIMIT_ERROR_CODE = "gmail_rate_limited";

export function isGmailRateLimitError(error: unknown): boolean {
  const candidate = error as { code?: unknown; reason?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const reason = typeof candidate?.reason === "string" ? candidate.reason : "";
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  return code === "ClosedAfterConnectTLS"
    || /account exceeded command or bandwidth limits/i.test(reason)
    || /account exceeded command or bandwidth limits/i.test(message);
}

export function gmailErrorDetails(error: unknown) {
  const candidate = error as { code?: unknown; reason?: unknown; message?: unknown } | null;
  return {
    code: typeof candidate?.code === "string" ? candidate.code : undefined,
    reason: typeof candidate?.reason === "string" ? candidate.reason : undefined,
    message: typeof candidate?.message === "string" ? candidate.message : String(error),
  };
}
