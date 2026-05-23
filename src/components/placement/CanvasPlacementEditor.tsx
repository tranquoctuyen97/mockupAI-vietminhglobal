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
}

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

  useEffect(() => {
    setRegion(normalizeRegion(initialRegionPx, imageWidth, imageHeight));
  }, [imageHeight, imageWidth, initialRegionPx]);

  useEffect(() => {
    setBackgroundImage(null);
    if (!backgroundImageUrl) return;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setBackgroundImage(img);
    img.src = backgroundImageUrl;
    return () => {
      img.onload = null;
    };
  }, [backgroundImageUrl]);

  useEffect(() => {
    setDesignImage(null);
    if (!designImageUrl) return;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setDesignImage(img);
    img.src = designImageUrl;
    return () => {
      img.onload = null;
    };
  }, [designImageUrl]);

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

  function centerEditor() {
    applyRegion({
      ...region,
      x: roundPx((imageWidth - region.width) / 2),
      y: roundPx((imageHeight - region.height) / 2),
      imageWidth,
      imageHeight,
    });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
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
        </div>
      </div>

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
              rotateEnabled
              enabledAnchors={[
                "top-left",
                "top-center",
                "top-right",
                "middle-left",
                "middle-right",
                "bottom-left",
                "bottom-center",
                "bottom-right",
              ]}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 12 || newBox.height < 12) return oldBox;
                return newBox;
              }}
            />
          )}
        </Layer>
      </Stage>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontWeight: 800 }}>
          x {region.x}px · y {region.y}px · {region.width}x{region.height}px · {region.rotationDeg}°
        </span>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary" type="button" onClick={centerEditor}>
            Căn giữa
          </button>
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
