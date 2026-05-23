"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Rnd } from "react-rnd";

export interface CompositeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
}

interface CompositeRegionEditorProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  value: CompositeRegion | null;
  onChange: (region: CompositeRegion) => void;
  designImageUrl?: string | null;
  context?: "wizard" | "library";
  scope?: "DRAFT" | "TEMPLATE";
  compact?: boolean;
}

const MAX_DISPLAY_WIDTH = 520;

export function CompositeRegionEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  value,
  onChange,
  designImageUrl,
  context,
  scope = "TEMPLATE",
  compact = false,
}: CompositeRegionEditorProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [displayWidth, setDisplayWidth] = useState(Math.min(MAX_DISPLAY_WIDTH, imageWidth || MAX_DISPLAY_WIDTH));
  const [zoom, setZoom] = useState(1);
  const region = useMemo(
    () => value ?? defaultRegion(imageWidth, imageHeight),
    [value, imageWidth, imageHeight],
  );
  const scale = imageWidth > 0 ? displayWidth / imageWidth : 1;
  const displayHeight = Math.max(1, Math.round(imageHeight * scale));
  const presets = useMemo(() => buildPresets(imageWidth, imageHeight), [imageWidth, imageHeight]);
  const activePreset = presets.find((preset) => sameRegion(preset.region, region));
  const hasDesignPreview = Boolean(designImageUrl);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;

    const updateDisplayWidth = () => {
      const width = image.clientWidth || Math.min(MAX_DISPLAY_WIDTH, imageWidth);
      setDisplayWidth(width);
    };
    updateDisplayWidth();

    const observer = new ResizeObserver(updateDisplayWidth);
    observer.observe(image);
    return () => observer.disconnect();
  }, [imageWidth]);

  function updateRegion(next: Partial<CompositeRegion>) {
    onChange({
      ...region,
      ...next,
      x: Math.max(0, Math.round(next.x ?? region.x)),
      y: Math.max(0, Math.round(next.y ?? region.y)),
      width: Math.max(1, Math.round(next.width ?? region.width)),
      height: Math.max(1, Math.round(next.height ?? region.height)),
      rotationDeg: Number(next.rotationDeg ?? region.rotationDeg),
    });
  }

  function updateField(field: keyof CompositeRegion, rawValue: string) {
    const parsed = field === "rotationDeg"
      ? Number.parseFloat(rawValue)
      : Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed)) return;
    updateRegion({ [field]: parsed } as Partial<CompositeRegion>);
  }

  function resetRegion() {
    const next = defaultRegion(imageWidth, imageHeight);
    setZoom(1);
    onChange(next);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {context === "wizard" && (
        <div
          style={{
            padding: "9px 12px",
            borderRadius: 10,
            fontSize: "0.76rem",
            fontWeight: 850,
            lineHeight: 1.45,
            background: scope === "DRAFT" ? "rgba(124,58,237,0.1)" : "rgba(59,130,246,0.08)",
            color: scope === "DRAFT" ? "#6d28d9" : "#1d4ed8",
            border: scope === "DRAFT" ? "1px solid rgba(124,58,237,0.22)" : "1px solid rgba(59,130,246,0.2)",
          }}
        >
          {scope === "DRAFT"
            ? "Bạn đang chỉnh mockup riêng cho listing này. Thay đổi lưu trực tiếp vào draft."
            : "Bạn đang chỉnh vùng ghép cho listing này. Thay đổi này không ảnh hưởng tới Thư viện mockup."}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "minmax(0, 1fr) 320px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div
            className="flex items-center justify-between gap-3"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              background: "var(--bg-inset, #f6f6f4)",
              border: "1px solid var(--border-default)",
            }}
          >
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary" type="button" style={iconButton} onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
                <ZoomOut size={14} />
              </button>
              <button className="btn btn-secondary" type="button" style={iconButton} onClick={() => setZoom((z) => Math.min(1.8, z + 0.1))}>
                <ZoomIn size={14} />
              </button>
              <span style={{ fontSize: "0.78rem", fontWeight: 900 }}>
                Zoom {Math.round(zoom * 100)}%
              </span>
            </div>
            <button className="btn btn-secondary" type="button" style={{ padding: "6px 10px", fontSize: "0.74rem" }} onClick={resetRegion}>
              <RotateCcw size={14} />
              Đặt lại
            </button>
          </div>

          <div
            style={{
              width: "100%",
              overflow: "auto",
              borderRadius: 12,
              border: "1px solid var(--border-default)",
              background: "#1a1a1a",
              padding: 12,
            }}
          >
            <div
              style={{
                position: "relative",
                width: Math.round(displayWidth * zoom),
                height: Math.round(displayHeight * zoom),
                minWidth: Math.round(displayWidth * zoom),
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: displayWidth,
                  height: displayHeight,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                <img
                  ref={imageRef}
                  alt=""
                  src={imageUrl}
                  style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                />
                <div style={{ position: "absolute", inset: 0, width: displayWidth, height: displayHeight }}>
                  <Rnd
                    bounds="parent"
                    minWidth={24}
                    minHeight={24}
                    scale={zoom}
                    position={{
                      x: Math.round(region.x * scale),
                      y: Math.round(region.y * scale),
                    }}
                    size={{
                      width: Math.round(region.width * scale),
                      height: Math.round(region.height * scale),
                    }}
                    onDragStop={(_, data) => {
                      updateRegion({
                        x: Math.round(data.x / scale),
                        y: Math.round(data.y / scale),
                      });
                    }}
                    onResizeStop={(_, __, ref, ___, position) => {
                      updateRegion({
                        x: Math.round(position.x / scale),
                        y: Math.round(position.y / scale),
                        width: Math.round(ref.offsetWidth / scale),
                        height: Math.round(ref.offsetHeight / scale),
                      });
                    }}
                    style={{
                      border: "2px solid var(--color-wise-green)",
                      background: "rgba(159,232,112,0.22)",
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.16)",
                    }}
                    >
                    <DesignRegionPreview
                      designImageUrl={designImageUrl}
                      hasDesignPreview={hasDesignPreview}
                      rotationDeg={region.rotationDeg}
                    />
                  </Rnd>
                </div>
              </div>
            </div>
          </div>

          <label style={{ display: "grid", gap: 6, fontSize: "0.78rem", fontWeight: 700 }}>
            Rotation (degrees)
            <input
              name="rotationDeg"
              type="number"
              min={-360}
              max={360}
              value={region.rotationDeg}
              onChange={(event) => updateField("rotationDeg", event.target.value)}
              style={inputStyle}
            />
          </label>

          <details open={!compact}>
            <summary style={{ cursor: "pointer", fontSize: "0.8rem", fontWeight: 800 }}>
              Advanced
            </summary>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 8,
                marginTop: 10,
              }}
            >
              {(["x", "y", "width", "height", "rotationDeg"] as const).map((field) => (
                <label key={field} style={{ display: "grid", gap: 4, fontSize: "0.72rem", fontWeight: 700 }}>
                  {field}
                  <input
                    name={field}
                    type="number"
                    value={region[field]}
                    onChange={(event) => updateField(field, event.target.value)}
                    style={inputStyle}
                  />
                </label>
              ))}
            </div>
          </details>
        </div>

        <aside style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: "0.86rem", fontWeight: 950 }}>Mẫu nhanh</h3>
            {presets.map((preset) => {
              const active = activePreset?.name === preset.name;
              return (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => onChange(preset.region)}
                  style={{
                    textAlign: "left",
                    borderRadius: 10,
                    padding: "9px 10px",
                    border: active ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                    background: active ? "rgba(159,232,112,0.14)" : "var(--bg-primary)",
                    cursor: "pointer",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong style={{ fontSize: "0.78rem" }}>{active ? "✓  " : ""}{preset.name}</strong>
                    {active && <span style={{ fontSize: "0.64rem", fontWeight: 900 }}>active</span>}
                  </div>
                  <span style={{ display: "block", marginTop: 3, fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 800 }}>
                    {preset.region.x}·{preset.region.y} — {preset.region.x + preset.region.width}·{preset.region.y + preset.region.height}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="card" style={{ padding: 12, display: "grid", gap: 9 }}>
            <h3 style={{ margin: 0, fontSize: "0.86rem", fontWeight: 950 }}>Xem trước</h3>
            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: `${imageWidth || 1} / ${imageHeight || 1}`,
                borderRadius: 10,
                overflow: "hidden",
                background: "#1a1a1a",
              }}
            >
              <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
              <div
                style={{
                  position: "absolute",
                  left: `${Math.max(0, Math.min(100, (region.x / imageWidth) * 100))}%`,
                  top: `${Math.max(0, Math.min(100, (region.y / imageHeight) * 100))}%`,
                  width: `${Math.max(2, Math.min(100, (region.width / imageWidth) * 100))}%`,
                  height: `${Math.max(2, Math.min(100, (region.height / imageHeight) * 100))}%`,
                  background: "rgba(159,232,112,0.28)",
                  border: "1px solid var(--color-wise-green)",
                  transform: `rotate(${region.rotationDeg}deg)`,
                  transformOrigin: "center",
                }}
              >
                {hasDesignPreview && (
                  <img
                    src={designImageUrl ?? undefined}
                    alt=""
                    draggable={false}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      display: "block",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>
            </div>
            <p style={{ margin: 0, fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.45 }}>
              {hasDesignPreview
                ? "Xem trước đang dùng design hiện tại của listing."
                : "Chưa có preview design; vùng ghép vẫn sẽ lưu cho listing này."}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function DesignRegionPreview({
  designImageUrl,
  hasDesignPreview,
  rotationDeg,
}: {
  designImageUrl?: string | null;
  hasDesignPreview: boolean;
  rotationDeg: number;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontSize: 12,
        fontWeight: 900,
        background: hasDesignPreview ? "rgba(255,255,255,0.08)" : "rgba(22,51,0,0.16)",
        overflow: "hidden",
        transform: `rotate(${rotationDeg}deg)`,
        transformOrigin: "center",
      }}
    >
      {hasDesignPreview ? (
        <img
          src={designImageUrl ?? undefined}
          alt=""
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            pointerEvents: "none",
          }}
        />
      ) : (
        "Design"
      )}
    </div>
  );
}

function buildPresets(imageWidth: number, imageHeight: number) {
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);
  return [
    {
      name: "Trước ngực",
      region: {
        x: Math.round(width * 0.3),
        y: Math.round(height * 0.33),
        width: Math.round(width * 0.4),
        height: Math.round(height * 0.32),
        rotationDeg: 0,
      },
    },
    {
      name: "Giữa áo",
      region: {
        x: Math.round(width * 0.16),
        y: Math.round(height * 0.12),
        width: Math.round(width * 0.68),
        height: Math.round(height * 0.68),
        rotationDeg: 0,
      },
    },
    {
      name: "Dọc giữa",
      region: {
        x: Math.round(width * 0.36),
        y: Math.round(height * 0.22),
        width: Math.round(width * 0.28),
        height: Math.round(height * 0.58),
        rotationDeg: 0,
      },
    },
  ];
}

function sameRegion(a: CompositeRegion, b: CompositeRegion): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotationDeg === b.rotationDeg;
}

function defaultRegion(imageWidth: number, imageHeight: number): CompositeRegion {
  const width = Math.max(1, Math.round(imageWidth * 0.42));
  const height = Math.max(1, Math.round(imageHeight * 0.28));
  return {
    x: Math.max(0, Math.round((imageWidth - width) / 2)),
    y: Math.max(0, Math.round((imageHeight - height) / 2)),
    width,
    height,
    rotationDeg: 0,
  };
}

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-default)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  fontSize: "0.8rem",
};

const iconButton: CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
