/**
 * AI Provider Error Parser — Phase 6.9
 * Converts raw Gemini/OpenAI/Claude error objects into user-friendly Vietnamese messages.
 * Never leaks raw JSON or technical error strings to the UI.
 */

export interface AIProviderError {
  code: string;
  /** Tiếng Việt, thân thiện — safe to render directly in UI */
  userMessage: string;
  retryable: boolean;
  retryAfterMs?: number;
  severity: "warn" | "error";
  /** Optional admin hint, only show in debug/admin view */
  supportHint?: string;
}

/**
 * Parse any raw error from an AI provider into a structured AIProviderError.
 * Handles: Error objects, plain strings, JSON objects (Gemini response format).
 */
export function parseAIError(raw: unknown): AIProviderError {
  const normalized = normalizeToObject(raw);
  const rawMessage = extractMessage(raw, normalized);
  if (isAuthErrorMessage(rawMessage, normalized)) {
    return {
      code: "auth_failed",
      userMessage: "API key không hợp lệ hoặc không có quyền truy cập provider này. Vui lòng kiểm tra lại key trong AI Settings.",
      retryable: false,
      severity: "error",
      supportHint: rawMessage,
    };
  }
  if (isQuotaErrorMessage(rawMessage, normalized)) {
    return {
      code: "quota_or_billing_required",
      userMessage: "API key hợp lệ nhưng tài khoản chưa có quota/billing cho model này. Vui lòng kiểm tra billing hoặc chọn model khác.",
      retryable: false,
      severity: "error",
      supportHint: rawMessage,
    };
  }
  if (isModelUnavailableMessage(rawMessage)) {
    return {
      code: "model_unavailable",
      userMessage: "Model không khả dụng với API key này. Hãy làm mới danh sách model hoặc chọn model khác.",
      retryable: false,
      severity: "error",
      supportHint: rawMessage,
    };
  }

  // Gemini error format: { error: { code: 503, status: "UNAVAILABLE" } }
  // or flat: { code: 503, message: "..." }
  const code =
    normalized?.error?.code ??
    normalized?.code ??
    normalized?.status ??
    normalized?.statusCode ??
    (raw instanceof Error ? extractHttpCode(raw.message) : null);

  switch (Number(code)) {
    case 503:
      return {
        code: "provider_unavailable",
        userMessage: "AI đang quá tải. Đang thử lại tự động…",
        retryable: true,
        retryAfterMs: 30_000,
        severity: "warn",
      };
    case 429:
      return {
        code: "rate_limited",
        userMessage: "Đã đạt giới hạn tốc độ. Vui lòng chờ 1 phút rồi thử lại.",
        retryable: true,
        retryAfterMs: 60_000,
        severity: "warn",
      };
    case 401:
    case 403:
      return {
        code: "auth_failed",
        userMessage: "Không xác thực được với AI. Vui lòng thử lại.",
        retryable: false,
        severity: "error",
        supportHint: "Admin cần kiểm tra provider đang dùng, API key và quota trong AI Settings.",
      };
    case 400:
      return {
        code: "bad_input",
        userMessage: "Dữ liệu không hợp lệ. Vui lòng thử lại với thông tin product khác.",
        retryable: false,
        severity: "error",
      };
    case 500:
    case 502:
    case 504:
      return {
        code: "server_error",
        userMessage: "Máy chủ AI lỗi tạm thời. Đang thử lại tự động…",
        retryable: true,
        retryAfterMs: 15_000,
        severity: "warn",
      };
    default:
      return {
        code: "unknown",
        userMessage: "Không tạo được nội dung. Bạn có thể thử lại hoặc viết tay.",
        retryable: true,
        severity: "error",
      };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeToObject(raw: unknown): Record<string, any> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return null; }
  }
  if (typeof raw === "object") return raw as Record<string, any>;
  return null;
}

/** Extract HTTP status code from error messages like "503 UNAVAILABLE: ..." */
function extractHttpCode(message: string): number | null {
  const m = message.match(/^(\d{3})\b|\((\d{3})\)/);
  return m ? Number(m[1] ?? m[2]) : null;
}

function extractMessage(raw: unknown, normalized: Record<string, any> | null): string {
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  return String(
    normalized?.error?.message ??
    normalized?.message ??
    normalized?.error ??
    "",
  );
}

function isModelUnavailableMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  if (!normalized.includes("model")) return false;
  return /(not found|does not exist|not exist|invalid|unsupported|unavailable|not available|permission|access)/.test(normalized);
}

function isAuthErrorMessage(message: string, normalized: Record<string, any> | null): boolean {
  const code = String(normalized?.code ?? normalized?.error?.code ?? "");
  const type = String(normalized?.type ?? normalized?.error?.type ?? "");
  const lower = message.toLowerCase();
  return (
    code.includes("invalid_api_key") ||
    type.includes("authentication") ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid api key") ||
    lower.includes("api key is invalid") ||
    lower.includes("you didn't provide an api key") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized")
  );
}

function isQuotaErrorMessage(message: string, normalized: Record<string, any> | null): boolean {
  const code = String(normalized?.code ?? normalized?.error?.code ?? "");
  const type = String(normalized?.type ?? normalized?.error?.type ?? "");
  const lower = message.toLowerCase();
  return (
    code.includes("insufficient_quota") ||
    type.includes("insufficient_quota") ||
    lower.includes("insufficient quota") ||
    lower.includes("billing") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("not supported in the api") ||
    lower.includes("free tier")
  );
}
