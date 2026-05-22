"use client";

import { useState, useEffect } from "react";
import { Upload, SlidersHorizontal, Check, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CanvasPlacementEditor, type CanvasRegionPx } from "@/components/placement/CanvasPlacementEditor";

// --- Types ---

export interface CardSource {
  id: string;
  scope: string;          // "DRAFT" | "TEMPLATE"
  imageUrl: string | null;
  outputUrl?: string | null;
  compositeRegionPx: {
    x: number; y: number; width: number; height: number;
    rotationDeg: number; imageWidth: number; imageHeight: number;
  } | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  label?: string | null;
}

export type CardState = "NO_SOURCE" | "NO_PLACEMENT" | "READY" | "GENERATED";

// --- Pure logic (exported for tests) ---

export function getCardState(source: CardSource | null, generatedOutputUrl: string | null | undefined): CardState {
  if (generatedOutputUrl) return "GENERATED";
  if (!source) return "NO_SOURCE";
  if (source.compositeRegionPx) return "READY";
  return "NO_PLACEMENT";
}

// --- Component ---

interface ColorMockupCardProps {
  color: { id: string; name: string; hex: string };
  source: CardSource | null;
  generatedOutputUrl?: string | null;
  designImageUrl?: string | null;
  draftId: string;
  onUploadClick: () => void;         // parent opens upload modal for this color
  onPlacementSaved: () => void;      // refresh after saving placement
}

export function ColorMockupCard({
  color,
  source,
  generatedOutputUrl,
  designImageUrl,
  draftId,
  onUploadClick,
  onPlacementSaved,
}: ColorMockupCardProps) {
  const state = getCardState(source, generatedOutputUrl);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [savingPlacement, setSavingPlacement] = useState(false);
  const [placementDirty, setPlacementDirty] = useState(false);

  const bgUrl = normalizeImageUrl(source?.imageUrl ?? source?.outputUrl ?? null);
  const canEditPlacement = !!source;

  // Detect image dimensions when placement modal opens
  useEffect(() => {
    if (!placementOpen || !bgUrl) return;
    if (source?.imageWidth && source?.imageHeight) {
      setImageSize({ width: source.imageWidth, height: source.imageHeight });
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImageSize({ width: img.naturalWidth || 1200, height: img.naturalHeight || 1200 });
    img.onerror = () => setImageSize({ width: 1200, height: 1200 });
    img.src = bgUrl;
  }, [placementOpen, bgUrl, source?.imageWidth, source?.imageHeight]);

  async function savePlacement(regionPx: CanvasRegionPx) {
    if (!source) return;
    setSavingPlacement(true);
    try {
      if (source.scope === "TEMPLATE") {
        // Clone template source → new DRAFT source with custom placement
        if (!bgUrl) throw new Error("Không tìm thấy ảnh mockup");
        const imgRes = await fetch(bgUrl);
        if (!imgRes.ok) throw new Error("Không tải được ảnh mockup");
        const blob = await imgRes.blob();
        const form = new FormData();
        form.set("file", blob, "mockup.jpg");
        form.set("colorId", color.id);
        form.set("view", "front");
        form.set("sceneType", "flat_lay");
        form.set("renderMode", "COMPOSITE");
        form.set("isPrimary", "false");
        form.set("sortOrder", "0");
        form.set("compositeRegionPx", JSON.stringify(regionPx));
        const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error((await res.json()).error || "Lỗi lưu vị trí");
      } else {
        const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources/${source.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ compositeRegionPx: regionPx }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Lỗi lưu vị trí");
      }
      toast.success("Đã lưu vị trí design");
      setPlacementOpen(false);
      if (state === "GENERATED") setPlacementDirty(true);
      onPlacementSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi lưu vị trí");
    } finally {
      setSavingPlacement(false);
    }
  }

  const statusIcon = state === "READY" || state === "GENERATED"
    ? <Check size={14} color="var(--color-wise-green)" />
    : <AlertTriangle size={14} color="#f59e0b" />;

  const thumbUrl = state === "GENERATED" ? normalizeImageUrl(generatedOutputUrl) : bgUrl;

  return (
    <>
      <div
        className="card"
        style={{
          padding: 16,
          border: state === "READY" || state === "GENERATED"
            ? "1px solid rgba(146,198,72,0.4)"
            : "1px solid var(--border-default)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <div className="flex items-center gap-2">
            <div style={{ width: 14, height: 14, borderRadius: "50%", backgroundColor: color.hex, border: "1px solid rgba(0,0,0,0.12)", flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{color.name}</span>
          </div>
          {statusIcon}
        </div>

        {/* State 1: No source */}
        {state === "NO_SOURCE" && (
          <button
            type="button"
            onClick={onUploadClick}
            style={{
              width: "100%", border: "2px dashed var(--border-default)",
              borderRadius: "var(--radius-md)", padding: "32px 16px",
              background: "transparent", cursor: "pointer", textAlign: "center",
            }}
          >
            <Upload size={24} style={{ margin: "0 auto 8px", opacity: 0.4, display: "block" }} />
            <p style={{ margin: 0, fontSize: "0.82rem", opacity: 0.6 }}>Upload mockup</p>
          </button>
        )}

        {/* States 2, 3, 4: has source or generated */}
        {state !== "NO_SOURCE" && (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {thumbUrl && (
              <div style={{ width: 72, height: 72, borderRadius: "var(--radius-sm)", overflow: "hidden", flexShrink: 0, background: "var(--bg-tertiary)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl} alt={color.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              {state === "NO_PLACEMENT" && (
                <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "#b45309", fontWeight: 600 }}>
                  Chưa chỉnh vị trí design
                </p>
              )}
              {state === "READY" && (
                <p style={{ margin: "0 0 8px", fontSize: "0.78rem", opacity: 0.6 }}>
                  {source?.scope === "TEMPLATE" ? "Dùng mockup thư viện" : "Mockup riêng · Đã chỉnh vị trí"}
                </p>
              )}
              {state === "GENERATED" && (
                <p style={{ margin: "0 0 8px", fontSize: "0.78rem", opacity: 0.6 }}>
                  {placementDirty ? "Đã chỉnh vị trí · cần tạo lại mockup" : "Đã tạo mockup"}
                </p>
              )}

              <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                {canEditPlacement && (state === "NO_PLACEMENT" || state === "READY") && (
                  <button
                    type="button"
                    className={state === "NO_PLACEMENT" ? "btn btn-primary" : "btn btn-secondary"}
                    style={{ fontSize: "0.75rem", padding: "5px 10px" }}
                    onClick={() => setPlacementOpen(true)}
                  >
                    <SlidersHorizontal size={12} />
                    {state === "NO_PLACEMENT" ? "Chỉnh vị trí" : "Chỉnh lại"}
                  </button>
                )}
                {state === "GENERATED" && canEditPlacement && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: "0.75rem", padding: "5px 10px" }}
                    onClick={() => setPlacementOpen(true)}
                  >
                    <SlidersHorizontal size={12} /> Chỉnh vị trí design
                  </button>
                )}
                {state === "GENERATED" && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: "0.75rem", padding: "5px 10px" }}
                    onClick={onUploadClick}
                  >
                    <RefreshCw size={12} /> Đổi mockup
                  </button>
                )}
                {state !== "GENERATED" && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: "0.75rem", padding: "5px 10px" }}
                    onClick={onUploadClick}
                  >
                    <Upload size={12} /> {source?.scope === "TEMPLATE" ? "Upload mockup riêng" : "Đổi mockup"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Placement modal */}
      {placementOpen && bgUrl && imageSize && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div className="card" style={{ width: "min(1240px, 96vw)", maxHeight: "92vh", overflow: "auto", padding: 20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800 }}>Chỉnh vị trí design — {color.name}</h3>
                <p style={{ margin: "3px 0 0", opacity: 0.55, fontSize: "0.85rem" }}>Chỉ áp dụng cho listing hiện tại.</p>
              </div>
              <button className="btn btn-secondary" onClick={() => setPlacementOpen(false)}>Đóng</button>
            </div>
            <CanvasPlacementEditor
              backgroundImageUrl={bgUrl}
              designImageUrl={designImageUrl}
              imageWidth={imageSize.width}
              imageHeight={imageSize.height}
              mode="CUSTOM_COMPOSITE"
              initialRegionPx={
                source?.compositeRegionPx
                  ? { ...source.compositeRegionPx, imageWidth: imageSize.width, imageHeight: imageSize.height }
                  : { x: imageSize.width * 0.15, y: imageSize.height * 0.15, width: imageSize.width * 0.7, height: imageSize.height * 0.7, rotationDeg: 0, imageWidth: imageSize.width, imageHeight: imageSize.height }
              }
              onSave={savePlacement}
              showSaveButton
            />
            {savingPlacement && <p style={{ textAlign: "center", opacity: 0.5, marginTop: 8 }}>Đang lưu...</p>}
          </div>
        </div>
      )}
    </>
  );
}

function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url || url.startsWith("mockup://")) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/") || url.startsWith("data:")) return url;
  return `/api/files/${url.split("/").map(encodeURIComponent).join("/")}`;
}
