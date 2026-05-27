"use client";

import { X } from "lucide-react";
import { CanvasPlacementEditor, type CanvasRegionPx } from "@/components/placement/CanvasPlacementEditor";
import type { Placement, PlacementData } from "@/lib/placement/types";

type ViewKey = "front" | "back" | "hem" | string;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  currentPlacement: Placement | null;
  availableViews: Exclude<ViewKey, "hem">[];
  selectedView: Exclude<ViewKey, "hem">;
  onViewChange: (view: Exclude<ViewKey, "hem">) => void;
  canvasBackgroundImageUrl: string;
  designImageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  canvasEditorMode: "PRINTIFY_PLACEMENT" | "CUSTOM_COMPOSITE";
  initialRegionPx: CanvasRegionPx;
  onSave: (regionPx: CanvasRegionPx) => void;
  hasOverride: boolean;
  onReset: () => void;
};

export function PlacementEditorModal({
  isOpen,
  onClose,
  currentPlacement,
  availableViews,
  selectedView,
  onViewChange,
  canvasBackgroundImageUrl,
  designImageUrl,
  imageWidth,
  imageHeight,
  canvasEditorMode,
  initialRegionPx,
  onSave,
  hasOverride,
  onReset,
}: Props) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="card"
        style={{ width: "min(1240px, 96vw)", maxHeight: "92vh", overflow: "auto", padding: 20 }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 800 }}>Chỉnh vị trí design</h3>
            <p style={{ margin: "3px 0 0", opacity: 0.55, fontSize: "0.85rem" }}>
              Thay đổi tại đây sẽ áp dụng cho toàn bộ designs trong wizard.
            </p>
          </div>
          <button className="btn btn-secondary" onClick={onClose} aria-label="Đóng editor vị trí">
            <X size={16} /> Đóng
          </button>
        </div>

        <div className="flex items-center gap-2" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          {availableViews.map((view) => (
            <button
              key={view}
              type="button"
              className={selectedView === view ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => onViewChange(view)}
              style={{ minHeight: 36 }}
            >
              {view === "front" ? "Mặt trước" : view === "back" ? "Mặt sau" : view}
            </button>
          ))}
        </div>

        {currentPlacement ? (
          <CanvasPlacementEditor
            backgroundImageUrl={canvasBackgroundImageUrl}
            designImageUrl={designImageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            mode={canvasEditorMode}
            initialRegionPx={initialRegionPx}
            onSave={onSave}
          />
        ) : (
          <div className="alert" style={{ marginBottom: 12 }}>
            <span>Chưa có vị trí in để chỉnh. Hãy bật ít nhất một placement cho template.</span>
          </div>
        )}

        {hasOverride && (
          <button className="btn btn-secondary" onClick={onReset} style={{ marginTop: 14 }}>
            Khôi phục toàn bộ preset store
          </button>
        )}
      </div>
    </div>
  );
}
