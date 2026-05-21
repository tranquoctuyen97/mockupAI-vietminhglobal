"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
}

const MAX_DISPLAY_WIDTH = 480;

export function CompositeRegionEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  value,
  onChange,
}: CompositeRegionEditorProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [displayWidth, setDisplayWidth] = useState(Math.min(MAX_DISPLAY_WIDTH, imageWidth || MAX_DISPLAY_WIDTH));
  const region = useMemo(
    () => value ?? defaultRegion(imageWidth, imageHeight),
    [value, imageWidth, imageHeight],
  );
  const scale = imageWidth > 0 ? displayWidth / imageWidth : 1;
  const displayHeight = Math.max(1, Math.round(imageHeight * scale));

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

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: MAX_DISPLAY_WIDTH,
          aspectRatio: `${imageWidth || 1} / ${imageHeight || 1}`,
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          overflow: "hidden",
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
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.12)",
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-primary)",
                fontSize: 12,
                fontWeight: 800,
                background: "rgba(255,255,255,0.12)",
                transform: `rotate(${region.rotationDeg}deg)`,
                transformOrigin: "center",
              }}
            >
              Design
            </div>
          </Rnd>
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

      <details>
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
  );
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-default)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  fontSize: "0.8rem",
};
