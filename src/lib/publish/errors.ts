export type PublishErrorCode =
  | "PRINTIFY_RATE_LIMITED"
  | "PRINTIFY_AMBIGUOUS_WRITE"
  | "PRINTIFY_AUTHENTICATION_FAILED"
  | "PRINTIFY_PERMISSION_DENIED"
  | "PRINTIFY_BILLING_REQUIRED"
  | "PRINTIFY_VALIDATION_FAILED"
  | "PRINTIFY_SERVER_ERROR"
  | "PUBLISH_ENQUEUE_FAILED"
  | "SHOPIFY_AMBIGUOUS_WRITE"
  | "SHOPIFY_MEDIA_AMBIGUOUS_WRITE"
  | "SHOPIFY_SYNC_TIMEOUT"
  | "SHOPIFY_PERMISSION_DENIED"
  | "UNKNOWN";

const PUBLISH_ERROR_MESSAGES: Record<PublishErrorCode, string> = {
  PRINTIFY_RATE_LIMITED: "Printify đang giới hạn tần suất yêu cầu. Hệ thống sẽ tự thử lại.",
  PRINTIFY_AMBIGUOUS_WRITE:
    "Chưa xác nhận được trạng thái cập nhật trên Printify. Vui lòng kiểm tra sản phẩm và thử lại thủ công.",
  PRINTIFY_AUTHENTICATION_FAILED:
    "Kết nối Printify không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại tài khoản Printify.",
  PRINTIFY_PERMISSION_DENIED: "Tài khoản Printify thiếu quyền cần thiết để publish sản phẩm.",
  PRINTIFY_BILLING_REQUIRED:
    "Tài khoản Printify cần được kiểm tra gói dịch vụ hoặc giới hạn sử dụng.",
  PRINTIFY_VALIDATION_FAILED:
    "Printify từ chối dữ liệu sản phẩm. Vui lòng kiểm tra lại cấu hình sản phẩm.",
  PRINTIFY_SERVER_ERROR: "Printify đang gặp lỗi tạm thời. Hệ thống sẽ tự thử lại nếu an toàn.",
  PUBLISH_ENQUEUE_FAILED: "Không thể đưa job publish vào hàng đợi. Vui lòng thử lại sau.",
  SHOPIFY_AMBIGUOUS_WRITE:
    "Chưa xác nhận được trạng thái cập nhật trên Shopify. Vui lòng kiểm tra sản phẩm và thử lại thủ công.",
  SHOPIFY_MEDIA_AMBIGUOUS_WRITE:
    "Shopify có thể đã nhận hình ảnh nhưng hệ thống chưa xác nhận được kết quả. Vui lòng kiểm tra hình ảnh và thử lại thủ công.",
  SHOPIFY_SYNC_TIMEOUT:
    "Shopify chưa đồng bộ sản phẩm trong thời gian cho phép. Hệ thống sẽ thử lại nếu an toàn.",
  SHOPIFY_PERMISSION_DENIED: "Tài khoản Shopify thiếu quyền cần thiết để publish sản phẩm.",
  UNKNOWN: "Có lỗi xảy ra khi publish. Vui lòng thử lại hoặc liên hệ kỹ thuật.",
};

export function publishUserMessageForCode(
  code: PublishErrorCode | string | null | undefined,
): string {
  if (code && code in PUBLISH_ERROR_MESSAGES) {
    return PUBLISH_ERROR_MESSAGES[code as PublishErrorCode];
  }
  return PUBLISH_ERROR_MESSAGES.UNKNOWN;
}

export class AmbiguousExternalWriteError extends Error {
  public readonly stage: "PRINTIFY" | "SHOPIFY";
  public readonly reasonCode: PublishErrorCode;
  public readonly operation: string;

  constructor(input: {
    stage: "PRINTIFY" | "SHOPIFY";
    reasonCode:
      | "PRINTIFY_AMBIGUOUS_WRITE"
      | "SHOPIFY_AMBIGUOUS_WRITE"
      | "SHOPIFY_MEDIA_AMBIGUOUS_WRITE";
    operation: string;
    message?: string;
  }) {
    super(input.message ?? publishUserMessageForCode(input.reasonCode));
    this.name = "AmbiguousExternalWriteError";
    this.stage = input.stage;
    this.reasonCode = input.reasonCode;
    this.operation = input.operation;
  }
}
