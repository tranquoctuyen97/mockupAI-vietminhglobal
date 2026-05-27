"use client";

import { Ruler } from "lucide-react";

type SizeEntry = {
  size: string;
  isAvailable: boolean;
  costDeltaCents: number;
};

type Props = {
  sizes: SizeEntry[];
  selectedSizes: Set<string>;
  onToggle: (size: string) => void;
};

export function SizePicker({ sizes, selectedSizes, onToggle }: Props) {
  if (sizes.length === 0) return null;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>
          <Ruler size={14} style={{ display: "inline", marginRight: 6, opacity: 0.5 }} />
          Kích thước
        </h3>
        <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>{selectedSizes.size}/{sizes.length}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sizes.map((s) => {
          const on = selectedSizes.has(s.size);
          const disabled = !s.isAvailable;
          return (
            <button
              key={s.size}
              type="button"
              onClick={() => !disabled && onToggle(s.size)}
              style={{
                padding: "5px 10px",
                borderRadius: 8,
                border: on ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                backgroundColor: disabled
                  ? "rgba(148,163,184,0.08)"
                  : on
                    ? "rgba(159,232,112,0.08)"
                    : "transparent",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.4 : 1,
                fontSize: "0.8rem",
                fontWeight: on ? 600 : 400,
                transition: "all 0.12s",
              }}
            >
              {s.size}
              {s.costDeltaCents > 0 && (
                <span style={{ fontSize: "0.65rem", color: "#f59e0b", marginLeft: 3 }}>
                  +${(s.costDeltaCents / 100).toFixed(2)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
