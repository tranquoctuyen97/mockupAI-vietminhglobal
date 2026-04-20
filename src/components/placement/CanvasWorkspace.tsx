"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Line } from "react-konva";
import useImage from "use-image";
import type { Placement, PrintArea } from "@/lib/placement/types";
import { KEYBOARD_MAP, buildKeyName, isTypingInInput } from "@/lib/placement/keyboard";

interface CanvasWorkspaceProps {
  placement: Placement;
  printArea: PrintArea;
  designPreviewUrl: string | null;
  productBgColor: string;
  onChange: (patch: Partial<Placement>) => void;
}

export default function CanvasWorkspace({
  placement,
  printArea,
  designPreviewUrl,
  productBgColor,
  onChange,
}: CanvasWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 600 });
  const [designImg] = useImage(designPreviewUrl || "");
  const designRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  const [isSelected, setIsSelected] = useState(true);
  const [isShiftHeld, setIsShiftHeld] = useState(false);

  // Track Shift key for snap override
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftHeld(e.type === "keydown");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // Resize observer
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height });
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Attach transformer to design node
  useEffect(() => {
    if (designRef.current && transformerRef.current) {
      transformerRef.current.nodes([designRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [designImg, isSelected]);

  // ── Keyboard shortcuts (Phase 6.7 fix: window level, gated by isSelected) ──
  const dispatchKeyAction = useCallback((key: string) => {
    const action = KEYBOARD_MAP[key];
    if (!action) return;

    switch (action.type) {
      case "nudge":
        onChange({ [action.axis === "x" ? "xMm" : "yMm"]: (action.axis === "x" ? placement.xMm : placement.yMm) + action.amount });
        break;
      case "rotate":
        onChange({ rotationDeg: Math.max(-180, Math.min(180, placement.rotationDeg + action.amount)) });
        break;
      case "center":
        if (action.axis === "x" || action.axis === "both") onChange({ xMm: 0 });
        if (action.axis === "y" || action.axis === "both") onChange({ yMm: printArea.heightMm / 2 });
        break;
      case "mirror":
        onChange({ mirrored: !placement.mirrored });
        break;
      case "scale":
        onChange({
          widthMm: placement.widthMm * action.factor,
          heightMm: placement.lockAspect ? placement.heightMm * action.factor : placement.heightMm,
        });
        break;
      case "reset":
        // reset is handled by parent
        break;
    }
  }, [placement, printArea.heightMm, onChange]);

  useEffect(() => {
    if (!isSelected) return;
    const handler = (e: KeyboardEvent) => {
      if (isTypingInInput(e.target)) return;
      const key = buildKeyName(e);
      if (KEYBOARD_MAP[key]) {
        e.preventDefault();
        dispatchKeyAction(key);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isSelected, dispatchKeyAction]);

  // mm → px helpers
  const pxPerMm = Math.min(
    dimensions.width / (printArea.widthMm * 1.5),
    dimensions.height / (printArea.heightMm * 1.5),
  );
  const mmToPx = (mm: number) => mm * pxPerMm;
  const stageCenterX = dimensions.width / 2;
  const stageCenterY = dimensions.height / 2;

  const printW = mmToPx(printArea.widthMm);
  const printH = mmToPx(printArea.heightMm);
  const safeMargin = mmToPx(printArea.safeMarginMm);

  // Design position (xMm is center-relative to print area center)
  const xPx = stageCenterX + mmToPx(placement.xMm);
  const yPx = stageCenterY - mmToPx(printArea.heightMm / 2) + mmToPx(placement.yMm);
  const wPx = mmToPx(placement.widthMm);
  const hPx = mmToPx(placement.heightMm);

  // Snapping guides
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});

  const handleDragMove = (e: any) => {
    const node = e.target;
    let newX = node.x();
    let newY = node.y();
    const snapDist = mmToPx(3);
    const newGuides: { x?: number; y?: number } = {};

    if (Math.abs(newX - stageCenterX) < snapDist) { newX = stageCenterX; newGuides.x = stageCenterX; }
    if (Math.abs(newY - stageCenterY) < snapDist) { newY = stageCenterY; newGuides.y = stageCenterY; }

    node.position({ x: newX, y: newY });
    setGuides(newGuides);
  };

  const handleDragEnd = (e: any) => {
    const node = e.target;
    setGuides({});
    const printAreaTopPx = stageCenterY - printH / 2;
    onChange({
      xMm: (node.x() - stageCenterX) / pxPerMm,
      yMm: (node.y() - printAreaTopPx) / pxPerMm,
    });
  };

  const handleTransformEnd = () => {
    const node = designRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    const printAreaTopPx = stageCenterY - printH / 2;
    onChange({
      xMm: (node.x() - stageCenterX) / pxPerMm,
      yMm: (node.y() - printAreaTopPx) / pxPerMm,
      widthMm: (node.width() * Math.abs(scaleX)) / pxPerMm,
      heightMm: (node.height() * Math.abs(scaleY)) / pxPerMm,
      rotationDeg: node.rotation(),
    });
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[500px] flex items-center justify-center rounded-lg border relative overflow-hidden cursor-crosshair"
      style={{ backgroundColor: productBgColor }}
    >
      <Stage width={dimensions.width} height={dimensions.height}>
        {/* Layer 1: Print area zones */}
        <Layer>
          <Rect
            x={stageCenterX - printW / 2}
            y={stageCenterY - printH / 2}
            width={printW}
            height={printH}
            stroke="#94A3B8"
            strokeWidth={1}
            dash={[4, 4]}
          />
          <Rect
            x={stageCenterX - printW / 2 + safeMargin}
            y={stageCenterY - printH / 2 + safeMargin}
            width={printW - safeMargin * 2}
            height={printH - safeMargin * 2}
            stroke="var(--color-wise-green)"
            strokeWidth={1}
            dash={[6, 4]}
          />
        </Layer>

        {/* Layer 2: Design + Transformer */}
        <Layer>
          {designImg ? (
            <KonvaImage
              image={designImg}
              ref={designRef}
              x={xPx}
              y={yPx}
              width={wPx}
              height={hPx}
              offsetX={wPx / 2}
              offsetY={hPx / 2}
              rotation={placement.rotationDeg}
              scaleX={placement.mirrored ? -1 : 1}
              draggable
              onClick={() => setIsSelected(true)}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onTransformEnd={handleTransformEnd}
            />
          ) : (
            <Rect
              x={xPx}
              y={yPx}
              width={wPx}
              height={hPx}
              offsetX={wPx / 2}
              offsetY={hPx / 2}
              fill="rgba(0,0,0,0.1)"
              stroke="#64748B"
              dash={[5, 5]}
            />
          )}

          {isSelected && (
            <Transformer
              ref={transformerRef}
              keepRatio={placement.lockAspect}
              shiftBehavior={placement.lockAspect ? "inverted" : "default"}
              rotationSnaps={isShiftHeld ? [] : [0, 45, 90, 135, 180, 225, 270, 315]}
              rotationSnapTolerance={3}
              anchorSize={12}
              borderStroke="var(--color-wise-green)"
              anchorStroke="var(--color-wise-green)"
              anchorFill="white"
              boundBoxFunc={(oldBox, newBox) => {
                const minPx = mmToPx(10);
                if (Math.abs(newBox.width) < minPx || Math.abs(newBox.height) < minPx) return oldBox;
                return newBox;
              }}
            />
          )}
        </Layer>

        {/* Layer 3: Snap guides */}
        <Layer>
          {guides.x !== undefined && (
            <Line points={[guides.x, 0, guides.x, dimensions.height]} stroke="var(--color-wise-green)" strokeWidth={1} dash={[4, 4]} />
          )}
          {guides.y !== undefined && (
            <Line points={[0, guides.y, dimensions.width, guides.y]} stroke="var(--color-wise-green)" strokeWidth={1} dash={[4, 4]} />
          )}
        </Layer>
      </Stage>

      {/* hint */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none text-[10px] text-white/60 bg-black/20 px-2 py-0.5 rounded">
        Arrows ±1mm · Shift ±10mm · Alt ±0.1mm · R rotate · F flip · Cmd+Z undo
      </div>
    </div>
  );
}
