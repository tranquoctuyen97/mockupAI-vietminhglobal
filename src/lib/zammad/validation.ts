/**
 * Body validation for mailbox proxy requests.
 * Strict allowlist — reject extra fields, enforce constraints.
 */

const ALLOWED_STATUSES = ["active", "pending", "closed"] as const;
const MAX_REPLY_TEXT_LENGTH = 50_000;

export type ReplyBodyValidation =
  | { valid: true; text: string }
  | { valid: false; error: string };

/**
 * Validate reply body — accept only { text }.
 * Text must be non-empty after trimming, max 50,000 chars.
 *
 * Body is treated as plain text. We send content_type: "text/plain" to Zammad.
 * XSS is prevented at render time (React escapes by default + stripHtml helper).
 * Text containing < or > is valid — email replies often include these characters.
 */
export function validateReplyBody(body: unknown): ReplyBodyValidation {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body is required" };
  }

  const keys = Object.keys(body as Record<string, unknown>);
  const extraKeys = keys.filter((k) => k !== "text");
  if (extraKeys.length > 0) {
    return {
      valid: false,
      error: `Extra fields not allowed: ${extraKeys.join(", ")}`,
    };
  }

  const { text } = body as { text?: unknown };

  if (typeof text !== "string") {
    return { valid: false, error: "\"text\" must be a string" };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Reply text must not be empty" };
  }

  if (trimmed.length > MAX_REPLY_TEXT_LENGTH) {
    return {
      valid: false,
      error: `Reply text exceeds maximum length of ${MAX_REPLY_TEXT_LENGTH} characters`,
    };
  }

  return { valid: true, text: trimmed };
}

export type StatusBodyValidation =
  | { valid: true; status: typeof ALLOWED_STATUSES[number] }
  | { valid: false; error: string };

/**
 * Validate status update body — accept only { status }.
 * Allowed values: active, pending, closed.
 */
export function validateStatusBody(body: unknown): StatusBodyValidation {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body is required" };
  }

  const keys = Object.keys(body as Record<string, unknown>);
  const extraKeys = keys.filter((k) => k !== "status");
  if (extraKeys.length > 0) {
    return {
      valid: false,
      error: `Extra fields not allowed: ${extraKeys.join(", ")}. Only "status" is accepted.`,
    };
  }

  const { status } = body as { status?: unknown };

  if (typeof status !== "string") {
    return { valid: false, error: "\"status\" must be a string" };
  }

  if (!ALLOWED_STATUSES.includes(status as typeof ALLOWED_STATUSES[number])) {
    return {
      valid: false,
      error: `Invalid status value: "${status}". Allowed: ${ALLOWED_STATUSES.join(", ")}`,
    };
  }

  return { valid: true, status: status as typeof ALLOWED_STATUSES[number] };
}
