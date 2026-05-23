"use client";

import { LibraryBig, PencilLine, Truck } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export interface TemplateContext {
  id: string;
  name: string;
  blueprintTitle?: string | null;
  printProviderTitle?: string | null;
  defaultMockupSource: "PRINTIFY" | "CUSTOM";
  selectedColors: Array<{ id: string; name: string; hex: string }>;
  selectedPlacements: string[];
}

interface TemplateContextCardProps {
  template: TemplateContext;
  onChangeTemplate?: () => void;
}

export function TemplateContextCard({ template, onChangeTemplate }: TemplateContextCardProps) {
  return (
    <div
      className="card"
      style={{
        padding: 16,
        borderLeft: "4px solid var(--color-wise-green)",
        display: "grid",
        gap: 14,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-12" style={{ gap: 12, minWidth: 0 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 8,
              background: "rgba(159,232,112,0.18)",
              color: "var(--color-wise-dark-green)",
              display: "grid",
              placeItems: "center",
              fontSize: "1.1rem",
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            {template.name.trim().charAt(0).toUpperCase() || "T"}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 800, color: "var(--text-muted)" }}>
              Template đang dùng
            </p>
            <h3 style={{ margin: "2px 0 0", fontSize: "0.98rem", fontWeight: 900, overflowWrap: "anywhere" }}>
              {template.name}
            </h3>
            <p style={{ margin: "3px 0 0", fontSize: "0.76rem", color: "var(--text-muted)" }}>
              {template.blueprintTitle || "Chưa có blueprint"} · {template.printProviderTitle || "Provider chưa có tên"}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: "6px 10px", fontSize: "0.74rem", flexShrink: 0 }}
          onClick={onChangeTemplate}
        >
          <PencilLine size={13} />
          Đổi template
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
        }}
      >
        <InfoBlock label="Màu đã chọn">
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            {template.selectedColors.length > 0 ? (
              template.selectedColors.map((color) => (
                <span key={color.id} style={pillStyle}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      background: color.hex,
                      border: "1px solid rgba(0,0,0,0.16)",
                    }}
                  />
                  {color.name}
                </span>
              ))
            ) : (
              <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>Chưa chọn màu</span>
            )}
          </div>
        </InfoBlock>

        <InfoBlock label="Placement">
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            {template.selectedPlacements.length > 0 ? (
              template.selectedPlacements.map((placement) => (
                <span key={placement} style={pillStyle}>{placement}</span>
              ))
            ) : (
              <span style={pillStyle}>Placement đã lưu</span>
            )}
          </div>
        </InfoBlock>

        <InfoBlock label="Nguồn ảnh mặc định">
          <span
            style={{
              ...pillStyle,
              background:
                template.defaultMockupSource === "CUSTOM"
                  ? "rgba(159,232,112,0.18)"
                  : "var(--bg-inset, #f5f5f5)",
              color:
                template.defaultMockupSource === "CUSTOM"
                  ? "var(--color-wise-dark-green)"
                  : "var(--text-primary)",
              borderColor:
                template.defaultMockupSource === "CUSTOM"
                  ? "rgba(159,232,112,0.6)"
                  : "var(--border-default)",
            }}
          >
            {template.defaultMockupSource === "CUSTOM" ? <LibraryBig size={13} /> : <Truck size={13} />}
            {template.defaultMockupSource === "CUSTOM" ? "Custom" : "Printify"}
          </span>
        </InfoBlock>
      </div>
    </div>
  );
}

function InfoBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: "0.68rem", fontWeight: 900, color: "var(--text-muted)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--border-default)",
  borderRadius: 999,
  padding: "4px 8px",
  fontSize: "0.72rem",
  fontWeight: 800,
  background: "var(--bg-primary)",
};
