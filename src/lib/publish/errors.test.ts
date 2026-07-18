import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AmbiguousExternalWriteError, publishUserMessageForCode } from "./errors";

describe("publish user messages", () => {
  it("uses Vietnamese user-facing messages", () => {
    assert.equal(
      publishUserMessageForCode("PRINTIFY_RATE_LIMITED"),
      "Printify đang giới hạn tần suất yêu cầu. Hệ thống sẽ tự thử lại.",
    );
  });

  it("does not expose technical raw errors for unknown codes", () => {
    assert.equal(
      publishUserMessageForCode("UNKNOWN"),
      "Có lỗi xảy ra khi publish. Vui lòng thử lại hoặc liên hệ kỹ thuật.",
    );
    assert.equal(
      publishUserMessageForCode("Raw stack trace: token=secret"),
      "Có lỗi xảy ra khi publish. Vui lòng thử lại hoặc liên hệ kỹ thuật.",
    );
  });

  it("uses manual-recovery messages for ambiguous external writes", () => {
    assert.equal(
      publishUserMessageForCode("PRINTIFY_AMBIGUOUS_WRITE"),
      "Chưa xác nhận được trạng thái cập nhật trên Printify. Vui lòng kiểm tra sản phẩm và thử lại thủ công.",
    );
    assert.equal(
      publishUserMessageForCode("SHOPIFY_AMBIGUOUS_WRITE"),
      "Chưa xác nhận được trạng thái cập nhật trên Shopify. Vui lòng kiểm tra sản phẩm và thử lại thủ công.",
    );
    assert.equal(
      publishUserMessageForCode("SHOPIFY_MEDIA_AMBIGUOUS_WRITE"),
      "Shopify có thể đã nhận hình ảnh nhưng hệ thống chưa xác nhận được kết quả. Vui lòng kiểm tra hình ảnh và thử lại thủ công.",
    );
  });

  it("keeps ambiguous write stage and operation metadata", () => {
    const error = new AmbiguousExternalWriteError({
      stage: "SHOPIFY",
      reasonCode: "SHOPIFY_MEDIA_AMBIGUOUS_WRITE",
      operation: "productCreateMedia",
    });

    assert.equal(error.stage, "SHOPIFY");
    assert.equal(error.reasonCode, "SHOPIFY_MEDIA_AMBIGUOUS_WRITE");
    assert.equal(error.operation, "productCreateMedia");
  });
});
