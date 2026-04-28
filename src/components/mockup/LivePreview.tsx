"use client";

/**
 * LivePreview — Realistic t-shirt mockup preview component
 *
 * Inspired by Printify's editor. Renders an SVG t-shirt silhouette
 * (Bella+Canvas style) with variant color fill, print area visualization,
 * and design composited at placement coordinates.
 *
 * Use case: Wizard step-3 instant preview before user clicks "Tạo Mockups".
 * No backend roundtrip, no waiting — drag color picker to switch tint live.
 */

import { useState } from "react";
import {
  ShirtView,
  VIEW_LABELS,
  SVG_VIEWBOX_W,
  SVG_VIEWBOX_H,
  SHIRT_BOUNDS,
  PRINT_AREA_CENTER_X,
  PRINT_AREA_CENTER_Y,
  PRINT_AREA_SVG_HEIGHT,
  shirtBodyPath,
  darken,
  strokeColor,
} from "@/lib/mockup/svg-utils";

export interface PlacementSpec {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg?: number;
}

export interface PrintAreaSpec {
  widthMm: number;
  heightMm: number;
  safeMarginMm: number;
}

interface Props {
  /** Variant color hex, e.g. "#FF6B1A" for orange */
  colorHex: string;
  /** URL of design preview image (PNG/JPG with transparency) */
  designUrl?: string | null;
  /** Placement of design within print area (in mm) */
  placement: PlacementSpec;
  /** Per-view placement map — overrides `placement` when view matches */
  placementsByView?: Partial<Record<ShirtView, PlacementSpec | null>>;
  /** Print area dimensions in mm */
  printArea: PrintAreaSpec;
  /** Available views — default Front+Back */
  availableViews?: ShirtView[];
  /** Initial view, default "front" */
  initialView?: ShirtView;
  /** Controlled selected view (parent manages state) */
  selectedView?: ShirtView;
  /** Callback when user clicks a view tab */
  onViewChange?: (view: ShirtView) => void;
  /** Show view tabs at bottom (default true) */
  showTabs?: boolean;
  /** Container height in px (default 480) */
  height?: number;
}



export function LivePreview({
  colorHex,
  designUrl,
  placement,
  placementsByView,
  printArea,
  availableViews = ["front", "back", "sleeve_left", "sleeve_right"],
  initialView = "front",
  selectedView,
  onViewChange,
  showTabs = true,
  height = 480,
}: Props) {
  const [internalView, setInternalView] = useState<ShirtView>(initialView);
  const view = selectedView ?? internalView;
  const activePlacement = placementsByView?.[view] ?? placement;

  function selectView(nextView: ShirtView) {
    setInternalView(nextView);
    onViewChange?.(nextView);
  }

  const bodyPath = shirtBodyPath(view);
  const stroke = strokeColor(colorHex);
  const innerCollar = darken(colorHex, 0.25);

  // Compute print area dimensions in SVG coords based on physical mm
  // Maintain aspect ratio of physical print area
  const printAreaAspect = printArea.widthMm / printArea.heightMm;
  const paSvgH = PRINT_AREA_SVG_HEIGHT;
  const paSvgW = paSvgH * printAreaAspect;
  const paSvgX = PRINT_AREA_CENTER_X - paSvgW / 2;
  const paSvgY = PRINT_AREA_CENTER_Y - paSvgH / 2;

  // mm → SVG units conversion
  const mmToSvg = paSvgH / printArea.heightMm;

  // Safety margin (inner dashed)
  const safeMargin = printArea.safeMarginMm * mmToSvg;

  // Design position in SVG coords (placement is mm from print-area top-left)
  const designSvgX = paSvgX + activePlacement.xMm * mmToSvg;
  const designSvgY = paSvgY + activePlacement.yMm * mmToSvg;
  const designSvgW = activePlacement.widthMm * mmToSvg;
  const designSvgH = activePlacement.heightMm * mmToSvg;

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* Mockup canvas */}
      <div
        style={{
          width: "100%",
          height,
          backgroundColor: "var(--bg-tertiary, #f5f3ee)",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <svg
          viewBox={`0 0 ${SVG_VIEWBOX_W} ${SVG_VIEWBOX_H}`}
          style={{ width: "auto", height: "100%", maxWidth: "100%" }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Subtle drop shadow */}
            <filter id="shirtShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
              <feOffset dx="0" dy="4" result="offsetblur" />
              <feFlood floodColor="#000" floodOpacity="0.15" />
              <feComposite in2="offsetblur" operator="in" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Shirt body — fill with variant color */}
          <path
            d={bodyPath}
            fill={colorHex}
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
            filter="url(#shirtShadow)"
          />

          {(view === "front" || view === "back") && (
            <>
              {/* Inner collar — slightly darker for depth (front only really) */}
              {view === "front" && (
                <path
                  d="M 230,82 C 240,140 270,165 300,165 C 330,165 360,140 370,82 Z"
                  fill={innerCollar}
                  stroke={stroke}
                  strokeWidth="1.5"
                />
              )}
              {/* Back has narrower neck opening */}
              {view === "back" && (
                <path
                  d="M 250,82 C 260,110 280,125 300,125 C 320,125 340,110 350,82 Z"
                  fill={innerCollar}
                  stroke={stroke}
                  strokeWidth="1.5"
                />
              )}
              {/* Sleeve stitches */}
              <path
                d="M 130,250 Q 150,255 170,255"
                stroke={stroke}
                strokeWidth="1"
                strokeDasharray="4,3"
                fill="none"
                opacity="0.6"
              />
              <path
                d="M 470,250 Q 450,255 430,255"
                stroke={stroke}
                strokeWidth="1"
                strokeDasharray="4,3"
                fill="none"
                opacity="0.6"
              />
              {/* Hem stitches */}
              <line
                x1="145"
                y1="640"
                x2="455"
                y2="640"
                stroke={stroke}
                strokeWidth="1"
                strokeDasharray="3,2"
                opacity="0.5"
              />
            </>
          )}

          {/* Print area dashed (outer) — only on Front/Back */}
          {(view === "front" || view === "back") && (
            <>
              <rect
                x={paSvgX}
                y={paSvgY}
                width={paSvgW}
                height={paSvgH}
                fill="none"
                stroke="#000"
                strokeWidth="1.5"
                strokeDasharray="6,4"
                opacity="0.5"
              />
              {/* Safety margin (inner dashed) */}
              <rect
                x={paSvgX + safeMargin}
                y={paSvgY + safeMargin}
                width={paSvgW - safeMargin * 2}
                height={paSvgH - safeMargin * 2}
                fill="none"
                stroke="#fff"
                strokeWidth="1"
                strokeDasharray="3,3"
                opacity="0.7"
              />

              {/* Design overlay */}
              {designUrl && designSvgW > 0 && designSvgH > 0 && (
                <g
                  transform={
                    activePlacement.rotationDeg
                      ? `rotate(${activePlacement.rotationDeg} ${designSvgX + designSvgW / 2} ${designSvgY + designSvgH / 2})`
                      : undefined
                  }
                >
                  <image
                    href={designUrl}
                    x={designSvgX}
                    y={designSvgY}
                    width={designSvgW}
                    height={designSvgH}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ pointerEvents: "none" }}
                  />
                </g>
              )}
            </>
          )}

          {/* Sleeve view — show small print area on sleeve */}
          {(view === "sleeve_left" || view === "sleeve_right") && (
            <>
              <rect
                x="245"
                y="280"
                width="110"
                height="110"
                fill="none"
                stroke="#000"
                strokeWidth="1.5"
                strokeDasharray="4,3"
                opacity="0.5"
              />
              <text
                x="300"
                y="430"
                fill={stroke}
                fontSize="14"
                textAnchor="middle"
                opacity="0.5"
              >
                Tay áo (chưa hỗ trợ design)
              </text>
            </>
          )}

          {/* Neck label view */}
          {view === "neck_label" && (
            <text
              x="300"
              y="330"
              fill={stroke}
              fontSize="14"
              textAnchor="middle"
              opacity="0.5"
            >
              Nhãn cổ áo (chưa hỗ trợ design)
            </text>
          )}
        </svg>
      </div>

      {/* View tabs (Printify-style pills) */}
      {showTabs && availableViews.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 16,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {availableViews.map((v) => {
            const active = v === view;
            return (
              <button
                key={v}
                onClick={() => selectView(v)}
                style={{
                  padding: "8px 18px",
                  borderRadius: 999,
                  fontSize: "0.82rem",
                  fontWeight: active ? 700 : 500,
                  border: "1px solid",
                  borderColor: active ? "var(--text-primary, #2a2a2a)" : "var(--border-default)",
                  background: active ? "var(--text-primary, #2a2a2a)" : "transparent",
                  color: active ? "var(--bg-primary, #fff)" : "var(--text-primary)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {VIEW_LABELS[v]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
