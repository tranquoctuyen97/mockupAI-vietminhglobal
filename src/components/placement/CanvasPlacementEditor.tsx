"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from "react-konva";

export type CanvasPlacementMode = "PRINTIFY_PLACEMENT" | "CUSTOM_COMPOSITE";

export interface CanvasRegionPx {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  imageWidth: number;
  imageHeight: number;
}

/** Print area bounds in image-pixel coordinates */
export interface PrintAreaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasPlacementEditorProps {
  backgroundImageUrl?: string | null;
  designImageUrl?: string | null;
  initialRegionPx: CanvasRegionPx;
  imageWidth: number;
  imageHeight: number;
  mode: CanvasPlacementMode;
  onSave: (regionPx: CanvasRegionPx) => void;
  onChange?: (regionPx: CanvasRegionPx) => void;
  onReset?: () => void;
  showSaveButton?: boolean;
  showManualInputs?: boolean;
  /** Optional print area boundary (px relative to image top-left).
   *  When provided: draws teal frame, snap/resize target this area.
   *  When omitted: fallback = full image (backward-compatible). */
  printAreaPx?: PrintAreaBounds;
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function computeFit(
  areaWidth: number,
  areaHeight: number,
  designWidth: number,
  designHeight: number,
  offsetX = 0,
  offsetY = 0,
): { x: number; y: number; width: number; height: number } {
  const designAspect = designWidth / Math.max(1, designHeight);
  const areaAspect = areaWidth / Math.max(1, areaHeight);
  let w: number, h: number;
  if (designAspect > areaAspect) {
    w = areaWidth;
    h = w / designAspect;
  } else {
    h = areaHeight;
    w = h * designAspect;
  }
  return {
    x: Math.round(offsetX + (areaWidth - w) / 2),
    y: Math.round(offsetY + (areaHeight - h) / 2),
    width: Math.round(w),
    height: Math.round(h),
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CanvasPlacementEditor({
  backgroundImageUrl,
  designImageUrl,
  initialRegionPx,
  imageWidth,
  imageHeight,
  mode,
  onSave,
  onChange,
  onReset,
  showSaveButton = true,
  showManualInputs = true,
  printAreaPx,
}: CanvasPlacementEditorProps) {
  const nodeRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  const [selected, setSelected] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [region, setRegion] = useState<CanvasRegionPx>(() =>
    normalizeRegion(initialRegionPx, imageWidth, imageHeight),
  );
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [designImage, setDesignImage] = useState<HTMLImageElement | null>(null);
  const autoFitAppliedRef = useRef(false);

  // Effective print area: prop or full image fallback
  const pa: PrintAreaBounds = useMemo(
    () => printAreaPx ?? { x: 0, y: 0, width: imageWidth, height: imageHeight },
    [printAreaPx, imageWidth, imageHeight],
  );

  useEffect(() => {
    autoFitAppliedRef.current = false;
    setRegion(normalizeRegion(initialRegionPx, imageWidth, imageHeight));
  }, [imageHeight, imageWidth, initialRegionPx]);

  useEffect(() => {
    setBackgroundImage(null);
    if (!backgroundImageUrl) return;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setBackgroundImage(img);
    img.src = backgroundImageUrl;
    return () => { img.onload = null; };
  }, [backgroundImageUrl]);

  useEffect(() => {
    setDesignImage(null);
    if (!designImageUrl) {
      // No design image — auto-fit sentinel region to print area (Rect mode)
      const isSentinel =
        initialRegionPx.x === 0 &&
        initialRegionPx.y === 0 &&
        initialRegionPx.width === imageWidth &&
        initialRegionPx.height === imageHeight;
      if (!autoFitAppliedRef.current && isSentinel && printAreaPx) {
        autoFitAppliedRef.current = true;
        const next: CanvasRegionPx = {
          x: pa.x,
          y: pa.y,
          width: pa.width,
          height: pa.height,
          rotationDeg: 0,
          imageWidth,
          imageHeight,
        };
        setRegion(next);
        onChange?.(next);
      }
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setDesignImage(img);
      const isSentinel =
        initialRegionPx.x === 0 &&
        initialRegionPx.y === 0 &&
        initialRegionPx.width === imageWidth &&
        initialRegionPx.height === imageHeight;
      if (!autoFitAppliedRef.current && isSentinel) {
        autoFitAppliedRef.current = true;
        const fitted = computeFit(pa.width, pa.height, img.naturalWidth, img.naturalHeight, pa.x, pa.y);
        const next: CanvasRegionPx = { ...fitted, rotationDeg: 0, imageWidth, imageHeight };
        setRegion(next);
        onChange?.(next);
      }
    };
    img.src = designImageUrl;
    return () => { img.onload = null; };
  }, [designImageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewport = useMemo(() => {
    const maxWidth = 760;
    const maxHeight = 560;
    const fitScale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
    const scale = fitScale * zoom;
    const width = Math.min(maxWidth, Math.max(360, imageWidth * fitScale));
    const height = Math.min(maxHeight, Math.max(320, imageHeight * fitScale));
    const offsetX = (width - imageWidth * scale) / 2 + pan.x;
    const offsetY = (height - imageHeight * scale) / 2 + pan.y;
    return { width, height, scale, offsetX, offsetY };
  }, [imageHeight, imageWidth, pan.x, pan.y, zoom]);

  useEffect(() => {
    if (selected && transformerRef.current && nodeRef.current) {
      transformerRef.current.nodes([nodeRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selected, region, viewport.scale]);

  const toStage = (value: number) => value * viewport.scale;
  const fromStage = (value: number) => value / viewport.scale;
  const regionStageX = viewport.offsetX + toStage(region.x);
  const regionStageY = viewport.offsetY + toStage(region.y);
  const regionStageWidth = toStage(region.width);
  const regionStageHeight = toStage(region.height);
  const helperLabel =
    mode === "CUSTOM_COMPOSITE" ? "Vùng ghép design" : "Vị trí design Printify";

  // Print area stage coordinates
  const paStageX = viewport.offsetX + toStage(pa.x);
  const paStageY = viewport.offsetY + toStage(pa.y);
  const paStageW = toStage(pa.width);
  const paStageH = toStage(pa.height);

  // Drag bound: clamp design node within print area (like Dreamship)
  const clampDragToPA = printAreaPx
    ? (pos: { x: number; y: number }) => {
        const node = nodeRef.current;
        const nodeW = node ? node.width() * (node.scaleX?.() ?? 1) : regionStageWidth;
        const nodeH = node ? node.height() * (node.scaleY?.() ?? 1) : regionStageHeight;
        return {
          x: Math.max(paStageX, Math.min(paStageX + paStageW - nodeW, pos.x)),
          y: Math.max(paStageY, Math.min(paStageY + paStageH - nodeH, pos.y)),
        };
      }
    : undefined;

  function commitNodeTransform() {
    const node = nodeRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const nextWidth = fromStage(node.width() * scaleX);
    const nextHeight = fromStage(node.height() * scaleY);
    const nextX = fromStage(node.x() - viewport.offsetX);
    const nextY = fromStage(node.y() - viewport.offsetY);
    node.scaleX(1);
    node.scaleY(1);
    applyRegion({
      x: roundPx(nextX),
      y: roundPx(nextY),
      width: roundPx(nextWidth),
      height: roundPx(nextHeight),
      rotationDeg: roundPx(node.rotation()),
      imageWidth,
      imageHeight,
    });
  }

  function applyRegion(next: CanvasRegionPx) {
    const normalized = normalizeRegion(next, imageWidth, imageHeight);
    setRegion(normalized);
    onChange?.(normalized);
  }

  function resetEditor() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    applyRegion(initialRegionPx);
    onReset?.();
  }

  // ─── Resize modes (target print area bounds) ──────────────────────────────────
  function handleFit() {
    const dw = designImage?.naturalWidth ?? region.width;
    const dh = designImage?.naturalHeight ?? region.height;
    const fitted = computeFit(pa.width, pa.height, dw, dh, pa.x, pa.y);
    applyRegion({ ...region, ...fitted });
  }

  function handleFill() {
    applyRegion({ ...region, x: pa.x, y: pa.y, width: pa.width, height: pa.height });
  }

  function handleFile() {
    if (!designImage || !designImage.naturalWidth) { handleFit(); return; }
    const w = designImage.naturalWidth;
    const h = designImage.naturalHeight;
    applyRegion({
      ...region,
      x: Math.round(pa.x + (pa.width - w) / 2),
      y: Math.round(pa.y + (pa.height - h) / 2),
      width: w,
      height: h,
    });
  }

  function handleLogo() {
    const dw = designImage?.naturalWidth ?? region.width;
    const dh = designImage?.naturalHeight ?? region.height;
    const w = Math.round(pa.width * 0.33);
    const designAspect = dw / Math.max(1, dh);
    const h = Math.round(w / designAspect);
    applyRegion({
      ...region,
      x: Math.round(pa.x + (pa.width - w) / 2),
      y: Math.round(pa.y + pa.height * 0.1),
      width: w,
      height: h,
    });
  }

  const hasPrintAreaFrame = !!printAreaPx;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* ── Top toolbar: label + zoom + resize modes ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <strong style={{ fontSize: "0.9rem" }}>{helperLabel}</strong>
          <p style={{ margin: "2px 0 0", fontSize: "0.74rem", color: "var(--text-muted)" }}>
            Tọa độ lưu theo pixel ảnh gốc {imageWidth}x{imageHeight}.
          </p>
        </div>
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          {/* Zoom controls */}
          <button className="btn btn-secondary" type="button" onClick={() => setZoom((v) => Math.max(0.5, roundPx(v - 0.1)))}>
            Zoom -
          </button>
          <span style={{ fontSize: "0.78rem", fontWeight: 800, minWidth: 48, textAlign: "center" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button className="btn btn-secondary" type="button" onClick={() => setZoom((v) => Math.min(2.5, roundPx(v + 0.1)))}>
            Zoom +
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => setPan((v) => ({ ...v, x: v.x - 24 }))}>
            Pan trái
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => setPan((v) => ({ ...v, x: v.x + 24 }))}>
            Pan phải
          </button>

          {/* Divider */}
          <span style={{ width: 1, height: 24, background: "var(--border-default)", display: "inline-block", margin: "0 2px" }} />

          {/* Resize mode buttons */}
          {(
            [
              { label: "Fit", action: handleFit, title: "Thu/phóng vừa vùng in, giữ tỉ lệ" },
              { label: "Fill", action: handleFill, title: "Lấp đầy toàn bộ vùng in" },
              { label: "File", action: handleFile, title: "Kích thước gốc của file design" },
              { label: "Logo", action: handleLogo, title: "Thu nhỏ dạng logo ~33% vùng in" },
            ] as const
          ).map(({ label, action, title }) => (
            <button
              key={label}
              className="btn btn-secondary"
              type="button"
              title={title}
              onClick={action}
              style={{ fontSize: "0.74rem", padding: "4px 10px", fontWeight: 700 }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Canvas ── */}
      <Stage
        width={viewport.width}
        height={viewport.height}
        onMouseDown={(event) => {
          if (event.target === event.target.getStage()) setSelected(false);
        }}
        style={{
          width: "100%",
          maxWidth: viewport.width,
          borderRadius: 10,
          overflow: "hidden",
          background: "var(--bg-tertiary, #f5f3ee)",
          border: "1px solid var(--border-default)",
        }}
      >
        <Layer>
          <Rect x={0} y={0} width={viewport.width} height={viewport.height} fill="#f5f3ee" />
          {backgroundImage ? (
            <KonvaImage
              image={backgroundImage}
              x={viewport.offsetX}
              y={viewport.offsetY}
              width={toStage(imageWidth)}
              height={toStage(imageHeight)}
              listening={false}
            />
          ) : (
            <Rect
              x={viewport.offsetX}
              y={viewport.offsetY}
              width={toStage(imageWidth)}
              height={toStage(imageHeight)}
              fill="#ece7dc"
              stroke="#d6d1c8"
              strokeWidth={1}
              listening={false}
            />
          )}
          <Rect
            x={viewport.offsetX}
            y={viewport.offsetY}
            width={toStage(imageWidth)}
            height={toStage(imageHeight)}
            stroke="rgba(0,0,0,0.18)"
            strokeWidth={1}
            listening={false}
          />

          {/* ── Print area frame (teal dashed) ── */}
          {hasPrintAreaFrame && (
            <>
              <Rect
                x={paStageX}
                y={paStageY}
                width={paStageW}
                height={paStageH}
                stroke="rgba(0, 188, 212, 0.65)"
                strokeWidth={2}
                dash={[8, 4]}
                listening={false}
              />
              {/* Print area label */}
              <Text
                x={paStageX}
                y={paStageY - 16}
                text={`Vùng in ${pa.width}×${pa.height}px`}
                fontSize={10}
                fill="rgba(0, 150, 170, 0.7)"
                listening={false}
              />
            </>
          )}

          {designImage ? (
            <KonvaImage
              ref={nodeRef}
              image={designImage}
              x={regionStageX}
              y={regionStageY}
              width={regionStageWidth}
              height={regionStageHeight}
              rotation={region.rotationDeg}
              draggable
              dragBoundFunc={clampDragToPA}
              onClick={() => setSelected(true)}
              onTap={() => setSelected(true)}
              onDragEnd={commitNodeTransform}
              onTransformEnd={commitNodeTransform}
            />
          ) : (
            <>
              <Rect
                ref={nodeRef}
                x={regionStageX}
                y={regionStageY}
                width={regionStageWidth}
                height={regionStageHeight}
                rotation={region.rotationDeg}
                fill="rgba(146,198,72,0.18)"
                stroke="#5f8d25"
                strokeWidth={2}
                dash={[8, 5]}
                draggable
                dragBoundFunc={clampDragToPA}
                onClick={() => setSelected(true)}
                onTap={() => setSelected(true)}
                onDragEnd={commitNodeTransform}
                onTransformEnd={commitNodeTransform}
              />
              <Text
                x={regionStageX}
                y={regionStageY + regionStageHeight / 2 - 8}
                width={regionStageWidth}
                text="DESIGN"
                fill="#5f8d25"
                align="center"
                fontSize={14}
                fontStyle="bold"
                listening={false}
              />
            </>
          )}
          <Rect
            x={regionStageX}
            y={regionStageY}
            width={regionStageWidth}
            height={regionStageHeight}
            rotation={region.rotationDeg}
            stroke="rgba(0,0,0,0.48)"
            strokeWidth={1}
            dash={[6, 4]}
            listening={false}
          />
          {selected && (
            <Transformer
              ref={transformerRef}
              rotateEnabled={false}
              keepRatio={false}
              enabledAnchors={[
                "top-left", "top-center", "top-right",
                "middle-left", "middle-right",
                "bottom-left", "bottom-center", "bottom-right",
              ]}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 12 || newBox.height < 12) return oldBox;
                // Cap at print area boundary
                if (printAreaPx) {
                  const clamped = { ...newBox };
                  if (clamped.width > paStageW) clamped.width = paStageW;
                  if (clamped.height > paStageH) clamped.height = paStageH;
                  return clamped;
                }
                return newBox;
              }}
            />
          )}
        </Layer>
      </Stage>

      {/* ── Bottom bar: numeric inputs + Reset + Save ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {showManualInputs ? (
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap", flex: 1 }}>
            {(
              [
                { label: "X", key: "x" as const, min: -imageWidth, max: imageWidth },
                { label: "Y", key: "y" as const, min: -imageHeight, max: imageHeight },
                { label: "W", key: "width" as const, min: 1, max: imageWidth },
                { label: "H", key: "height" as const, min: 1, max: imageHeight },
                { label: "°", key: "rotationDeg" as const, min: -360, max: 360 },
              ] as const
            ).map(({ label, key, min, max }) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.74rem", color: "var(--text-muted)" }}>
                <span style={{ fontWeight: 800, minWidth: 14 }}>{label}</span>
                <input
                  type="number"
                  value={region[key]}
                  min={min}
                  max={max}
                  step={1}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      applyRegion({ ...region, [key]: val });
                    }
                  }}
                  style={{
                    width: key === "rotationDeg" ? 54 : 64,
                    padding: "3px 6px",
                    fontSize: "0.74rem",
                    borderRadius: 6,
                    border: "1px solid var(--border-default)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    textAlign: "right",
                  }}
                />
              </label>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontWeight: 800 }}>
            x {region.x}px · y {region.y}px · {region.width}x{region.height}px · {region.rotationDeg}°
          </span>
        )}

        <div className="flex items-center gap-2">
          <button className="btn btn-secondary" type="button" onClick={resetEditor}>
            Reset
          </button>
          {showSaveButton && (
            <button className="btn btn-primary" type="button" onClick={() => onSave(region)}>
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function normalizeRegion(
  region: CanvasRegionPx,
  imageWidth: number,
  imageHeight: number,
): CanvasRegionPx {
  const width = clamp(roundPx(region.width), 1, imageWidth);
  const height = clamp(roundPx(region.height), 1, imageHeight);
  const x = clamp(roundPx(region.x), -imageWidth, imageWidth);
  const y = clamp(roundPx(region.y), -imageHeight, imageHeight);
  return {
    x,
    y,
    width,
    height,
    rotationDeg: roundPx(region.rotationDeg ?? 0),
    imageWidth,
    imageHeight,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundPx(value: number) {
  return Math.round(value * 10) / 10;
}
