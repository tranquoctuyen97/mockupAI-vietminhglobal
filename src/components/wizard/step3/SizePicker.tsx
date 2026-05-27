"use client";

import { useState, useMemo } from "react";
import { Ruler, CheckCircle2 } from "lucide-react";

type SizeEntry = {
  size: string;
  isAvailable: boolean;
  costDeltaCents: number;
};

/** Color info for tab rendering */
type ColorTab = {
  id: string;
  name: string;
  hex: string;
  /** Sizes that Printify says this color actually supports (from variantGroups). null = unknown */
  availableSizes?: Set<string> | null;
};

type Props = {
  /** All global sizes from /api/.../sizes */
  sizes: SizeEntry[];
  /** Currently selected color objects (from selectedColorIds) */
  selectedColors: ColorTab[];
  /** Per-color size map: colorId → Set<size> */
  sizesByColorId: Map<string, Set<string>>;
  onToggle: (colorId: string, size: string) => void;
  onSelectAll?: (colorId: string) => void;
  onClearAll?: (colorId: string) => void;
};

export function SizePicker({
  sizes,
  selectedColors,
  sizesByColorId,
  onToggle,
  onSelectAll,
  onClearAll,
}: Props) {
  const [activeColorId, setActiveColorId] = useState<string | null>(
    selectedColors[0]?.id ?? null,
  );

  // Keep active tab valid when colors change
  const activeId = selectedColors.some((c) => c.id === activeColorId)
    ? activeColorId
    : selectedColors[0]?.id ?? null;

  const activeColor = selectedColors.find((c) => c.id === activeId) ?? null;
  const enabledForActive = activeId ? (sizesByColorId.get(activeId) ?? new Set<string>()) : new Set<string>();

  // Total selected sizes across all colors (for summary badge)
  const totalSelected = useMemo(() => {
    let total = 0;
    for (const [, sizesSet] of sizesByColorId) total += sizesSet.size;
    return total;
  }, [sizesByColorId]);

  if (sizes.length === 0 || selectedColors.length === 0) return null;

  return (
    <div className="card" style={{ padding: 16 }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>
          <Ruler size={14} style={{ display: "inline", marginRight: 6, opacity: 0.5 }} />
          Kích thước theo màu
        </h3>
        {totalSelected > 0 && (
          <span
            style={{
              fontSize: "0.72rem",
              padding: "2px 8px",
              borderRadius: 20,
              background: "rgba(159,232,112,0.15)",
              color: "var(--color-wise-green)",
              fontWeight: 600,
            }}
          >
            {totalSelected} size đã chọn
          </span>
        )}
      </div>

      {/* Color tabs */}
      {selectedColors.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 12,
            borderBottom: "1px solid var(--border-default)",
            paddingBottom: 10,
          }}
        >
          {selectedColors.map((color) => {
            const isActive = color.id === activeId;
            const count = sizesByColorId.get(color.id)?.size ?? 0;
            return (
              <button
                key={color.id}
                type="button"
                onClick={() => setActiveColorId(color.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 10px",
                  borderRadius: 8,
                  border: isActive
                    ? "1.5px solid var(--color-wise-green)"
                    : "1px solid var(--border-default)",
                  background: isActive ? "rgba(159,232,112,0.08)" : "transparent",
                  cursor: "pointer",
                  fontSize: "0.78rem",
                  fontWeight: isActive ? 700 : 400,
                  transition: "all 0.1s",
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    backgroundColor: color.hex,
                    border: "1px solid rgba(0,0,0,0.1)",
                    flexShrink: 0,
                  }}
                />
                <span>{color.name.split(" ").slice(-2).join(" ")}</span>
                {count > 0 && (
                  <span style={{ opacity: 0.6, fontSize: "0.7rem" }}>({count})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Size grid for active color */}
      {activeId && (
        <>
          {/* Quick actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            {selectedColors.length === 1 && activeColor && (
              <span style={{ fontSize: "0.78rem", fontWeight: 600, opacity: 0.7 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: activeColor.hex,
                    border: "1px solid rgba(0,0,0,0.1)",
                    display: "inline-block",
                    marginRight: 5,
                    verticalAlign: "middle",
                  }}
                />
                {activeColor.name}
              </span>
            )}
            {onSelectAll && (
              <button
                type="button"
                onClick={() => onSelectAll(activeId)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.72rem",
                  color: "var(--color-wise-green)",
                  fontWeight: 500,
                }}
              >
                Tất cả
              </button>
            )}
            {onClearAll && enabledForActive.size > 0 && (
              <>
                <span style={{ opacity: 0.2 }}>·</span>
                <button
                  type="button"
                  onClick={() => onClearAll(activeId)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "0.72rem",
                    color: "#94a3b8",
                    fontWeight: 500,
                  }}
                >
                  Bỏ hết
                </button>
              </>
            )}
            <span style={{ marginLeft: "auto", fontSize: "0.72rem", opacity: 0.5 }}>
              {enabledForActive.size}/{sizes.filter((s) => s.isAvailable).length}
            </span>
          </div>

          {/* Size buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sizes.map((s) => {
              const unavailableForColor =
                activeColor?.availableSizes != null && !activeColor.availableSizes.has(s.size);
              const globalUnavailable = !s.isAvailable;
              const isDisabled = globalUnavailable || unavailableForColor;
              const on = enabledForActive.has(s.size);

              return (
                <button
                  key={s.size}
                  type="button"
                  onClick={() => !isDisabled && onToggle(activeId, s.size)}
                  title={
                    unavailableForColor
                      ? `${activeColor?.name} không có size ${s.size}`
                      : globalUnavailable
                        ? "Hết hàng tại nhà in này"
                        : undefined
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "5px 10px",
                    borderRadius: 8,
                    border: on ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                    backgroundColor: isDisabled
                      ? "rgba(148,163,184,0.06)"
                      : on
                        ? "rgba(159,232,112,0.08)"
                        : "transparent",
                    cursor: isDisabled ? "not-allowed" : "pointer",
                    opacity: isDisabled ? 0.3 : 1,
                    fontSize: "0.8rem",
                    fontWeight: on ? 600 : 400,
                    transition: "all 0.12s",
                    textDecoration: globalUnavailable ? "line-through" : "none",
                  }}
                >
                  {s.size}
                  {s.costDeltaCents > 0 && (
                    <span style={{ fontSize: "0.65rem", color: "#f59e0b" }}>
                      +${(s.costDeltaCents / 100).toFixed(2)}
                    </span>
                  )}
                  {on && !isDisabled && (
                    <CheckCircle2 size={11} style={{ color: "var(--color-wise-green)" }} />
                  )}
                  {unavailableForColor && (
                    <span style={{ fontSize: "0.6rem", color: "#94a3b8" }}>N/A</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
