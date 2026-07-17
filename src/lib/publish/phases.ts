export const SHOPIFY_PUBLISH_PHASES = [
  "WAITING_EXTERNAL",
  "WAITING_VARIANTS",
  "UPDATING_ORGANIZATION",
  "REPAIRING_OPTIONS",
  "SYNCING_MEDIA",
  "REORDERING_GALLERY",
  "VERIFYING",
  "PUBLISHING_CHANNELS",
] as const;

export type ShopifyPublishPhase = (typeof SHOPIFY_PUBLISH_PHASES)[number];

export const PUBLISH_PHASE_LABELS: Record<ShopifyPublishPhase, string> = {
  WAITING_EXTERNAL: "Đang chờ Printify đồng bộ sản phẩm sang Shopify",
  WAITING_VARIANTS: "Đang chờ Shopify đồng bộ đầy đủ phiên bản và mã SKU",
  UPDATING_ORGANIZATION: "Đang cập nhật danh mục và bộ sưu tập",
  REPAIRING_OPTIONS: "Đang chuẩn hóa tùy chọn màu sắc và kích thước",
  SYNCING_MEDIA: "Đang gắn ảnh theo màu sản phẩm",
  REORDERING_GALLERY: "Đang sắp xếp thư viện ảnh",
  VERIFYING: "Đang xác minh tùy chọn, phiên bản và hình ảnh",
  PUBLISHING_CHANNELS: "Đang đưa sản phẩm lên các kênh bán hàng Shopify",
};

export function getPublishPhaseLabel(phase: string | null | undefined): string | null {
  if (!phase || !SHOPIFY_PUBLISH_PHASES.includes(phase as ShopifyPublishPhase)) return null;
  return PUBLISH_PHASE_LABELS[phase as ShopifyPublishPhase];
}
