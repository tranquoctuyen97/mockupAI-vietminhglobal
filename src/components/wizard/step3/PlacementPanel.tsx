"use client";

import { SlidersHorizontal } from "lucide-react";

type Props = {
  placementCountLabel: string;
  placementDetailLabel: string;
  placementSourceLabel: string;
  hasOverride: boolean;
  isAdmin: boolean;
  onEdit: () => void;
  onOpenStorePreset: () => void;
  onReset: () => void;
};

export function PlacementPanel({
  placementCountLabel,
  placementDetailLabel,
  placementSourceLabel,
  hasOverride,
  isAdmin,
  onEdit,
  onOpenStorePreset,
  onReset,
}: Props) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex justify-between items-start gap-3" style={{ marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>Vị trí in</h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
            {placementSourceLabel}
          </p>
        </div>
        <span
          className="badge badge-success"
          style={{ flexShrink: 0, maxWidth: 86, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={placementDetailLabel}
        >
          {placementCountLabel}
        </span>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gap: 5 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: "0.95rem", lineHeight: 1.25 }}>
            {placementCountLabel}
          </p>
          <p
            style={{ margin: 0, opacity: 0.62, fontSize: "0.75rem", lineHeight: 1.35, overflowWrap: "anywhere" }}
            title={placementDetailLabel}
          >
            {placementDetailLabel}
          </p>
          <p style={{ margin: 0, opacity: 0.5, fontSize: "0.72rem", lineHeight: 1.35 }}>
            {hasOverride
              ? "Đang áp dụng cho toàn bộ designs trong wizard."
              : "Đang dùng placement đã lưu trong template đang chọn."}
          </p>
        </div>

        <button
          className="btn btn-secondary"
          onClick={onEdit}
          style={{ width: "100%", fontSize: "0.78rem", padding: "7px 10px", minHeight: 44, whiteSpace: "normal", lineHeight: 1.2 }}
        >
          <SlidersHorizontal size={14} /> Chỉnh vị trí design
        </button>

        {isAdmin ? (
          <button
            className="btn btn-secondary"
            onClick={onOpenStorePreset}
            style={{ width: "100%", fontSize: "0.78rem", padding: "7px 10px", minHeight: 44, whiteSpace: "normal", lineHeight: 1.2 }}
          >
            Mở preset store
          </button>
        ) : (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-default)",
              fontSize: "0.75rem",
              lineHeight: 1.35,
            }}
          >
            <p style={{ margin: 0, fontWeight: 800 }}>Preset store do Admin quản lý</p>
            <p style={{ margin: "3px 0 0", opacity: 0.6 }}>Nếu preset sai, liên hệ Admin để cập nhật.</p>
          </div>
        )}

        {hasOverride && (
          <button
            onClick={onReset}
            style={{
              width: "100%",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "0.75rem",
              color: "var(--color-wise-green)",
              fontWeight: 600,
            }}
          >
            Khôi phục preset store
          </button>
        )}
      </div>
    </div>
  );
}
