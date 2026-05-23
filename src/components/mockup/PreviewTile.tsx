"use client";

import type { CSSProperties, ReactNode } from "react";
import { CheckSquare, Edit3, ImageIcon, Square } from "lucide-react";
import type { CompositeRegion } from "./CompositeRegionEditor";

export type PreviewScope = "TEMPLATE" | "DRAFT";

export interface PreviewSource {
  id: string;
  scope?: PreviewScope | "template" | "draft" | string;
  label?: string | null;
  colorId?: string;
  colorName?: string;
  colorHex?: string;
  view: string;
  sceneType: string;
  renderMode: "FINAL" | "COMPOSITE" | string;
  isPrimary?: boolean;
  imageUrl?: string | null;
  outputUrl?: string | null;
  compositeRegionPx?: CompositeRegion | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

interface PreviewTileProps {
  source: PreviewSource;
  scope: PreviewScope;
  selected?: boolean;
  primary?: boolean;
  active?: boolean;
  editActionLabel?: string;
  onToggleSelected?: (source: PreviewSource) => void;
  onSetPrimary?: (source: PreviewSource) => void;
  onEditRegion?: (source: PreviewSource) => void;
  onDelete?: (source: PreviewSource) => void;
}

export function PreviewTile({
  source,
  scope,
  selected = true,
  primary = source.isPrimary,
  active = false,
  editActionLabel = "Chỉnh vị trí design",
  onToggleSelected,
  onSetPrimary,
  onEditRegion,
  onDelete,
}: PreviewTileProps) {
  const effectiveScope = normalizePreviewScope(source.scope) ?? scope;
  const imageUrl = normalizeImageUrl(source.outputUrl ?? source.imageUrl);
  const isComposite = source.renderMode === "COMPOSITE";
  const hasRegion = !isComposite || !!source.compositeRegionPx;
  const label = source.label?.trim() || null;
  const placementStateLabel = isComposite ? (hasRegion ? "Đã chỉnh vị trí" : "Chưa chỉnh vị trí") : null;
  const editLabel = isComposite && hasRegion ? "Chỉnh lại" : "Chỉnh vị trí";

  return (
    <div
      style={{
        border: selected ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--bg-primary)",
        opacity: selected ? 1 : 0.7,
        boxShadow: active
          ? "0 0 0 2px rgba(59,130,246,0.18)"
          : primary
            ? "0 0 0 1px rgba(159,232,112,0.12)"
            : "none",
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "1 / 1.1",
          background: "#f4f4f1",
          overflow: "hidden",
          cursor: active ? "default" : "pointer",
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
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
            <ImageIcon size={22} />
          </div>
        )}

        {primary && <Badge position="left" tone="green">Ảnh chính</Badge>}
        {placementStateLabel && (
          <Badge position="right" tone={hasRegion ? "green" : "red"} offset={onToggleSelected ? 38 : 8}>
            {placementStateLabel}
          </Badge>
        )}
        {onToggleSelected && (
          <button
            type="button"
            aria-pressed={selected}
            aria-label={selected ? "Bỏ chọn mockup" : "Chọn mockup"}
            onClick={() => onToggleSelected(source)}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 24,
              height: 24,
              display: "grid",
              placeItems: "center",
              borderRadius: 999,
              border: "1px solid rgba(0,0,0,0.12)",
              background: selected ? "var(--color-wise-green)" : "rgba(255,255,255,0.94)",
              color: selected ? "#163300" : "var(--text-primary)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {selected ? <CheckSquare size={15} strokeWidth={2.4} /> : <Square size={15} strokeWidth={2.4} />}
          </button>
        )}
        {source.renderMode === "COMPOSITE" && source.compositeRegionPx && (
          <RegionOverlay source={source} />
        )}
      </div>

      <div style={{ display: "grid", gap: 8, padding: 10 }}>
        {label && (
          <div className="flex items-start justify-between gap-2">
            <span
              title={label}
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "0.78rem",
                fontWeight: 800,
              }}
            >
              {label}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <span
            style={{
              ...modeBadgeStyle,
              borderColor: effectiveScope === "DRAFT" ? "rgba(124,58,237,0.28)" : "rgba(37,99,235,0.22)",
              color: effectiveScope === "DRAFT" ? "#6d28d9" : "#1d4ed8",
              background: effectiveScope === "DRAFT" ? "rgba(124,58,237,0.08)" : "rgba(59,130,246,0.08)",
            }}
          >
            {effectiveScope === "DRAFT" ? "Mockup riêng" : "Từ thư viện"}
          </span>
          {primary && (
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
        </div>

        <div className="flex items-center gap-1" style={{ flexWrap: "wrap" }}>
          {onEditRegion && effectiveScope === "DRAFT" && isComposite && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "4px 7px", fontSize: "0.68rem", lineHeight: 1.2 }}
              title={editActionLabel}
              onClick={() => onEditRegion(source)}
            >
              <Edit3 size={12} />
              {editLabel}
            </button>
          )}
          {onSetPrimary && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "4px 7px", fontSize: "0.68rem", lineHeight: 1.2, opacity: primary ? 0.55 : 1 }}
              onClick={() => onSetPrimary(source)}
              disabled={primary}
            >
              Đặt làm ảnh chính
            </button>
          )}
          {onDelete && effectiveScope === "DRAFT" && (
            <button
              type="button"
              className="btn btn-danger"
              style={{ padding: "4px 7px", fontSize: "0.68rem", lineHeight: 1.2 }}
              onClick={() => onDelete(source)}
            >
              Xóa
            </button>
          )}
          </div>
      </div>
    </div>
  );
}

export function normalizePreviewScope(
  scope: PreviewSource["scope"],
): PreviewScope | null {
  const normalized = String(scope ?? "").toUpperCase();
  if (normalized === "DRAFT") return "DRAFT";
  if (normalized === "TEMPLATE") return "TEMPLATE";
  return null;
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

function Badge({
  children,
  position,
  tone,
  offset = 8,
}: {
  children: ReactNode;
  position: "left" | "right";
  tone: "green" | "red";
  offset?: number;
}) {
  return (
    <span
      style={{
        position: "absolute",
        top: 8,
        [position]: offset,
        borderRadius: 999,
        padding: "3px 8px",
        fontSize: "0.62rem",
        fontWeight: 900,
        background: tone === "green" ? "var(--color-wise-green)" : "#fee2e2",
        color: tone === "green" ? "#163300" : "#b91c1c",
        boxShadow: "0 4px 12px rgba(0,0,0,0.16)",
      }}
    >
      {children}
    </span>
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

const modeBadgeStyle: CSSProperties = {
  flexShrink: 0,
  border: "1px solid",
  borderRadius: 999,
  padding: "2px 7px",
  fontSize: "0.62rem",
  fontWeight: 900,
};
