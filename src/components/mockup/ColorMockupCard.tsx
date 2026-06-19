"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Upload, SlidersHorizontal, Check, AlertTriangle, RefreshCw, CheckSquare, Square, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { CanvasPlacementEditor, type CanvasRegionPx } from "@/components/placement/CanvasPlacementEditor";
import { computeCustomPrintAreaPx, isSentinelRegion } from "@/lib/mockup/placement-region";

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
  if (
    source.compositeRegionPx &&
    !isSentinelRegion(
      source.compositeRegionPx,
      source.compositeRegionPx.imageWidth,
      source.compositeRegionPx.imageHeight,
    )
  ) {
    return "READY";
  }
  return "NO_PLACEMENT";
}

// --- CompositePreviewThumb (HTML5 canvas, not react-konva) ---

function CompositePreviewThumb({
  sourceUrl,
  designUrl,
  region,
  size = 72,
}: {
  sourceUrl: string;
  designUrl: string | null | undefined;
  region: {
    x: number; y: number; width: number; height: number;
    imageWidth: number; imageHeight: number;
  } | null;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bgImg = new window.Image();
    bgImg.crossOrigin = "anonymous";
    bgImg.onload = () => {
      const scale = size / Math.max(bgImg.naturalWidth, bgImg.naturalHeight);
      const w = bgImg.naturalWidth * scale;
      const h = bgImg.naturalHeight * scale;
      const ox = (size - w) / 2;
      const oy = (size - h) / 2;

      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(bgImg, ox, oy, w, h);

      if (designUrl && region) {
        const dImg = new window.Image();
        dImg.crossOrigin = "anonymous";
        dImg.onload = () => {
          const dx = ox + region.x * scale;
          const dy = oy + region.y * scale;
          const dw = region.width * scale;
          const dh = region.height * scale;
          ctx.drawImage(dImg, dx, dy, dw, dh);
        };
        dImg.onerror = () => drawPlaceholder(ctx, ox, oy, scale, region);
        dImg.src = designUrl;
      } else if (region) {
        drawPlaceholder(ctx, ox, oy, scale, region);
      }
    };
    bgImg.src = sourceUrl;
  }, [sourceUrl, designUrl, region, size]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-tertiary)",
      }}
    />
  );
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  scale: number,
  region: { x: number; y: number; width: number; height: number },
) {
  const dx = ox + region.x * scale;
  const dy = oy + region.y * scale;
  const dw = region.width * scale;
  const dh = region.height * scale;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(146,198,72,0.7)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(dx, dy, dw, dh);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(146,198,72,0.12)";
  ctx.fillRect(dx, dy, dw, dh);
  ctx.fillStyle = "#5f8d25";
  ctx.font = `bold ${Math.max(8, Math.round(dh * 0.22))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DESIGN", dx + dw / 2, dy + dh / 2);
}

// --- Component ---

interface ColorMockupCardProps {
  color: { id: string; name: string; hex: string };
  source: CardSource | null;
  generatedOutputUrl?: string | null;
  designImageUrl?: string | null;
  draftId: string;
  onUploadClick: () => void;
  onPlacementSaved: () => void;
  onDeselectColor?: () => void;
  onSaveTemplatePlacement?: (sourceId: string, region: CanvasRegionPx) => Promise<void>;
  printAreaMm?: { widthMm: number; heightMm: number } | null;
  // Mapping display props
  mappedDesignName?: string;
  mappedMockupName?: string;
  isHighlightedByActiveDesign?: boolean;
  activeInspectDesignName?: string;
}

export function ColorMockupCard({
  color,
  source,
  generatedOutputUrl,
  designImageUrl,
  draftId,
  onUploadClick,
  onPlacementSaved,
  onDeselectColor,
  onSaveTemplatePlacement,
  printAreaMm,
  mappedDesignName,
  mappedMockupName,
  isHighlightedByActiveDesign = true,
  activeInspectDesignName,
}: ColorMockupCardProps) {
  const state = getCardState(source, generatedOutputUrl);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [savingPlacement, setSavingPlacement] = useState(false);
  const [placementDirty, setPlacementDirty] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const bgUrl = normalizeImageUrl(source?.imageUrl ?? source?.outputUrl ?? null);
  const canEditPlacement = !!source;

  // Compute printAreaPx from mm dimensions + actual image size
  const printAreaPx = useMemo(() => {
    if (!printAreaMm || !imageSize) return null;
    return computeCustomPrintAreaPx(printAreaMm, imageSize.width, imageSize.height);
  }, [printAreaMm, imageSize]);

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
      // API requires integer values for compositeRegionPx
      const roundedRegion = {
        ...regionPx,
        x: Math.round(regionPx.x),
        y: Math.round(regionPx.y),
        width: Math.max(1, Math.round(regionPx.width)),
        height: Math.max(1, Math.round(regionPx.height)),
      };
      if (source.scope === "TEMPLATE") {
        // Save placement to the pick (not clone to DRAFT)
        if (onSaveTemplatePlacement) {
          await onSaveTemplatePlacement(source.id, roundedRegion);
        } else {
          // Fallback: clone template source → new DRAFT source (legacy)
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
          form.set("compositeRegionPx", JSON.stringify(roundedRegion));
          const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources`, {
            method: "POST",
            body: form,
          });
          if (!res.ok) throw new Error((await res.json()).error || "Lỗi lưu vị trí");
        }
      } else {
        const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources/${source.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ compositeRegionPx: roundedRegion }),
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

  const genThumbUrl = state === "GENERATED" ? normalizeImageUrl(generatedOutputUrl) : null;

  return (
    <>
      <div
        className="card"
        style={{
          padding: 16,
          border: state === "READY" || state === "GENERATED"
            ? "1px solid rgba(146,198,72,0.4)"
            : "1px solid var(--border-default)",
          opacity: isHighlightedByActiveDesign ? 1 : 0.92,
          transition: "opacity 0.2s",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <div className="flex items-center gap-2">
            {onDeselectColor ? (
              <button
                type="button"
                onClick={onDeselectColor}
                title="Bỏ chọn màu này"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
              >
                <CheckSquare size={18} color="var(--color-wise-green)" />
              </button>
            ) : (
              <Check size={14} color="var(--color-wise-green)" style={{ opacity: 0.4 }} />
            )}
            <div style={{ width: 14, height: 14, borderRadius: "50%", backgroundColor: color.hex, border: "1px solid rgba(0,0,0,0.12)", flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{color.name}</span>
          </div>
          {statusIcon}
        </div>

        {/* Mapping info */}
        {(mappedDesignName || mappedMockupName) && (
          <div style={{ marginBottom: 10, fontSize: "0.73rem", opacity: 0.55, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {mappedDesignName && <span>Design: <strong>{mappedDesignName}</strong></span>}
            {mappedMockupName && <span>Mockup: <strong>{mappedMockupName}</strong></span>}
          </div>
        )}

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
            {/* Thumbnail — clickable composite preview */}
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              title="Xem preview lớn"
              style={{
                width: 72, height: 72, borderRadius: "var(--radius-sm)", overflow: "hidden",
                flexShrink: 0, background: "var(--bg-tertiary)", border: "none", cursor: "pointer",
                padding: 0, position: "relative",
              }}
            >
              {state === "GENERATED" && genThumbUrl && !placementDirty ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={genThumbUrl} alt={color.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : bgUrl && (state === "READY" || state === "NO_PLACEMENT" || placementDirty) ? (
                <CompositePreviewThumb
                  sourceUrl={bgUrl}
                  designUrl={designImageUrl}
                  region={source?.compositeRegionPx ?? null}
                  size={72}
                />
              ) : bgUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={bgUrl} alt={color.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
              {/* Hover overlay icon */}
              <div style={{
                position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(0,0,0,0.3)", opacity: 0, transition: "opacity 0.15s",
              }} className="thumb-hover-overlay">
                <Eye size={16} color="#fff" />
              </div>
            </button>

            {/* Status + Actions */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Status text */}
              {state === "NO_PLACEMENT" && (
                <p style={{ margin: "0 0 4px", fontSize: "0.78rem", color: "#b45309", fontWeight: 600 }}>
                  Chưa chỉnh vị trí design
                </p>
              )}
              {state === "READY" && (
                <p style={{ margin: "0 0 4px", fontSize: "0.78rem", opacity: 0.6 }}>
                  {source?.scope === "TEMPLATE" ? (mappedMockupName ? `Mockup: ${mappedMockupName}` : "Dùng mockup thư viện") : "Mockup riêng · Đã chỉnh vị trí"}
                </p>
              )}
              {state === "GENERATED" && (
                <p style={{ margin: "0 0 4px", fontSize: "0.78rem", opacity: 0.6 }}>
                  {placementDirty ? "Đã chỉnh vị trí · cần tạo lại mockup" : "Đã tạo mockup"}
                </p>
              )}

              {/* Source scope label — dynamic from mappedMockupName */}
              {source && (
                <p style={{ margin: "0 0 8px", fontSize: "0.72rem", opacity: 0.4 }}>
                  Mockup: {mappedMockupName || (source.scope === "TEMPLATE" ? "Từ thư viện" : "Riêng cho listing này")}
                </p>
              )}

              {/* Action buttons */}
              <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                {/* Chỉnh vị trí design — all states with source */}
                {canEditPlacement && (
                  <button
                    type="button"
                    className={state === "NO_PLACEMENT" ? "btn btn-primary" : "btn btn-secondary"}
                    style={{ fontSize: "0.75rem", padding: "5px 10px" }}
                    onClick={() => setPlacementOpen(true)}
                  >
                    <SlidersHorizontal size={12} />
                    {state === "NO_PLACEMENT" ? "Chỉnh vị trí" : "Chỉnh vị trí design"}
                  </button>
                )}

                {/* Đổi mockup — all states with source */}
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: "0.75rem", padding: "5px 10px" }}
                  onClick={onUploadClick}
                >
                  {state === "GENERATED" ? <RefreshCw size={12} /> : <Upload size={12} />}
                  {source?.scope === "TEMPLATE" ? "Đổi mockup" : "Đổi mockup"}
                </button>


              </div>
            </div>
          </div>
        )}

        {/* Expanded preview — larger composite view */}
        {previewExpanded && state !== "NO_SOURCE" && (bgUrl || genThumbUrl) && (
          <div
            style={{
              marginTop: 12,
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-default)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 8,
            }}
          >
            {state === "GENERATED" && genThumbUrl && !placementDirty ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={genThumbUrl}
                alt={`${color.name} preview`}
                style={{ maxWidth: "100%", maxHeight: 280, objectFit: "contain", borderRadius: "var(--radius-sm)" }}
              />
            ) : bgUrl ? (
              <CompositePreviewThumb
                sourceUrl={bgUrl}
                designUrl={designImageUrl}
                region={source?.compositeRegionPx ?? null}
                size={280}
              />
            ) : null}
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
              printAreaPx={printAreaPx ?? undefined}
              initialRegionPx={
                source?.compositeRegionPx
                  ? { ...source.compositeRegionPx, imageWidth: imageSize.width, imageHeight: imageSize.height }
                  : { x: 0, y: 0, width: imageSize.width, height: imageSize.height, rotationDeg: 0, imageWidth: imageSize.width, imageHeight: imageSize.height }
              }
              onSave={savePlacement}
              showSaveButton
            />
            {savingPlacement && <p style={{ textAlign: "center", opacity: 0.5, marginTop: 8 }}>Đang lưu...</p>}
          </div>
        </div>
      )}

      {/* Mockup Preview Modal */}
      <MockupPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        colorName={color.name}
        bgUrl={bgUrl}
        designImageUrl={designImageUrl}
        region={source?.compositeRegionPx ?? null}
        generatedOutputUrl={genThumbUrl}
      />
    </>
  );
}

function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url || url.startsWith("mockup://")) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/") || url.startsWith("data:")) return url;
  return `/api/files/${url.split("/").map(encodeURIComponent).join("/")}`;
}

// --- Preview Modal with Tabs to compare current placement vs generated mockup ---

interface MockupPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  colorName: string;
  bgUrl: string | null;
  designImageUrl?: string | null;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotationDeg: number;
    imageWidth: number;
    imageHeight: number;
  } | null;
  generatedOutputUrl?: string | null;
}

export function MockupPreviewModal({
  isOpen,
  onClose,
  colorName,
  bgUrl,
  designImageUrl,
  region,
  generatedOutputUrl,
}: MockupPreviewModalProps) {
  const [activeTab, setActiveTab] = useState<"live" | "generated">(
    generatedOutputUrl ? "generated" : "live"
  );

  // Sync tab status if modal is reopened or generated output becomes available
  useEffect(() => {
    if (isOpen) {
      setActiveTab(generatedOutputUrl ? "generated" : "live");
    }
  }, [isOpen, generatedOutputUrl]);

  if (!isOpen) return null;

  const imageWidth = Math.max(1, region?.imageWidth ?? 1000);
  const imageHeight = Math.max(1, region?.imageHeight ?? 1000);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(15, 23, 42, 0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        className="card"
        style={{
          width: "min(640px, 94vw)",
          background: "var(--bg-primary, #ffffff)",
          borderRadius: 16,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          border: "1px solid var(--border-default)",
        }}
      >
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h3 style={{ margin: 0, fontWeight: 700, fontSize: "1.15rem" }}>
              Xem trước Mockup — {colorName}
            </h3>
          </div>
          <button
            className="btn btn-secondary"
            onClick={onClose}
            style={{ minHeight: 32, padding: "0 14px", fontSize: "0.85rem" }}
          >
            Đóng
          </button>
        </div>

        {/* Tab Selection */}
        {generatedOutputUrl && (
          <div
            className="flex gap-2"
            style={{
              borderBottom: "1px solid var(--border-default)",
              paddingBottom: 10,
            }}
          >
            <button
              type="button"
              className={`btn ${activeTab === "live" ? "btn-primary" : "btn-secondary"}`}
              style={{ fontSize: "0.8rem", padding: "6px 14px" }}
              onClick={() => setActiveTab("live")}
            >
              Vị trí hiện tại (Live Preview)
            </button>
            <button
              type="button"
              className={`btn ${activeTab === "generated" ? "btn-primary" : "btn-secondary"}`}
              style={{ fontSize: "0.8rem", padding: "6px 14px" }}
              onClick={() => setActiveTab("generated")}
            >
              Ảnh mockup đã tạo (Backend Output)
            </button>
          </div>
        )}

        {/* Preview Container */}
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "1 / 1",
            background: "#f8f8f6",
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid var(--border-default)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {activeTab === "generated" && generatedOutputUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={generatedOutputUrl}
              alt={`${colorName} output`}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          ) : (
            <>
              {bgUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={bgUrl}
                  alt={`${colorName} background`}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              )}
              {region && designImageUrl && (
                <div
                  style={{
                    position: "absolute",
                    left: `${Math.max(0, Math.min(100, (region.x / imageWidth) * 100))}%`,
                    top: `${Math.max(0, Math.min(100, (region.y / imageHeight) * 100))}%`,
                    width: `${Math.max(1, Math.min(100, (region.width / imageWidth) * 100))}%`,
                    height: `${Math.max(1, Math.min(100, (region.height / imageHeight) * 100))}%`,
                    transform: `rotate(${region.rotationDeg}deg)`,
                    transformOrigin: "center",
                    pointerEvents: "none",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={designImageUrl}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "fill",
                      display: "block",
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
