"use client";

/**
 * PlacementEditor — Konva-based visual placement editor
 * Shared component: Store Config tab + Wizard step-3
 *
 * Usage:
 *   import dynamic from "next/dynamic";
 *   const PlacementEditor = dynamic(
 *     () => import("@/components/placement/PlacementEditor").then(m => m.PlacementEditor),
 *     { ssr: false }
 *   );
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Stage, Layer, Rect, Text, Transformer, Image as KonvaImage } from "react-konva";
import type { Placement } from "@/lib/placement/types";

// ─── Types ───────────────────────────────────────────────────────────

export interface PrintAreaDims {
  widthMm: number;
  heightMm: number;
  safeMarginMm: number;
}

interface Props {
  printArea: PrintAreaDims;
  placement: Placement;
  onChange: (next: Placement) => void;
  bgColor?: string;        // solid color background (e.g. first variant hex)
  bgImageUrl?: string;     // mockup image as background for the canvas
  designUrl?: string;       // optional: real design preview image
  readOnly?: boolean;
  canvasWidth?: number;
  canvasHeight?: number;
}

// ─── Default print area (Gildan 5000 / standard DTG) ─────────────────
export const DEFAULT_PRINT_AREA: PrintAreaDims = {
  widthMm: 355.6,
  heightMm: 406.4,
  safeMarginMm: 12.7,
};

// ─── Component ───────────────────────────────────────────────────────

export function PlacementEditor({
  printArea,
  placement,
  onChange,
  bgColor = "#EEEEEE",
  bgImageUrl,
  designUrl,
  readOnly = false,
  canvasWidth = 400,
  canvasHeight = 480,
}: Props) {
  const rectRef = useRef<any>(null);
  const trRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);
  const [designImg, setDesignImg] = useState<HTMLImageElement | null>(null);

  // Measure actual container width so Stage never overflows (fixes visual misalignment)
  const [containerWidth, setContainerWidth] = useState<number>(canvasWidth);
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerWidth(w);
    });
    observer.observe(containerRef.current);
    // Initial measurement
    const w = containerRef.current.getBoundingClientRect().width;
    if (w > 0) setContainerWidth(w);
    return () => observer.disconnect();
  }, []);

  // Scale Stage proportionally if container is narrower than requested canvasWidth
  const scale = Math.min(1, containerWidth / canvasWidth);
  const effectiveWidth = Math.round(canvasWidth * scale);
  const effectiveHeight = Math.round(canvasHeight * scale);

  // Compute scale: fit print area into canvas with padding
  const padding = 40 * scale;
  const scaleX = (effectiveWidth - padding * 2) / printArea.widthMm;
  const scaleY = (effectiveHeight - padding * 2) / printArea.heightMm;
  const mmPerPx = Math.min(scaleX, scaleY);

  const toPx = (mm: number) => mm * mmPerPx;
  const toMm = (px: number) => px / mmPerPx;

  // Print area rect position (centered)
  const paX = (effectiveWidth - toPx(printArea.widthMm)) / 2;
  const paY = (effectiveHeight - toPx(printArea.heightMm)) / 2;

  // Design rect absolute position in canvas coordinates
  const designPxX = paX + toPx(placement.xMm);
  const designPxY = paY + toPx(placement.yMm);
  const designPxW = toPx(placement.widthMm);
  const designPxH = toPx(placement.heightMm);

  // Attach transformer when selected
  useEffect(() => {
    if (selected && trRef.current && rectRef.current) {
      trRef.current.nodes([rectRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selected]);

  // Load background mockup image
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!bgImageUrl) { setBgImage(null); return; }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = bgImageUrl;
    img.onload = () => setBgImage(img);
    return () => { img.onload = null; };
  }, [bgImageUrl]);

  // Pre-compute bgImage draw dimensions — Dreamship-style: contain-fit into full canvas
  const bgDraw = useMemo(() => {
    if (!bgImage) return null;
    const imgW = bgImage.naturalWidth || bgImage.width;
    const imgH = bgImage.naturalHeight || bgImage.height;
    const imgAspect = imgW / imgH;
    const cvAspect = effectiveWidth / effectiveHeight;
    let drawW: number, drawH: number;
    if (imgAspect > cvAspect) {
      drawW = effectiveWidth;
      drawH = effectiveWidth / imgAspect;
    } else {
      drawH = effectiveHeight;
      drawW = effectiveHeight * imgAspect;
    }
    return {
      x: (effectiveWidth - drawW) / 2,
      y: (effectiveHeight - drawH) / 2,
      width: drawW,
      height: drawH,
    };
  }, [bgImage, effectiveWidth, effectiveHeight]);

  // Load design image
  useEffect(() => {
    if (!designUrl) { setDesignImg(null); return; }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = designUrl;
    img.onload = () => setDesignImg(img);
    return () => { img.onload = null; };
  }, [designUrl]);

  const handleDragEnd = useCallback((e: any) => {
    const newX = toMm(e.target.x() - paX);
    const newY = toMm(e.target.y() - paY);
    onChange({ ...placement, xMm: Math.round(newX * 10) / 10, yMm: Math.round(newY * 10) / 10 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement, onChange, paX, paY]);

  const handleTransformEnd = useCallback(() => {
    const node = rectRef.current;
    if (!node) return;
    const sx = node.scaleX();
    const sy = node.scaleY();
    const rotation = node.rotation();

    // Reset scale, apply to dimensions
    node.scaleX(1);
    node.scaleY(1);

    const newW = toMm(node.width() * sx);
    const newH = toMm(node.height() * sy);
    const newX = toMm(node.x() - paX);
    const newY = toMm(node.y() - paY);

    onChange({
      ...placement,
      xMm: Math.round(newX * 10) / 10,
      yMm: Math.round(newY * 10) / 10,
      widthMm: Math.round(newW * 10) / 10,
      heightMm: Math.round(newH * 10) / 10,
      rotationDeg: Math.round(rotation * 10) / 10,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement, onChange, paX, paY]);

  return (
    <div ref={containerRef} style={{ width: "100%" }}>
    <Stage
      width={effectiveWidth}
      height={effectiveHeight}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage()) setSelected(false);
      }}
      style={{ borderRadius: 8, overflow: "hidden" }}
    >
      <Layer>
        {/* Background fill */}
        <Rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill="#f5f5f5" />

        {/* Mockup background image OR solid color fallback */}
        {bgImage && bgDraw ? (
          <KonvaImage
            image={bgImage}
            x={bgDraw.x}
            y={bgDraw.y}
            width={bgDraw.width}
            height={bgDraw.height}
            listening={false}
          />
        ) : (
          <Rect
            x={paX}
            y={paY}
            width={toPx(printArea.widthMm)}
            height={toPx(printArea.heightMm)}
            fill={bgColor}
            cornerRadius={4}
          />
        )}

        {/* Print area dashed outline — Dreamship-style teal */}
        <Rect
          x={paX}
          y={paY}
          width={toPx(printArea.widthMm)}
          height={toPx(printArea.heightMm)}
          stroke="rgba(0, 188, 212, 0.65)"
          strokeWidth={2}
          dash={[8, 4]}
          cornerRadius={0}
        />

        {/* Safe margin */}
        <Rect
          x={paX + toPx(printArea.safeMarginMm)}
          y={paY + toPx(printArea.safeMarginMm)}
          width={toPx(printArea.widthMm - printArea.safeMarginMm * 2)}
          height={toPx(printArea.heightMm - printArea.safeMarginMm * 2)}
          stroke="rgba(0,0,0,0.1)"
          strokeWidth={1}
          dash={[4, 4]}
        />

        {/* Design rectangle (draggable + transformable) */}
        {designImg ? (
          <KonvaImage
            ref={rectRef}
            image={designImg}
            x={designPxX}
            y={designPxY}
            width={designPxW}
            height={designPxH}
            rotation={placement.rotationDeg}
            draggable={!readOnly}
            dragBoundFunc={readOnly ? undefined : (pos) => ({
              x: Math.max(paX, Math.min(paX + toPx(printArea.widthMm) - (rectRef.current?.width() * (rectRef.current?.scaleX?.() ?? 1) || designPxW), pos.x)),
              y: Math.max(paY, Math.min(paY + toPx(printArea.heightMm) - (rectRef.current?.height() * (rectRef.current?.scaleY?.() ?? 1) || designPxH), pos.y)),
            })}
            onClick={() => !readOnly && setSelected(true)}
            onTap={() => !readOnly && setSelected(true)}
            onDragEnd={handleDragEnd}
            onTransformEnd={handleTransformEnd}
          />
        ) : (
          <>
            <Rect
              ref={rectRef}
              x={designPxX}
              y={designPxY}
              width={designPxW}
              height={designPxH}
              rotation={placement.rotationDeg}
              fill="rgba(59, 130, 246, 0.2)"
              stroke="#3b82f6"
              strokeWidth={2}
              cornerRadius={4}
              draggable={!readOnly}
              dragBoundFunc={readOnly ? undefined : (pos) => ({
                x: Math.max(paX, Math.min(paX + toPx(printArea.widthMm) - (rectRef.current?.width() * (rectRef.current?.scaleX?.() ?? 1) || designPxW), pos.x)),
                y: Math.max(paY, Math.min(paY + toPx(printArea.heightMm) - (rectRef.current?.height() * (rectRef.current?.scaleY?.() ?? 1) || designPxH), pos.y)),
              })}
              onClick={() => !readOnly && setSelected(true)}
              onTap={() => !readOnly && setSelected(true)}
              onDragEnd={handleDragEnd}
              onTransformEnd={handleTransformEnd}
            />
            <Text
              x={designPxX}
              y={designPxY + designPxH / 2 - 8}
              width={designPxW}
              text="DESIGN"
              fontSize={14}
              fontStyle="bold"
              fill="#3b82f6"
              align="center"
              listening={false}
            />
          </>
        )}

        {/* Transformer — Dreamship-style: 8 handles (4 corners + 4 edges) */}
        {selected && !readOnly && (
          <Transformer
            ref={trRef}
            enabledAnchors={[
              "top-left", "top-center", "top-right",
              "middle-left", "middle-right",
              "bottom-left", "bottom-center", "bottom-right",
            ]}
            rotateEnabled={false}
            keepRatio={false}
            boundBoxFunc={(oldBox, newBox) => {
              const minSize = 10 * mmPerPx;
              if (newBox.width < minSize || newBox.height < minSize) return oldBox;
              // Cap at print area boundary
              const paW = toPx(printArea.widthMm);
              const paH = toPx(printArea.heightMm);
              const clamped = { ...newBox };
              if (clamped.width > paW) clamped.width = paW;
              if (clamped.height > paH) clamped.height = paH;
              return clamped;
            }}
          />
        )}

        {/* Labels */}
        <Text
          x={paX}
          y={paY - 16}
          text={`Vùng in: ${printArea.widthMm}\u00d7${printArea.heightMm} mm`}
          fontSize={10}
          fill="#888"
        />
      </Layer>
    </Stage>
    </div>
  );
}
