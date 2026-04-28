import { useState, useMemo, useEffect } from "react";
import { Check, Loader2 } from "lucide-react";
import { viewLabel } from "@/lib/placement/views";

interface MockupImage {
  id: string;
  colorName: string;
  colorHex?: string | null;
  viewPosition: string;
  sourceUrl: string;
  compositeUrl: string | null;
  compositeStatus: string;
  included: boolean;
  mockupType?: string | null;
  isDefault?: boolean;
  cameraLabel?: string | null;
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

function isRemoteImageUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url) && !url.includes("via.placeholder.com");
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

export function MockupGallery({ draftId, images: propImages, isPolling, progress, onSelectionChange }: MockupGalleryProps) {
  // Local images state for optimistic updates
  const [localImages, setLocalImages] = useState<MockupImage[]>(propImages);

  // Sync from parent when prop changes (e.g. polling brings new images)
  useEffect(() => {
    setLocalImages(propImages);
  }, [propImages]);
  // Group images by color, then sub-group by viewPosition
  const groupedByColor = useMemo(() => {
    const groups: Record<string, { images: MockupImage[]; hex?: string }> = {};
    localImages.forEach(img => {
      if (!groups[img.colorName]) {
        groups[img.colorName] = { images: [], hex: img.colorHex ?? undefined };
      }
      groups[img.colorName].images.push(img);
    });
    // Sort each group's images by view order
    for (const group of Object.values(groups)) {
      group.images.sort((a, b) => viewSortKey(a.viewPosition) - viewSortKey(b.viewPosition));
    }
    return groups;
  }, [localImages]);

  const toggleImage = async (imgId: string, currentIncluded: boolean) => {
    // Optimistic update
    setLocalImages(prev => prev.map(img =>
      img.id === imgId ? { ...img, included: !currentIncluded } : img
    ));
    try {
      await fetch(`/api/wizard/drafts/${draftId}/mockup-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: [imgId], included: !currentIncluded })
      });
      if (onSelectionChange) onSelectionChange();
    } catch (e) {
      // Revert on error
      setLocalImages(prev => prev.map(img =>
        img.id === imgId ? { ...img, included: currentIncluded } : img
      ));
      console.error(e);
    }
  };

  const setGroupSelection = async (colorName: string, included: boolean) => {
    const groupImages = groupedByColor[colorName]?.images || [];
    const imageIds = groupImages.map(img => img.id);
    const idSet = new Set(imageIds);
    // Optimistic update
    setLocalImages(prev => prev.map(img =>
      idSet.has(img.id) ? { ...img, included } : img
    ));
    try {
      await fetch(`/api/wizard/drafts/${draftId}/mockup-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds, included })
      });
      if (onSelectionChange) onSelectionChange();
    } catch (e) {
      // Revert on error
      setLocalImages(prev => prev.map(img =>
        idSet.has(img.id) ? { ...img, included: !included } : img
      ));
      console.error(e);
    }
  };

  if (localImages.length === 0 && !isPolling) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border border-dashed rounded-lg" style={{ borderColor: 'var(--border-default)' }}>
        <p style={{ opacity: 0.6 }}>Chưa có mockup nào được tạo. Vui lòng chọn màu và bấm "Tạo Mockup".</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
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
            <Loader2 className="animate-spin" size={18} style={{ color: "var(--color-wise-green)" }} />
            <div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                {progress.total === 0 ? "Printify đang render mockups..." : "Đang tạo Mockup..."}
              </div>
              {progress.total === 0 && (
                <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>Ảnh thật có thể mất vài phút để xuất hiện.</div>
              )}
            </div>
          </div>
          <div style={{ fontSize: "0.82rem", opacity: 0.7 }}>
            {progress.total > 0
              ? `${progress.completed} / ${progress.total} hoàn thành`
              : "Đang xử lý"}
            {progress.failed > 0 && <span style={{ color: "var(--color-danger, #ef4444)" }}> ({progress.failed} lỗi)</span>}
          </div>
        </div>
      )}

      {/* Color groups */}
      {Object.entries(groupedByColor).map(([color, { images: groupImages, hex }]) => {
        const allSelected = groupImages.every(img => img.included);

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
                <span style={{ fontSize: "0.75rem", opacity: 0.5 }}>
                  {groupImages.length} ảnh
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "3px 8px", fontSize: "0.7rem" }}
                  onClick={() => setGroupSelection(color, true)}
                >
                  Chọn hết
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "3px 8px", fontSize: "0.7rem" }}
                  onClick={() => setGroupSelection(color, false)}
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
              {groupImages.map(img => {
                const imageUrl = normalizeImageUrl(img.compositeUrl) ?? normalizeImageUrl(img.sourceUrl);
                const isPrintifyImage = isRemoteImageUrl(img.compositeUrl ?? img.sourceUrl);
                const label = img.cameraLabel || viewLabel(img.mockupType ?? img.viewPosition);

                return (
                  <div
                    key={img.id}
                    onClick={() => toggleImage(img.id, img.included)}
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
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 0.5 }}>
                        <Loader2 className="animate-spin" size={20} style={{ marginBottom: 4 }} />
                        <span style={{ fontSize: "0.68rem" }}>Đang xử lý...</span>
                      </div>
                    ) : img.compositeStatus === "failed" ? (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-danger, #ef4444)", backgroundColor: "rgba(239,68,68,0.04)" }}>
                        <span style={{ fontSize: "0.68rem" }}>Lỗi</span>
                      </div>
                    ) : imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={`${color} ${viewLabel(img.viewPosition)}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.45 }}>
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
                        backgroundColor: img.included ? "var(--color-wise-green)" : "rgba(255,255,255,0.85)",
                        border: img.included ? "none" : "1px solid rgba(0,0,0,0.15)",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                        transition: "all 0.15s",
                      }}
                    >
                      {img.included && <Check size={11} color="#fff" strokeWidth={3} />}
                    </div>

                    {/* Source/default badges — top left */}
                    {(isPrintifyImage || img.isDefault) && (
                      <div style={{ position: "absolute", top: 5, left: 5, display: "grid", gap: 3 }}>
                        {isPrintifyImage && (
                          <div
                            style={{
                              borderRadius: 999,
                              padding: "1px 6px",
                              fontSize: "0.6rem",
                              fontWeight: 700,
                              backgroundColor: "rgba(255,255,255,0.92)",
                              color: "var(--text-primary)",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                            }}
                          >
                            Printify
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
