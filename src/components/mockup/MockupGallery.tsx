"use client";

import { AlertTriangle, Check, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { parseMockupSourceUrl } from "@/lib/mockup/source-url";
import { viewLabel } from "@/lib/placement/views";

interface MockupImage {
  id: string;
  colorName: string;
  colorHex?: string | null;
  viewPosition: string;
  sourceUrl: string;
  compositeUrl: string | null;
  compositeStatus: string;
  compositeError?: string | null;
  included: boolean;
  mockupType?: string | null;
  isDefault?: boolean;
  cameraLabel?: string | null;
  sortOrder?: number;
}

interface MockupGalleryProps {
  draftId: string;
  images: MockupImage[];
  isPolling: boolean;
  progress: { completed: number; total: number; failed: number };
  onSelectionChange?: () => void;
}

function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url || url.startsWith("mockup://")) return null;
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("/") ||
    url.startsWith("data:")
  ) {
    return url;
  }

  return `/api/files/${url.split("/").map(encodeURIComponent).join("/")}`;
}

/** Sort views in a natural order for display */
const VIEW_ORDER: Record<string, number> = {
  front: 0,
  back: 1,
  sleeve_left: 2,
  sleeve_right: 3,
  neck_label: 4,
  hem: 5,
};

function viewSortKey(pos: string): number {
  return VIEW_ORDER[pos] ?? 99;
}

export function MockupGallery({
  draftId,
  images: propImages,
  isPolling,
  progress,
  onSelectionChange,
}: MockupGalleryProps) {
  // Local images state for optimistic updates
  const [localImages, setLocalImages] = useState<MockupImage[]>(propImages);
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set());
  const [activeColor, setActiveColor] = useState<string | null>(null);

  // Sync from parent when prop changes (e.g. polling brings new images)
  useEffect(() => {
    setLocalImages(propImages);
    setBrokenImageIds((current) => {
      const validIds = new Set(propImages.map((image) => image.id));
      return new Set([...current].filter((id) => validIds.has(id)));
    });
  }, [propImages]);
  // Group images by color, then sub-group by viewPosition
  const groupedByColor = useMemo(() => {
    const groups: Record<string, { images: MockupImage[]; hex?: string }> = {};
    localImages.forEach((img) => {
      if (!groups[img.colorName]) {
        groups[img.colorName] = { images: [], hex: img.colorHex ?? undefined };
      }
      groups[img.colorName].images.push(img);
    });
    // Sort each group's images by scope priority → sort order → view
    for (const group of Object.values(groups)) {
      group.images.sort((a, b) => {
        const priorityA = scopeSortPriority(parseMockupSourceUrl(a.sourceUrl));
        const priorityB = scopeSortPriority(parseMockupSourceUrl(b.sourceUrl));
        if (priorityA !== priorityB) return priorityA - priorityB;
        const sortOrderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        if (sortOrderDiff !== 0) return sortOrderDiff;
        return viewSortKey(a.viewPosition) - viewSortKey(b.viewPosition);
      });
    }
    return groups;
  }, [localImages]);
  const hasBrokenImages = brokenImageIds.size > 0;
  const colorTabs = useMemo(
    () =>
      Object.entries(groupedByColor).map(([color, group]) => ({
        color,
        hex: group.hex,
        count: group.images.length,
      })),
    [groupedByColor],
  );
  const visibleGroupedByColor = useMemo(() => {
    if (!activeColor) return groupedByColor;
    return Object.fromEntries(
      Object.entries(groupedByColor).filter(([color]) => color === activeColor),
    );
  }, [activeColor, groupedByColor]);
  const sourceSummary = useMemo(() => {
    let draft = 0;
    let template = 0;
    let printify = 0;
    for (const image of localImages) {
      const parsed = parseMockupSourceUrl(image.sourceUrl);
      if (parsed.kind === "custom" && parsed.scope === "draft") draft += 1;
      else if (parsed.kind === "custom" && parsed.scope === "template") template += 1;
      else if (parsed.kind === "printify") printify += 1;
    }
    return { draft, template, printify };
  }, [localImages]);

  useEffect(() => {
    if (activeColor && !groupedByColor[activeColor]) {
      setActiveColor(null);
    }
  }, [activeColor, groupedByColor]);

  const toggleImage = async (imgId: string, currentIncluded: boolean) => {
    // Optimistic update
    setLocalImages((prev) =>
      prev.map((img) => (img.id === imgId ? { ...img, included: !currentIncluded } : img)),
    );
    try {
      await fetch(`/api/wizard/drafts/${draftId}/mockup-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: [imgId], included: !currentIncluded }),
      });
      if (onSelectionChange) onSelectionChange();
    } catch (e) {
      // Revert on error
      setLocalImages((prev) =>
        prev.map((img) => (img.id === imgId ? { ...img, included: currentIncluded } : img)),
      );
      console.error(e);
    }
  };

  const setGroupSelection = async (colorName: string, included: boolean) => {
    const groupImages = groupedByColor[colorName]?.images || [];
    const imageIds = groupImages.map((img) => img.id);
    const idSet = new Set(imageIds);
    // Optimistic update
    setLocalImages((prev) => prev.map((img) => (idSet.has(img.id) ? { ...img, included } : img)));
    try {
      await fetch(`/api/wizard/drafts/${draftId}/mockup-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds, included }),
      });
      if (onSelectionChange) onSelectionChange();
    } catch (e) {
      // Revert on error
      setLocalImages((prev) =>
        prev.map((img) => (idSet.has(img.id) ? { ...img, included: !included } : img)),
      );
      console.error(e);
    }
  };

  const retryCompositeImage = async (imgId: string) => {
    setLocalImages((prev) =>
      prev.map((img) =>
        img.id === imgId ? { ...img, compositeStatus: "pending", compositeError: null } : img,
      ),
    );
    try {
      await fetch(`/api/wizard/drafts/${draftId}/mockup-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryImageId: imgId }),
      });
      if (onSelectionChange) onSelectionChange();
    } catch (e) {
      console.error(e);
    }
  };

  if (localImages.length === 0 && !isPolling) {
    return (
      <div
        className="flex flex-col items-center justify-center p-12 border border-dashed rounded-lg"
        style={{ borderColor: "var(--border-default)" }}
      >
        <p style={{ opacity: 0.6 }}>
          Chưa có kết quả mockup. Khi sẵn sàng, nhấn "Tạo Mockups" để render ảnh listing.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {hasBrokenImages && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 10,
            color: "var(--color-danger, #ef4444)",
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.18)",
            fontSize: "0.78rem",
            fontWeight: 800,
          }}
        >
          <AlertTriangle size={16} />
          <span>Mockup cũ không còn tải được ảnh. Hãy tạo lại mockup.</span>
        </div>
      )}

      {/* Polling progress bar */}
      {isPolling && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderRadius: 10,
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-default)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Loader2
              className="animate-spin"
              size={18}
              style={{ color: "var(--color-wise-green)" }}
            />
            <div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                {progress.total === 0 ? "Đang render mockups..." : "Đang tạo mockups..."}
              </div>
              {progress.total === 0 && (
                <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>
                  Kết quả có thể mất vài phút để xuất hiện.
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: "0.82rem", opacity: 0.7 }}>
            {progress.total > 0
              ? `${progress.completed} / ${progress.total} hoàn thành`
              : "Đang xử lý"}
            {progress.failed > 0 && (
              <span style={{ color: "var(--color-danger, #ef4444)" }}>
                {" "}
                ({progress.failed} lỗi)
              </span>
            )}
          </div>
        </div>
      )}

      {colorTabs.length > 1 && (
        <div
          className="flex items-center justify-between gap-3"
          style={{
            padding: "8px 0 2px",
            flexWrap: "wrap",
          }}
        >
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 900 }}>Màu:</span>
            <button
              type="button"
              onClick={() => setActiveColor(null)}
              style={{
                ...colorTabStyle,
                background: !activeColor ? "white" : "var(--bg-inset, #f6f6f4)",
                borderColor: !activeColor ? "var(--border-default)" : "transparent",
              }}
            >
              Tất cả
              <span style={countBadgeStyle}>{localImages.length}</span>
            </button>
            {colorTabs.map((tab) => (
              <button
                key={tab.color}
                type="button"
                onClick={() => setActiveColor(tab.color)}
                style={{
                  ...colorTabStyle,
                  background: activeColor === tab.color ? "white" : "var(--bg-inset, #f6f6f4)",
                  borderColor: activeColor === tab.color ? "var(--border-default)" : "transparent",
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: tab.hex ?? "#d1d5db",
                    border: "1px solid rgba(0,0,0,0.14)",
                  }}
                />
                {tab.color}
                <span style={countBadgeStyle}>{tab.count}</span>
              </button>
            ))}
          </div>
          <span style={{ fontSize: "0.74rem", fontWeight: 850, color: "var(--text-muted)" }}>
            {sourceSummary.draft} Mockup riêng · {sourceSummary.template} Tái sử dụng · {sourceSummary.printify} Printify
          </span>
        </div>
      )}

      {/* Color groups */}
      {Object.entries(visibleGroupedByColor).map(([color, { images: groupImages, hex }]) => {
        return (
          <div key={color} style={{ display: "grid", gap: 8 }}>
            {/* Color header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingBottom: 6,
                borderBottom: "1px solid var(--border-default)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Color swatch */}
                {hex && (
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      backgroundColor: hex,
                      border: "1px solid rgba(0,0,0,0.1)",
                      flexShrink: 0,
                    }}
                  />
                )}
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{color}</span>
                <span style={{ fontSize: "0.75rem", opacity: 0.5 }}>{groupImages.length} ảnh</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "3px 8px", fontSize: "0.7rem" }}
                  onClick={() => setGroupSelection(color, true)}
                  type="button"
                >
                  Chọn hết
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "3px 8px", fontSize: "0.7rem" }}
                  onClick={() => setGroupSelection(color, false)}
                  type="button"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>

            {/* Tiles — 4-col compact grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                gap: 6,
              }}
            >
              {groupImages.map((img) => {
                const imageUrl = normalizeImageUrl(img.compositeUrl);
                const sourceType = parseMockupSourceUrl(img.sourceUrl);
                const sourceBadge = getSourceBadge(sourceType);
                const label = img.cameraLabel || viewLabel(img.mockupType ?? img.viewPosition);
                const imageBroken = brokenImageIds.has(img.id);

                return (
                  <div
                    key={img.id}
                    onClick={() => toggleImage(img.id, img.included)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void toggleImage(img.id, img.included);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    style={{
                      position: "relative",
                      aspectRatio: "1 / 1",
                      borderRadius: 8,
                      overflow: "hidden",
                      cursor: "pointer",
                      border: img.included
                        ? "2px solid var(--color-wise-green)"
                        : "1px solid var(--border-default)",
                      backgroundColor: "var(--bg-tertiary)",
                      transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
                      padding: 0,
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "scale(1.02)";
                      e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.08)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "scale(1)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    {/* Image content */}
                    {img.compositeStatus === "processing" || img.compositeStatus === "pending" ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: 0.5,
                        }}
                      >
                        <Loader2 className="animate-spin" size={20} style={{ marginBottom: 4 }} />
                        <span style={{ fontSize: "0.68rem" }}>Đang xử lý...</span>
                      </div>
                    ) : img.compositeStatus === "failed" ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "grid",
                          alignContent: "center",
                          gap: 7,
                          padding: 10,
                          textAlign: "center",
                          color: "var(--color-danger, #ef4444)",
                          backgroundColor: "rgba(239,68,68,0.08)",
                        }}
                      >
                        <AlertTriangle size={20} style={{ margin: "0 auto" }} />
                        <strong style={{ fontSize: "0.68rem", lineHeight: 1.25 }}>
                          Tạo ảnh ghép thất bại · vùng vượt ngoài ảnh · kiểm tra pixel
                        </strong>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: "3px 6px", fontSize: "0.62rem" }}
                            onClick={(event) => {
                              event.stopPropagation();
                              void retryCompositeImage(img.id);
                            }}
                          >
                            <RotateCcw size={11} />
                            Thử lại
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: "3px 6px", fontSize: "0.62rem" }}
                            onClick={(event) => {
                              event.stopPropagation();
                              alert(img.compositeError || "Không có log chi tiết.");
                            }}
                          >
                            Xem log
                          </button>
                        </div>
                      </div>
                    ) : imageUrl && !imageBroken ? (
                      <img
                        src={imageUrl}
                        alt=""
                        onError={() => {
                          setBrokenImageIds((current) => new Set(current).add(img.id));
                        }}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : imageBroken ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 7,
                          textAlign: "center",
                          padding: 14,
                          color: "var(--color-danger, #ef4444)",
                          backgroundColor: "rgba(239,68,68,0.04)",
                        }}
                      >
                        <AlertTriangle size={20} />
                        <span style={{ fontSize: "0.68rem", fontWeight: 800, lineHeight: 1.25 }}>
                          Ảnh listing không còn truy cập được
                        </span>
                        <span
                          style={{
                            fontSize: "0.62rem",
                            fontWeight: 800,
                            color: "var(--text-muted)",
                          }}
                        >
                          Cần tạo lại
                        </span>
                      </div>
                    ) : (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: 0.45,
                        }}
                      >
                        <span style={{ fontSize: "0.68rem" }}>Không có ảnh</span>
                      </div>
                    )}

                    {/* Selection indicator — top right */}
                    <div
                      style={{
                        position: "absolute",
                        top: 5,
                        right: 5,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: img.included
                          ? "var(--color-wise-green)"
                          : "rgba(255,255,255,0.85)",
                        border: img.included ? "none" : "1px solid rgba(0,0,0,0.15)",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                        transition: "all 0.15s",
                      }}
                    >
                      {img.included && <Check size={11} color="#fff" strokeWidth={3} />}
                    </div>

                    {/* Source/default badges — top left */}
                    {(sourceBadge || img.isDefault) && (
                      <div
                        style={{ position: "absolute", top: 5, left: 5, display: "grid", gap: 3 }}
                      >
                        {sourceBadge && (
                          <div
                            style={{
                              borderRadius: 999,
                              padding: "1px 6px",
                              fontSize: "0.6rem",
                              fontWeight: 700,
                              backgroundColor: sourceBadge.bg,
                              color: sourceBadge.color,
                              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                            }}
                          >
                            {sourceBadge.label}
                          </div>
                        )}
                        {img.isDefault && (
                          <div
                            style={{
                              borderRadius: 999,
                              padding: "1px 6px",
                              fontSize: "0.6rem",
                              fontWeight: 700,
                              backgroundColor: "rgba(255,255,255,0.9)",
                              color: "var(--text-primary)",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                              letterSpacing: "0.02em",
                            }}
                          >
                            Mặc định
                          </div>
                        )}
                      </div>
                    )}

                    {/* Footer label — transparent, Vietnamese */}
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        padding: "3px 6px",
                        textAlign: "center",
                        fontSize: "0.65rem",
                        color: "var(--text-primary)",
                        opacity: 0.7,
                        backgroundColor: "rgba(255,255,255,0.75)",
                        backdropFilter: "blur(4px)",
                        fontWeight: 500,
                        lineHeight: 1.2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function getSourceBadge(parsed: ReturnType<typeof parseMockupSourceUrl>): {
  label: string;
  bg: string;
  color: string;
} | null {
  if (parsed.kind === "custom") {
    if (parsed.scope === "draft") {
      return { label: "Mockup riêng", bg: "#ede9fe", color: "#6d28d9" };
    }
    if (parsed.scope === "template") {
      return { label: "Từ thư viện", bg: "#dbeafe", color: "#1d4ed8" };
    }
  }
  if (parsed.kind === "printify") {
    return { label: "Printify", bg: "rgba(255,255,255,0.92)", color: "var(--text-primary)" };
  }
  return null;
}

export function scopeSortPriority(parsed: ReturnType<typeof parseMockupSourceUrl>): number {
  if (parsed.kind === "custom" && parsed.scope === "draft") return 0;
  if (parsed.kind === "custom" && parsed.scope === "template") return 1;
  if (parsed.kind === "printify") return 2;
  return 3; // synthetic
}

const colorTabStyle: CSSProperties = {
  minHeight: 34,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid",
  color: "var(--text-primary)",
  fontSize: "0.76rem",
  fontWeight: 850,
  cursor: "pointer",
};

const countBadgeStyle: CSSProperties = {
  minWidth: 20,
  height: 20,
  borderRadius: 999,
  display: "inline-grid",
  placeItems: "center",
  padding: "0 6px",
  background: "rgba(159,232,112,0.22)",
  color: "var(--color-wise-dark-green)",
  fontSize: "0.66rem",
  fontWeight: 950,
};
