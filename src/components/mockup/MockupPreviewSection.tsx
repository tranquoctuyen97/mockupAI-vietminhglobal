"use client";

import type { CSSProperties } from "react";
import { ImagePlus, Info, X } from "lucide-react";
import {
  normalizePreviewScope,
  PreviewTile,
  type PreviewScope,
  type PreviewSource,
} from "./PreviewTile";

type PreviewColor = { id: string; name: string; hex: string };

interface MockupPreviewSectionProps {
  title?: string;
  colors: PreviewColor[];
  sources: PreviewSource[];
  scope: PreviewScope;
  selectedSourceIds: string[];
  primarySourceId: string | null;
  activeSourceId?: string | null;
  onToggleSelected: (source: PreviewSource) => void;
  onSetPrimary: (source: PreviewSource) => void;
  onEditRegion?: (source: PreviewSource) => void;
  onDelete?: (source: PreviewSource) => void;
  onUploadMissingColor?: (color: PreviewColor) => void;
  onRemoveMissingColor?: (color: PreviewColor) => void;
  onAddDraftSource?: () => void;
}

export function MockupPreviewSection({
  title = "Mockup dùng cho listing này",
  colors,
  sources,
  scope,
  selectedSourceIds,
  primarySourceId,
  activeSourceId,
  onToggleSelected,
  onSetPrimary,
  onEditRegion,
  onDelete,
  onUploadMissingColor,
  onRemoveMissingColor,
  onAddDraftSource,
}: MockupPreviewSectionProps) {
  const total = sources.length;
  const selectedSourceIdSet = new Set(selectedSourceIds);
  const selectedTotal = sources.filter((source) => selectedSourceIdSet.has(source.id)).length;
  const activeSource =
    sources.find((source) => source.id === activeSourceId) ??
    sources.find((source) => source.id === primarySourceId) ??
    sources.find((source) => selectedSourceIdSet.has(source.id)) ??
    null;
  const activeScope = activeSource ? normalizePreviewScope(activeSource.scope) ?? scope : scope;

  return (
    <div className="card" style={{ padding: 16, display: "grid", gap: 14 }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 style={{ margin: 0, fontSize: "0.96rem", fontWeight: 900 }}>{title}</h3>
          <p style={{ margin: "3px 0 0", fontSize: "0.74rem", color: "var(--text-muted)" }}>
            {selectedTotal}/{total} mockup đã chọn qua {colors.length} màu
          </p>
        </div>
        {onAddDraftSource && (
          <button type="button" className="btn btn-secondary" onClick={onAddDraftSource}>
            <ImagePlus size={14} />
            Thêm mockup riêng
          </button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          padding: 14,
          borderRadius: 12,
          border: "1px solid var(--border-default)",
          background: "var(--bg-inset, #f7f7f4)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 900 }}>Preview mockup đang chọn</h4>
            <p style={{ margin: "3px 0 0", fontSize: "0.74rem", color: "var(--text-muted)" }}>
              {activeSource ? "Ảnh lớn theo mockup đang được chọn" : "Chưa có mockup để preview"}
            </p>
          </div>
          {activeSource && (
            <div className="flex items-center gap-2" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
              <span
                style={{
                  ...modeBadgeStyle,
                  borderColor: activeScope === "DRAFT" ? "rgba(124,58,237,0.28)" : "rgba(37,99,235,0.22)",
                  color: activeScope === "DRAFT" ? "#6d28d9" : "#1d4ed8",
                  background: activeScope === "DRAFT" ? "rgba(124,58,237,0.08)" : "rgba(59,130,246,0.08)",
                }}
              >
                {activeScope === "DRAFT" ? "Mockup riêng" : "Từ thư viện"}
              </span>
              {activeSource.isPrimary && (
                <span
                  style={{
                    ...modeBadgeStyle,
                    borderColor: "rgba(22,51,0,0.22)",
                    color: "var(--color-wise-dark-green)",
                    background: "rgba(159,232,112,0.18)",
                  }}
                >
                  Ảnh chính
                </span>
              )}
              {activeSource.renderMode === "COMPOSITE" && (
                <span
                  style={{
                    ...modeBadgeStyle,
                    borderColor: activeSource.compositeRegionPx ? "rgba(34,197,94,0.22)" : "rgba(185,28,28,0.2)",
                    color: activeSource.compositeRegionPx ? "var(--color-wise-dark-green)" : "#b91c1c",
                    background: activeSource.compositeRegionPx ? "rgba(159,232,112,0.12)" : "#fee2e2",
                  }}
                >
                  {activeSource.compositeRegionPx ? "Đã chỉnh vị trí" : "Chưa chỉnh vị trí"}
                </span>
              )}
            </div>
          )}
        </div>

        {activeSource ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.6fr) minmax(220px, 0.7fr)",
              gap: 12,
              alignItems: "start",
            }}
          >
            <div
              style={{
                position: "relative",
                borderRadius: 12,
                overflow: "hidden",
                background: "#f4f4f1",
                border: "1px solid var(--border-default)",
                aspectRatio: "1 / 1.06",
              }}
            >
              {normalizeImageUrl(activeSource.outputUrl ?? activeSource.imageUrl) ? (
                <img
                  src={normalizeImageUrl(activeSource.outputUrl ?? activeSource.imageUrl) ?? undefined}
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  <ImagePlus size={22} />
                </div>
              )}
              {activeSource.renderMode === "COMPOSITE" && activeSource.compositeRegionPx && (
                <RegionOverlay source={activeSource} />
              )}
            </div>

            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              {activeSource.label?.trim() && (
                <strong style={{ fontSize: "0.84rem" }}>{activeSource.label.trim()}</strong>
              )}
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.45 }}>
                {selectedTotal}/{total} mockup đã chọn qua {colors.length} màu
              </p>
              {onEditRegion && activeScope === "DRAFT" && activeSource.renderMode === "COMPOSITE" && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onEditRegion(activeSource)}
                >
                  Chỉnh vị trí
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            style={{
              minHeight: 220,
              display: "grid",
              placeItems: "center",
              borderRadius: 12,
              border: "1px dashed var(--border-default)",
              color: "var(--text-muted)",
            }}
          >
            <span>Chưa có mockup được chọn</span>
          </div>
        )}
      </div>

      {colors.map((color) => {
        const colorSources = sources.filter((source) => source.colorId === color.id || source.colorName === color.name);
        const selectedColorCount = colorSources.filter((source) => selectedSourceIdSet.has(source.id)).length;
        const isMissing = colorSources.length === 0;
        return (
          <section key={color.id} style={{ display: "grid", gap: 10 }}>
            <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background: color.hex,
                  border: "1px solid rgba(0,0,0,0.16)",
                }}
              />
              <strong style={{ fontSize: "0.82rem" }}>
                {isMissing
                  ? `${color.name} · Chưa có mockup custom`
                  : `${color.name} · ${selectedColorCount}/${colorSources.length} ảnh đã chọn`}
              </strong>
            </div>
            {isMissing ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "12px 14px",
                  borderRadius: 8,
                  border: "1px dashed rgba(245,158,11,0.42)",
                  background: "rgba(245,158,11,0.06)",
                }}
              >
                <span style={{ fontSize: "0.76rem", color: "#92400e", fontWeight: 850 }}>
                  {color.name} chưa có mockup custom.
                </span>
                <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                  {onUploadMissingColor && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onUploadMissingColor(color)}
                    >
                      <ImagePlus size={14} />
                      Thêm mockup riêng
                    </button>
                  )}
                  {onRemoveMissingColor && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onRemoveMissingColor(color)}
                    >
                      <X size={14} />
                      Bỏ màu
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 10,
                }}
              >
                {colorSources.map((source) => {
                  const sourceScope = normalizePreviewScope(source.scope) ?? scope;
                  return (
                    <PreviewTile
                      key={source.id}
                      source={source}
                      scope={sourceScope}
                      selected={selectedSourceIdSet.has(source.id)}
                      primary={source.id === primarySourceId}
                      active={source.id === activeSource?.id}
                      editActionLabel="Chỉnh vị trí design"
                      onToggleSelected={onToggleSelected}
                      onSetPrimary={onSetPrimary}
                      onEditRegion={sourceScope === "DRAFT" ? onEditRegion : undefined}
                      onDelete={sourceScope === "DRAFT" ? onDelete : undefined}
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
          padding: "10px 12px",
          borderRadius: 8,
          background: "rgba(59,130,246,0.07)",
          color: "#1d4ed8",
          fontSize: "0.74rem",
          lineHeight: 1.45,
          fontWeight: 700,
        }}
      >
        <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Chỉnh vị trí design tại đây chỉ áp dụng cho listing này.</span>
      </div>
    </div>
  );
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

function RegionOverlay({ source }: { source: PreviewSource }) {
  const region = source.compositeRegionPx;
  if (!region) return null;
  const imageWidth = Math.max(1, source.imageWidth ?? 1000);
  const imageHeight = Math.max(1, source.imageHeight ?? 1000);

  return (
    <div
      style={{
        position: "absolute",
        left: `${Math.max(0, Math.min(100, (region.x / imageWidth) * 100))}%`,
        top: `${Math.max(0, Math.min(100, (region.y / imageHeight) * 100))}%`,
        width: `${Math.max(3, Math.min(100, (region.width / imageWidth) * 100))}%`,
        height: `${Math.max(3, Math.min(100, (region.height / imageHeight) * 100))}%`,
        border: "2px dashed var(--color-wise-green)",
        background: "rgba(159,232,112,0.18)",
        transform: `rotate(${region.rotationDeg}deg)`,
        transformOrigin: "center",
        pointerEvents: "none",
      }}
    />
  );
}

const modeBadgeStyle: CSSProperties = {
  flexShrink: 0,
  border: "1px solid",
  borderRadius: 999,
  padding: "2px 7px",
  fontSize: "0.62rem",
  fontWeight: 900,
};
