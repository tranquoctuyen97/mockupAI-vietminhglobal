"use client";

import { CheckSquare, Square } from "lucide-react";

type StoreColor = {
  id: string;
  name: string;
  hex: string;
};

type Props = {
  colors: StoreColor[];
  selectedIds: Set<string>;
  onToggle: (colorId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  /** colorId → true if custom mockup available */
  customAvailabilityByColorId?: Map<string, boolean>;
  isCustomTemplate?: boolean;
};

export function ColorPicker({
  colors,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
  customAvailabilityByColorId,
  isCustomTemplate,
}: Props) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Màu sắc</h3>
        <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>{selectedIds.size}/{colors.length}</span>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          className="btn btn-secondary"
          style={{ padding: "4px 8px", fontSize: "0.75rem", flex: 1 }}
          onClick={onSelectAll}
        >
          Chọn hết
        </button>
        <button
          className="btn btn-secondary"
          style={{ padding: "4px 8px", fontSize: "0.75rem", flex: 1 }}
          onClick={onDeselectAll}
        >
          Bỏ chọn
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
        {colors.map((color) => {
          const selected = selectedIds.has(color.id);
          const missingCustomMockup =
            isCustomTemplate && customAvailabilityByColorId
              ? !customAvailabilityByColorId.get(color.id)
              : false;
          return (
            <div
              key={color.id}
              onClick={() => !missingCustomMockup && onToggle(color.id)}
              title={missingCustomMockup ? "Màu này chưa có mockup custom." : color.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                border: selected ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                backgroundColor: selected ? "rgba(146, 198, 72, 0.05)" : "transparent",
                cursor: missingCustomMockup ? "not-allowed" : "pointer",
                opacity: missingCustomMockup ? 0.48 : 1,
              }}
            >
              {selected ? (
                <CheckSquare size={18} color="var(--color-wise-green)" />
              ) : (
                <Square size={18} opacity={0.3} />
              )}
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  backgroundColor: color.hex,
                  border: "1px solid rgba(0,0,0,0.1)",
                }}
              />
              <span style={{ fontSize: "0.85rem", fontWeight: 500, flex: 1 }}>{color.name}</span>
              {missingCustomMockup && (
                <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "#92400e" }}>
                  Thiếu mockup
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
