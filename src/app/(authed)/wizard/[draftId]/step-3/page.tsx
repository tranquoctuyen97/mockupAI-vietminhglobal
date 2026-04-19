"use client";

import { useEffect, useState } from "react";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import { Image as ImageIcon, Move, ZoomIn } from "lucide-react";

interface Placement {
  x: number;
  y: number;
  scale: number;
  position: "FRONT" | "BACK" | "SLEEVE";
}

const PRESETS = [
  { label: "Giữa", x: 0.5, y: 0.5 },
  { label: "Trên", x: 0.5, y: 0.2 },
  { label: "Dưới", x: 0.5, y: 0.8 },
  { label: "Trái trên", x: 0.2, y: 0.2 },
];

const POSITIONS: Array<{ value: Placement["position"]; label: string }> = [
  { value: "FRONT", label: "Mặt trước" },
  { value: "BACK", label: "Mặt sau" },
  { value: "SLEEVE", label: "Tay áo" },
];

export default function Step3PlacementPage() {
  const { draft, updateDraft } = useWizardStore();

  const placement: Placement = (draft?.placement as Placement) || {
    x: 0.5,
    y: 0.5,
    scale: 0.75,
    position: "FRONT",
  };

  // Get first selected color for preview
  const colors = (draft?.selectedColors as Array<{ title: string; hex: string }>) || [];
  const previewColor = colors[0]?.hex || "#CCCCCC";

  // Get design preview
  const [designPreview, setDesignPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!draft?.designId) return;
    (async () => {
      const res = await fetch(`/api/designs/${draft.designId}`);
      if (res.ok) {
        const data = await res.json();
        setDesignPreview(data.previewUrl);
      }
    })();
  }, [draft?.designId]);

  function setPlacement(patch: Partial<Placement>) {
    updateDraft({ placement: { ...placement, ...patch } });
  }

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Placement
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Vị trí design trên sản phẩm
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Canvas Preview */}
        <div
          className="card"
          style={{
            aspectRatio: "1/1",
            backgroundColor: previewColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
            maxHeight: 400,
          }}
        >
          {/* Design overlay */}
          {designPreview && (
            <img
              src={designPreview}
              alt="Design"
              style={{
                position: "absolute",
                width: `${placement.scale * 60}%`,
                left: `${placement.x * 100}%`,
                top: `${placement.y * 100}%`,
                transform: "translate(-50%, -50%)",
                objectFit: "contain",
                transition: "all 0.2s ease",
                filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.15))",
              }}
            />
          )}

          {!designPreview && (
            <ImageIcon size={48} style={{ opacity: 0.2 }} />
          )}

          {/* Position label */}
          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              background: "rgba(0,0,0,0.5)",
              color: "white",
              fontSize: "0.7rem",
              padding: "3px 8px",
              borderRadius: 4,
            }}
          >
            {placement.position}
          </div>
        </div>

        {/* Controls */}
        <div>
          {/* Position radio */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 8 }}>
              Vị trí in
            </label>
            <div className="flex gap-2">
              {POSITIONS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPlacement({ position: p.value })}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-sm)",
                    border: placement.position === p.value
                      ? "2px solid var(--color-wise-green)"
                      : "1px solid var(--border-default)",
                    backgroundColor: placement.position === p.value ? "rgba(146,198,72,0.08)" : "transparent",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    fontWeight: placement.position === p.value ? 600 : 400,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Presets */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 8 }}>
              <Move size={14} style={{ display: "inline", marginRight: 4 }} />
              Vị trí preset
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setPlacement({ x: p.x, y: p.y })}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-default)",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    backgroundColor:
                      placement.x === p.x && placement.y === p.y
                        ? "rgba(146,198,72,0.12)"
                        : "transparent",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scale slider */}
          <div>
            <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 8 }}>
              <ZoomIn size={14} style={{ display: "inline", marginRight: 4 }} />
              Kích thước: {Math.round(placement.scale * 100)}%
            </label>
            <input
              type="range"
              min={30}
              max={100}
              value={Math.round(placement.scale * 100)}
              onChange={(e) => setPlacement({ scale: parseInt(e.target.value, 10) / 100 })}
              style={{ width: "100%" }}
            />
            <div className="flex justify-between" style={{ fontSize: "0.7rem", opacity: 0.4 }}>
              <span>30%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Info */}
          <div
            className="card"
            style={{
              marginTop: 20,
              padding: "12px 16px",
              fontSize: "0.8rem",
              backgroundColor: "var(--bg-tertiary)",
            }}
          >
            <strong>Tóm tắt:</strong>
            <br />• Vị trí: {placement.position} — {PRESETS.find((p) => p.x === placement.x && p.y === placement.y)?.label || "Custom"}
            <br />• Scale: {Math.round(placement.scale * 100)}%
            <br />• Colors: {colors.length} màu
          </div>
        </div>
      </div>
    </div>
  );
}
